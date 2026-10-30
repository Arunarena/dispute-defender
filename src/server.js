import "dotenv/config";
import express from "express";
import path from "path";
import * as paypal from "./paypal.js";
import { analyzeDispute, claudeConfigured, MODEL } from "./agent.js";
import { demoDisputes, demoPhotos, incomingTemplates } from "./demoData.js";
import { recordLiveOrder, findOrder, findTracking, findCustomer } from "./store.js";
import { seedPhotos, listPhotos, addUpload, analyzePhoto, readPhoto } from "./photos.js";
import { negotiate } from "./negotiate.js";
import { bus, rules, updateRules, decide } from "./autopilot.js";

const app = express();
app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.resolve("public")));
app.use("/uploads", express.static(path.resolve("data", "uploads")));

const live = () => paypal.paypalConfigured();

// Demo-mode state (in memory). Resets when the server restarts.
const demoState = structuredClone(demoDisputes);
for (const d of demoState) seedPhotos(d.id, demoPhotos[d.id]);
const recommendations = new Map(); // latest AI recommendation per dispute
const activity = [];
let simCounter = 0;

const SHOP_ITEMS = {
  "AUR-ANC-01": { name: "Aurora ANC Wireless Headphones", sku: "AUR-ANC-01", price: "129.00" },
  "MUG-SET-4": { name: "Handmade Ceramic Mug Set (4 mugs)", sku: "MUG-SET-4", price: "64.00" },
  "TOTE-2": { name: "Organic Cotton Tote Bag (2-pack)", sku: "TOTE-2", price: "42.50" },
};

const publish = (event) => bus.emit("event", { ...event, time: new Date().toISOString() });

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(err);
    res.status(err.status && err.status < 600 ? err.status : 500).json({ error: err.message, details: err.details });
  }
};

function sse(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  return (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function loadDispute(id) {
  if (live() && !id.startsWith("PP-D-SIM-")) return paypal.getDispute(id);
  const d = demoState.find((x) => x.id === id);
  if (!d) throw Object.assign(new Error("Dispute not found"), { status: 404 });
  return d;
}

function intelFor(dispute) {
  const order = dispute.transactionId ? findOrder(dispute.transactionId) : null;
  return {
    order,
    tracking: order?.shipping ? findTracking(order.shipping.trackingNumber) : null,
    customer: order ? findCustomer(order.customerEmail) : null,
  };
}

// ---------------- core action: carry out a decision on PayPal ----------------
async function executeAction(dispute, rec, { source = "MANUAL", rule = null } = {}) {
  const id = dispute.id;
  const text = String(rec.response_text ?? "").slice(0, 2000);
  const sendLive = live() && !id.startsWith("PP-D-SIM-");
  let call;
  let result;
  let attached = 0;
  switch (rec.verdict) {
    case "FIGHT": {
      call = "POST /v1/customer/disputes/{id}/provide-evidence";
      // Attach photos that support the seller.
      const files = listPhotos(id)
        .filter((p) => p.analysis?.favors === "SELLER")
        .map((p) => readPhoto(p));
      attached = files.length;
      if (sendLive)
        result = await paypal.provideEvidence(id, {
          evidenceType: rec.primary_evidence_type ?? "PROOF_OF_FULFILLMENT",
          notes: text,
          tracking: rec.tracking ? { carrier: rec.tracking.carrier, trackingNumber: rec.tracking.tracking_number } : null,
          files,
        });
      break;
    }
    case "OFFER_PARTIAL_REFUND":
      call = "POST /v1/customer/disputes/{id}/make-offer";
      if (sendLive) result = await paypal.makeOffer(id, { note: text, amount: rec.offer_amount, currency: dispute.amount.currency });
      break;
    case "ACCEPT_CLAIM":
      call = "POST /v1/customer/disputes/{id}/accept-claim";
      if (sendLive) result = await paypal.acceptClaim(id, text);
      break;
    case "SEND_MESSAGE":
      call = "POST /v1/customer/disputes/{id}/send-message";
      if (sendLive) result = await paypal.sendMessage(id, text);
      break;
    default:
      throw Object.assign(new Error(`Unknown verdict ${rec.verdict}`), { status: 400 });
  }

  const full = Number(dispute.amount.value);
  const saved =
    rec.verdict === "OFFER_PARTIAL_REFUND" ? full - Number(rec.offer_amount || 0)
    : rec.verdict === "ACCEPT_CLAIM" ? 0
    : Number(rec.money_saved_estimate ?? full);
  const entry = {
    disputeId: id,
    verdict: rec.verdict,
    amount: dispute.amount,
    saved: Math.max(0, saved).toFixed(2),
    call,
    source,
    rule,
    photosAttached: attached,
    time: new Date().toISOString(),
    simulated: !sendLive,
    paypalStatus: result?.status ?? 200,
    debugId: result?.debugId ?? null,
  };
  activity.unshift(entry);

  if (!sendLive) {
    const d = demoState.find((x) => x.id === id);
    if (d) {
      d.status = { FIGHT: "UNDER_REVIEW", OFFER_PARTIAL_REFUND: "WAITING_FOR_BUYER_RESPONSE", ACCEPT_CLAIM: "RESOLVED", SEND_MESSAGE: "WAITING_FOR_BUYER_RESPONSE" }[rec.verdict];
      d.messages.push({ by: "SELLER", time: entry.time, content: text });
    }
  }
  publish({ type: "action", entry });
  return { entry, paypalResponse: result?.data ?? { simulated: true, note: "Demo mode: no PayPal call was made." } };
}

// ---------------- autopilot pipeline ----------------
async function handleIncoming(disputeId, via) {
  const dispute = await loadDispute(disputeId);
  publish({ type: "dispute_new", via, dispute: { id: dispute.id, item: dispute.items[0]?.name, amount: dispute.amount, reason: dispute.reason, buyerName: dispute.buyerName } });
  if (!rules.enabled) {
    publish({ type: "needs_approval", disputeId, reason: "Autopilot is off" });
    return;
  }
  publish({ type: "autopilot_start", disputeId });
  const rec = await analyzeDispute(dispute, (ev) => {
    if (ev.type === "tool") publish({ type: "autopilot_step", disputeId, label: ev.label });
  });
  recommendations.set(dispute.id, rec);
  const verdict = decide(dispute, rec);
  publish({ type: "autopilot_decision", disputeId, verdict: rec.verdict, odds: rec.win_likelihood, ...verdict });
  if (verdict.auto) await executeAction(dispute, rec, { source: "AUTOPILOT", rule: verdict.rule });
  else publish({ type: "needs_approval", disputeId, reason: verdict.rule, verdict: rec.verdict });
}

// ---------------- routes ----------------
app.get("/api/config", (req, res) => {
  res.json({
    paypalMode: live() ? "sandbox" : "demo",
    aiMode: claudeConfigured() ? "claude" : "scripted",
    model: claudeConfigured() ? MODEL : null,
    paypalClientId: live() ? process.env.PAYPAL_CLIENT_ID : null,
    webhooks: Boolean(process.env.PAYPAL_WEBHOOK_ID),
  });
});

// Live event stream for the dashboard (new disputes, autopilot actions).
app.get("/api/events", (req, res) => {
  const send = sse(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  bus.on("event", send);
  req.on("close", () => {
    clearInterval(ping);
    bus.off("event", send);
  });
});

app.get(
  "/api/disputes",
  wrap(async (req, res) => {
    const sims = demoState.filter((d) => d.id.startsWith("PP-D-SIM-"));
    const fromDemo = (list) => list.map(({ messages, items, ...rest }) => ({ ...rest, item: items[0]?.name, photos: listPhotos(rest.id).length }));
    const list = live() ? [...fromDemo(sims), ...(await paypal.listDisputes())] : fromDemo(demoState);
    res.json({ disputes: list, activity });
  }),
);

app.get(
  "/api/disputes/:id",
  wrap(async (req, res) => {
    const dispute = await loadDispute(req.params.id);
    res.json({ dispute, intel: intelFor(dispute), photos: listPhotos(dispute.id), recommendation: recommendations.get(dispute.id) ?? null });
  }),
);

// Runs the investigation agent and streams its steps.
app.get("/api/disputes/:id/analyze", async (req, res) => {
  const emit = sse(res);
  try {
    const dispute = await loadDispute(req.params.id);
    const rec = await analyzeDispute(dispute, emit);
    recommendations.set(dispute.id, rec);
    emit({ type: "result", recommendation: rec });
  } catch (err) {
    console.error(err);
    emit({ type: "error", message: err.message });
  }
  res.end();
});

// Seller approved (and maybe edited) the plan.
app.post(
  "/api/disputes/:id/respond",
  wrap(async (req, res) => {
    const dispute = await loadDispute(req.params.id);
    const rec = { ...(recommendations.get(dispute.id) ?? {}), ...req.body };
    if (!rec.verdict) return res.status(400).json({ error: "Run the analysis first." });
    res.json({ ok: true, ...(await executeAction(dispute, rec, { source: "MANUAL" })) });
  }),
);

// ---- photo evidence ----
app.post(
  "/api/disputes/:id/photos",
  wrap(async (req, res) => {
    const dispute = await loadDispute(req.params.id);
    const photo = addUpload(dispute.id, req.body);
    res.json({ photo });
  }),
);

app.post(
  "/api/disputes/:id/photos/:photoId/analyze",
  wrap(async (req, res) => {
    const dispute = await loadDispute(req.params.id);
    const photo = listPhotos(dispute.id).find((p) => p.id === req.params.photoId);
    if (!photo) return res.status(404).json({ error: "Photo not found" });
    const analysis = await analyzePhoto(dispute, photo, intelFor(dispute).order);
    res.json({ photo: { ...photo, analysis } });
  }),
);

// ---- negotiation arena ----
app.get("/api/disputes/:id/negotiate", async (req, res) => {
  const emit = sse(res);
  try {
    const dispute = await loadDispute(req.params.id);
    await negotiate(dispute, intelFor(dispute), emit);
  } catch (err) {
    console.error(err);
    emit({ type: "error", message: err.message });
  }
  res.end();
});

app.post(
  "/api/disputes/:id/settle",
  wrap(async (req, res) => {
    const dispute = await loadDispute(req.params.id);
    const amount = Math.min(Number(dispute.amount.value), Math.max(0, Number(req.body.amount) || 0));
    const rec =
      amount > 0
        ? { verdict: "OFFER_PARTIAL_REFUND", offer_amount: amount.toFixed(2), response_text: req.body.note }
        : { verdict: "SEND_MESSAGE", response_text: req.body.note, money_saved_estimate: dispute.amount.value };
    res.json({ ok: true, ...(await executeAction(dispute, rec, { source: "NEGOTIATION" })) });
  }),
);

// ---- autopilot ----
app.get("/api/autopilot", (req, res) => res.json({ rules }));
app.post("/api/autopilot", (req, res) => {
  updateRules(req.body);
  publish({ type: "rules", rules });
  res.json({ rules });
});

// Simulates PayPal sending a CUSTOMER.DISPUTE.CREATED webhook.
app.post(
  "/api/simulate/dispute",
  wrap(async (req, res) => {
    const t = incomingTemplates[simCounter++ % incomingTemplates.length];
    const now = new Date().toISOString();
    const d = {
      id: `PP-D-SIM-${String(2000 + simCounter)}`,
      reason: t.reason,
      status: "WAITING_FOR_SELLER_RESPONSE",
      stage: t.stage,
      amount: t.amount,
      created: now,
      sellerResponseDue: new Date(Date.now() + 10 * 86400000).toISOString(),
      buyerName: t.buyerName,
      transactionId: t.transactionId,
      items: t.items,
      messages: [{ by: "BUYER", time: now, content: t.message }],
    };
    demoState.unshift(d);
    seedPhotos(d.id, []);
    res.json({ ok: true, disputeId: d.id });
    handleIncoming(d.id, "simulated webhook").catch((err) => publish({ type: "autopilot_error", disputeId: d.id, message: err.message }));
  }),
);

// Real PayPal webhook (sandbox). Subscribe to CUSTOMER.DISPUTE.CREATED and set PAYPAL_WEBHOOK_ID.
app.post(
  "/api/webhooks/paypal",
  wrap(async (req, res) => {
    if (!live() || !process.env.PAYPAL_WEBHOOK_ID) return res.status(503).json({ error: "Webhooks need PayPal keys and PAYPAL_WEBHOOK_ID in .env" });
    const ok = await paypal.verifyWebhook(req.headers, req.body);
    if (!ok) return res.status(401).json({ error: "Webhook signature verification failed" });
    res.json({ received: true });
    const disputeId = req.body?.resource?.dispute_id;
    if (req.body.event_type === "CUSTOMER.DISPUTE.CREATED" && disputeId) {
      handleIncoming(disputeId, "PayPal webhook").catch((err) => publish({ type: "autopilot_error", disputeId, message: err.message }));
    }
  }),
);

// ---------- Demo shop: real sandbox checkout that feeds the order system ----------
app.get("/api/shop/items", (req, res) => res.json({ items: Object.values(SHOP_ITEMS) }));

app.post(
  "/api/shop/orders",
  wrap(async (req, res) => {
    const item = SHOP_ITEMS[req.body.sku];
    if (!item) return res.status(400).json({ error: "Unknown item" });
    if (!live()) return res.status(400).json({ error: "Add PayPal sandbox keys to .env to use checkout." });
    const order = await paypal.createOrder(item);
    res.json({ id: order.id });
  }),
);

app.post(
  "/api/shop/orders/:id/capture",
  wrap(async (req, res) => {
    const item = SHOP_ITEMS[req.body.sku];
    const data = await paypal.captureOrder(req.params.id);
    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
    const shipping = data.purchase_units?.[0]?.shipping?.address;
    const address = shipping
      ? [shipping.address_line_1, shipping.admin_area_2, shipping.admin_area_1, shipping.postal_code, shipping.country_code].filter(Boolean).join(", ")
      : "Address on file";
    const { trackingNumber } = recordLiveOrder({
      captureId: capture?.id,
      orderId: data.id,
      payerEmail: data.payer?.email_address ?? "buyer@example.com",
      payerName: [data.payer?.name?.given_name, data.payer?.name?.surname].filter(Boolean).join(" "),
      address,
      item,
    });
    res.json({ status: data.status, captureId: capture?.id, trackingNumber });
  }),
);

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`\nDispute Defender running at http://localhost:${PORT}`);
  console.log(`  PayPal: ${live() ? "sandbox (live API)" : "demo data (add PAYPAL_CLIENT_ID/SECRET to .env for sandbox)"}`);
  console.log(`  AI:     ${claudeConfigured() ? `Claude ${MODEL}` : "scripted demo (add ANTHROPIC_API_KEY to .env for Claude)"}\n`);
});
