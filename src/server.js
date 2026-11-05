import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import * as paypal from "./paypal.js";
import { analyzeDispute, claudeConfigured, MODEL } from "./agent.js";
import { demoDisputes, demoPhotos, incomingTemplates } from "./demoData.js";
import { recordLiveOrder, findOrder, findTracking, findCustomer } from "./store.js";
import { seedPhotos, listPhotos, addUpload, analyzePhoto, readPhoto } from "./photos.js";
import { negotiate } from "./negotiate.js";
import { bus, rules, updateRules, decide } from "./autopilot.js";
import { buildDossier } from "./dossier.js";
import { listOrders, getOrder, addOrder, simulateOrder, scoreOrder, decideOrder, riskStats } from "./risk.js";
import { buildReport } from "./insights.js";
import { askCopilot } from "./copilot.js";
import { calibrate, casePattern, notePrediction, pendingFor, pendingIds, outcomeFor, recordOutcome, outcomeFromPayPal, trackRecord } from "./outcomes.js";

const app = express();
app.use(express.json({ limit: "8mb" }));

// Let the Android companion app (a Capacitor WebView at http://localhost) call the API.
// Other localhost ports are allowed too, for previewing the app screens in a desktop browser.
const APP_ORIGIN = /^(https?|capacitor):\/\/localhost(:\d+)?$/;
app.use("/api", (req, res, next) => {
  if (APP_ORIGIN.test(req.headers.origin ?? "")) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.static(path.resolve("public")));
app.use("/uploads", express.static(path.resolve("data", "uploads")));

const live = () => paypal.paypalConfigured();
// A real dispute on the PayPal sandbox (not a simulated one).
const isSandboxCase = (id) => live() && !id.startsWith("PP-D-SIM-") && !/api-m.paypal.com/.test(process.env.PAYPAL_API_BASE ?? "");

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
  res.write(": connected\n\n"); // send headers now so clients know the stream is open
  return (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// Sandbox disputes can take hours to show up in PayPal's list, though fetching one by ID
// works at once. So we remember every case we've fetched by ID and add it to the list.
const KNOWN_FILE = path.resolve("data", "known-disputes.json");
const knownIds = new Set((() => { try { return JSON.parse(fs.readFileSync(KNOWN_FILE, "utf8")); } catch { return []; } })());
function rememberDispute(id) {
  if (knownIds.has(id)) return;
  knownIds.add(id);
  try {
    fs.mkdirSync(path.dirname(KNOWN_FILE), { recursive: true });
    fs.writeFileSync(KNOWN_FILE, JSON.stringify([...knownIds], null, 2));
  } catch (err) {
    console.error("Could not save known disputes:", err.message);
  }
}

async function loadDispute(id) {
  if (live() && !id.startsWith("PP-D-SIM-")) {
    const d = await paypal.getDispute(id);
    rememberDispute(d.id);
    return d;
  }
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

// Runs the agent, then calibrates its win odds against the track record of similar past cases.
async function runAgent(dispute, emit) {
  const rec = await analyzeDispute(dispute, emit);
  emit({ type: "tool", name: "track_record", label: "Checking the track record", input: {} });
  const cal = calibrate(dispute, intelFor(dispute), listPhotos(dispute.id), rec);
  emit({ type: "tool_result", name: "track_record", result: cal });
  recommendations.set(dispute.id, rec);
  return rec;
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
      // Attach the full evidence dossier PDF as well.
      const pdf = await buildDossier({ dispute, intel: intelFor(dispute), photos: listPhotos(id), recommendation: rec });
      files.push({ bytes: pdf, mediaType: "application/pdf", filename: `evidence-dossier-${id}.pdf` });
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
  notePrediction(dispute, rec, {
    simulated: !sendLive,
    pattern: rec.calibration?.pattern ?? casePattern(dispute, intelFor(dispute), listPhotos(id)),
  });

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
  const rec = await runAgent(dispute, (ev) => {
    if (ev.type === "tool") publish({ type: "autopilot_step", disputeId, label: ev.label });
  });
  const verdict = decide(dispute, rec);
  publish({ type: "autopilot_decision", disputeId, verdict: rec.verdict, odds: rec.win_likelihood, rawOdds: rec.calibration?.raw, ...verdict });
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

async function listAllDisputes() {
  const sims = demoState.filter((d) => d.id.startsWith("PP-D-SIM-"));
  const fromDemo = (list) => list.map(({ messages, items, ...rest }) => ({ ...rest, item: items[0]?.name, photos: listPhotos(rest.id).length }));
  if (!live()) return fromDemo(demoState);
  const listed = await paypal.listDisputes();
  const missing = [...knownIds].filter((id) => !listed.some((d) => d.id === id));
  const extra = (await Promise.all(missing.map((id) => paypal.getDispute(id).catch(() => null))))
    .filter(Boolean)
    .map(({ messages, items, evidences, allowedResponses, ...rest }) => ({ ...rest, item: items[0]?.name }));
  return [...fromDemo(sims), ...listed, ...extra];
}

app.get(
  "/api/disputes",
  wrap(async (req, res) => {
    const disputes = await listAllDisputes();
    // No webhook needed: record PayPal's ruling as soon as a case we answered shows as resolved.
    await syncResolved(disputes);
    res.json({ disputes, activity });
  }),
);

app.get(
  "/api/disputes/:id",
  wrap(async (req, res) => {
    const dispute = await loadDispute(req.params.id);
    await syncResolved([dispute]);
    res.json({
      dispute,
      intel: intelFor(dispute),
      photos: listPhotos(dispute.id),
      recommendation: recommendations.get(dispute.id) ?? null,
      pending: pendingFor(dispute.id),
      outcome: outcomeFor(dispute.id),
      // Demo: simulated ruling. Sandbox: a real PayPal ruling (adjudicate). Live PayPal: arrives by webhook.
      canSimulateRuling: !live() || dispute.id.startsWith("PP-D-SIM-") || isSandboxCase(dispute.id),
      sandboxTools: isSandboxCase(dispute.id),
    });
  }),
);

// Runs the investigation agent and streams its steps.
app.get("/api/disputes/:id/analyze", async (req, res) => {
  const emit = sse(res);
  try {
    const dispute = await loadDispute(req.params.id);
    const rec = await runAgent(dispute, emit);
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

// ---- evidence dossier PDF ----
app.get(
  "/api/disputes/:id/dossier.pdf",
  wrap(async (req, res) => {
    const dispute = await loadDispute(req.params.id);
    const pdf = await buildDossier({ dispute, intel: intelFor(dispute), photos: listPhotos(dispute.id), recommendation: recommendations.get(dispute.id) ?? null });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="evidence-dossier-${dispute.id}.pdf"`);
    res.send(pdf);
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

// ---- outcome learning ----
const applyOutcome = (entry) => {
  publish({ type: "outcome", entry });
  return entry;
};

// PayPal's final ruling on a case.
// Demo disputes: simulated. Sandbox disputes: a real ruling through PayPal's sandbox-only adjudicate call.
// Without a chosen outcome, the chance of a win follows the calibrated odds, so the result is realistic, not rigged.
app.post(
  "/api/disputes/:id/ruling",
  wrap(async (req, res) => {
    const dispute = await loadDispute(req.params.id);
    const p = pendingFor(dispute.id);
    const wanted = ["WON", "SETTLED", "LOST"].includes(req.body?.outcome) ? req.body.outcome : null;
    if (live() && !dispute.id.startsWith("PP-D-SIM-")) {
      if (!isSandboxCase(dispute.id)) return res.status(400).json({ error: "PayPal rules on live disputes. The result arrives by webhook." });
      return res.json(await sandboxRuling(dispute, p, wanted));
    }
    if (!p) return res.status(400).json({ error: outcomeFor(dispute.id) ? "PayPal has already ruled on this dispute." : "Respond to this dispute first." });
    const outcome = wanted ?? rollOutcome(p);
    const entry = recordOutcome(dispute.id, outcome, { source: "simulated" });
    const d = demoState.find((x) => x.id === dispute.id);
    if (d) {
      d.status = "RESOLVED";
      d.outcome = outcome;
      const note = {
        WON: "Case closed in the seller's favor. No refund is due.",
        SETTLED: "The buyer accepted the seller's offer. Case closed.",
        LOST: "Case closed in the buyer's favor. The buyer has been refunded.",
      }[outcome];
      d.messages.push({ by: "PAYPAL", time: entry.closed, content: note });
    }
    res.json({ ok: true, entry: applyOutcome(entry) });
  }),
);

function rollOutcome(p) {
  const roll = Math.random() * 100;
  return p.verdict === "FIGHT" ? (roll < p.odds ? "WON" : "LOST")
    : p.verdict === "OFFER_PARTIAL_REFUND" ? (roll < 80 ? "SETTLED" : "LOST")
    : p.verdict === "SEND_MESSAGE" ? (roll < 85 ? "WON" : "LOST")
    : "LOST";
}

// Sandbox: ask PayPal to rule for the seller or the buyer, then record the result.
async function sandboxRuling(dispute, p, wanted) {
  const fail = (message) => Object.assign(new Error(message), { status: 400 });
  if (dispute.status === "RESOLVED") {
    // Already closed on PayPal (for example after accepting the claim): just record it.
    await recordLiveRuling(dispute.id);
    const entry = outcomeFor(dispute.id);
    if (!entry) throw fail("PayPal has already closed this dispute.");
    return { ok: true, outcome: entry.outcome, entry };
  }
  if (!p && !wanted) throw fail("Respond to this dispute first, or pick who wins.");
  if (p?.verdict === "OFFER_PARTIAL_REFUND" && !wanted)
    throw fail("To settle, log in to the PayPal sandbox as the buyer and accept your offer. The result is then recorded automatically.");
  const outcome = wanted ?? rollOutcome(p);
  if (outcome === "SETTLED") throw fail("PayPal can only rule for the seller or the buyer. A settlement happens when the buyer accepts your offer.");
  await paypal.adjudicate(dispute.id, outcome === "WON" ? "SELLER_FAVOR" : "BUYER_FAVOR");
  const entry = p ? recordOutcome(dispute.id, outcome, { source: "paypal-sandbox" }) : null;
  if (entry) applyOutcome(entry);
  else publish({ type: "outcome_untracked", disputeId: dispute.id, outcome });
  return { ok: true, outcome, entry };
}

// Sandbox: move a dispute that's stuck in UNDER_REVIEW to waiting for the seller.
app.post(
  "/api/disputes/:id/require-evidence",
  wrap(async (req, res) => {
    if (!isSandboxCase(req.params.id)) return res.status(400).json({ error: "This only works on PayPal sandbox disputes." });
    await paypal.requireEvidence(req.params.id, "SELLER_EVIDENCE");
    res.json({ ok: true, dispute: await loadDispute(req.params.id) });
  }),
);

// Records PayPal's ruling on a live dispute, if we were waiting for one.
async function recordLiveRuling(id) {
  const p = pendingFor(id);
  if (!p) return;
  const d = await paypal.getDispute(id);
  // Compare with the amount when we responded: once a case settles, PayPal reports the refunded amount as the dispute amount.
  const outcome = d.status === "RESOLVED" ? outcomeFromPayPal(d.outcome?.code, d.outcome?.refunded, p.amount) : null;
  if (outcome) applyOutcome(recordOutcome(id, outcome, { refunded: d.outcome?.refunded }));
}

// Records rulings for answered cases that PayPal now shows as resolved.
async function syncResolved(disputes) {
  if (!live()) return;
  const due = disputes.filter((d) => d.status === "RESOLVED" && !d.id.startsWith("PP-D-SIM-") && pendingFor(d.id));
  await Promise.all(due.map((d) => recordLiveRuling(d.id).catch((err) => console.error(`Outcome sync for ${d.id} failed:`, err.message))));
}

// Live mode: catch rulings we missed (for example when no webhook is set up).
async function syncLiveOutcomes() {
  if (!live()) return;
  for (const id of pendingIds()) {
    if (id.startsWith("PP-D-SIM-") || pendingFor(id)?.simulated) continue;
    await recordLiveRuling(id).catch((err) => console.error(`Outcome sync for ${id} failed:`, err.message));
  }
}

app.get(
  "/api/track-record",
  wrap(async (req, res) => {
    await syncLiveOutcomes();
    res.json(trackRecord());
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
    // PayPal ruled: record the outcome so the agent learns from it.
    if (req.body.event_type === "CUSTOMER.DISPUTE.RESOLVED" && disputeId) {
      recordLiveRuling(disputeId).catch((err) => console.error(`Outcome for ${disputeId} failed:`, err.message));
    }
  }),
);

// ---------- Risk Radar ----------
app.get("/api/orders", (req, res) => res.json({ orders: listOrders(), stats: riskStats() }));

app.post(
  "/api/orders/:id/score",
  wrap(async (req, res) => {
    const order = getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    await scoreOrder(order);
    res.json({ order });
  }),
);

app.post(
  "/api/orders/:id/decision",
  wrap(async (req, res) => {
    const order = decideOrder(req.params.id, req.body.decision);
    publish({ type: "order_decision", order: { id: order.id, decision: order.decision, total: order.total } });
    res.json({ order, stats: riskStats() });
  }),
);

async function handleNewOrder(order, via) {
  publish({ type: "order_new", via, order: { id: order.id, buyerName: order.buyerName, total: order.total, item: order.items[0]?.name } });
  await scoreOrder(order);
  publish({ type: "order_scored", order: { id: order.id, buyerName: order.buyerName, total: order.total, level: order.risk.level, score: order.risk.score, action: order.risk.action } });
}

app.post(
  "/api/simulate/order",
  wrap(async (req, res) => {
    const order = simulateOrder();
    res.json({ ok: true, orderId: order.id });
    handleNewOrder(order, "simulated checkout").catch((err) => publish({ type: "autopilot_error", disputeId: order.id, message: err.message }));
  }),
);

// ---------- Insights ----------
app.get(
  "/api/insights",
  wrap(async (req, res) => {
    res.json(await buildReport());
  }),
);

// ---------- Copilot ----------
const copilotCtx = {
  disputes: async () =>
    (await listAllDisputes()).map((d) => ({
      id: d.id, buyerName: d.buyerName, item: d.item, amount: d.amount?.value, reason: d.reason, stage: d.stage, status: d.status,
      daysLeft: d.sellerResponseDue ? Math.ceil((new Date(d.sellerResponseDue) - Date.now()) / 86400000) : null,
      done: ["RESOLVED", "UNDER_REVIEW", "WAITING_FOR_BUYER_RESPONSE"].includes(d.status),
      aiVerdict: recommendations.get(d.id)?.verdict ?? null, winOdds: recommendations.get(d.id)?.win_likelihood ?? null,
    })),
  dispute: async (id) => {
    const d = await loadDispute(id);
    return { dispute: d, intel: intelFor(d), recommendation: recommendations.get(id) ?? null };
  },
  overview: async () => {
    const list = await listAllDisputes();
    const open = list.filter((d) => !["RESOLVED", "UNDER_REVIEW", "WAITING_FOR_BUYER_RESPONSE"].includes(d.status));
    return {
      openDisputes: open.length,
      atStake: open.reduce((s, d) => s + Number(d.amount.value), 0).toFixed(2),
      saved: activity.reduce((s, a) => s + Number(a.saved || 0), 0).toFixed(2),
      recentActions: activity.slice(0, 5),
      autopilot: rules,
      riskRadar: riskStats(),
      trackRecord: (({ resolved, planSuccess, fightWinRate, brier, lessons, pending }) => ({
        resolved, planSuccess, fightWinRate, predictionError: brier,
        lessons: lessons.slice(0, 3).map((l) => l.text),
        awaitingRuling: pending.length,
      }))(trackRecord()),
    };
  },
  orders: () => listOrders().map(({ id, buyerName, total, items, status, risk }) => ({ id, buyerName, total, item: items[0]?.name, status, risk: risk && { score: risk.score, level: risk.level, action: risk.action } })),
};

app.post(
  "/api/copilot",
  wrap(async (req, res) => {
    const history = Array.isArray(req.body.history) ? req.body.history.slice(-10) : [];
    if (!history.length) return res.status(400).json({ error: "Say something first." });
    res.json(await askCopilot(history, copilotCtx));
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
    const payerCountry = data.payer?.address?.country_code ?? shipping?.country_code ?? "US";
    const order = addOrder({
      buyerName: [data.payer?.name?.given_name, data.payer?.name?.surname].filter(Boolean).join(" ") || "PayPal buyer",
      email: data.payer?.email_address ?? "",
      items: [{ name: item.name, qty: 1 }],
      total: item.price,
      shippingAddress: address,
      billingAddress: address,
      ipCountry: payerCountry,
      billingCountry: payerCountry,
      accountAgeDays: 365,
      priorOrders: 0,
      priorDisputes: 0,
      payerVerified: true,
      shippingSpeed: "Standard",
      paypalCaptureId: capture?.id,
    });
    handleNewOrder(order, "PayPal checkout").catch(() => {});
    res.json({ status: data.status, captureId: capture?.id, trackingNumber });
  }),
);

// ---------------- PayPal watcher ----------------
// Without a public webhook URL, the server checks PayPal every few seconds and pushes
// changes to the dashboard and phone: new messages, status changes, accepted offers, rulings.
// Set PAYPAL_POLL_SECONDS=0 to turn it off.
const POLL_MS = Number(process.env.PAYPAL_POLL_SECONDS ?? 5) * 1000;
const lastSeen = new Map(); // dispute id -> "status|message count|outcome"
let watcherPrimed = false;
const snapshot = (d) => `${d.status}|${d.messages?.length ?? 0}|${d.outcome?.code ?? ""}`;

async function watchPayPal() {
  const listed = await paypal.listDisputes();
  const ids = new Set([...listed.map((d) => d.id), ...knownIds, ...pendingIds()].filter((id) => !id.startsWith("PP-D-SIM-")));
  for (const id of ids) {
    const prev = lastSeen.get(id);
    if (prev?.startsWith("RESOLVED|") && !pendingFor(id)) continue; // closed and already recorded
    let d;
    try {
      d = await paypal.getDispute(id);
    } catch {
      continue;
    }
    const now = snapshot(d);
    lastSeen.set(id, now);
    if (d.status === "RESOLVED" && pendingFor(id)) await recordLiveRuling(id); // publishes "outcome"
    if (!watcherPrimed) continue; // first pass only learns the current state
    if (prev === undefined) {
      // A case we haven't seen before. With a webhook set up, the webhook handles it instead.
      if (!process.env.PAYPAL_WEBHOOK_ID) await handleIncoming(id, "PayPal").catch((err) => publish({ type: "autopilot_error", disputeId: id, message: err.message }));
    } else if (prev !== now) {
      const newMessages = (d.messages?.length ?? 0) - Number(prev.split("|")[1]);
      const last = d.messages?.at(-1);
      publish({
        type: "dispute_update",
        disputeId: id,
        status: d.status,
        statusChanged: prev.split("|")[0] !== d.status,
        message: newMessages > 0 && last ? { by: last.by, content: last.content } : null,
      });
    }
  }
  watcherPrimed = true;
}

function startWatcher() {
  if (!live() || POLL_MS <= 0) return;
  console.log(`  Watch:  checking PayPal every ${POLL_MS / 1000}s for changes`);
  const tick = async () => {
    await watchPayPal().catch((err) => console.error("PayPal watcher:", err.message));
    setTimeout(tick, POLL_MS);
  };
  tick();
}

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`\nDispute Defender running at http://localhost:${PORT}`);
  console.log(`  PayPal: ${live() ? "sandbox (live API)" : "demo data (add PAYPAL_CLIENT_ID/SECRET to .env for sandbox)"}`);
  console.log(`  AI:     ${claudeConfigured() ? `Claude ${MODEL}` : "scripted demo (add ANTHROPIC_API_KEY to .env for Claude)"}\n`);
  startWatcher();
});
