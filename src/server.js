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
import { listOrders, getOrder, addOrder, simulateOrder, scoreOrder, decideOrder, riskStats, saveOrders } from "./risk.js";
import { buildReport } from "./insights.js";
import { askCopilot } from "./copilot.js";
import { integrationStatus, logCall, timed, CATALOG } from "./integrations.js";
import { send as sendAlert, startNotifier } from "./notify.js";
import { buildCalendar } from "./calendar.js";
import { shippoTestMode } from "./carriers.js";
import { createTag, markWritten, verifyToken, recordTap, deviceLabel, tagUrl, tagEvidence, listTags } from "./nfc.js";
import { findTag, findTagsFor } from "./store.js";
import * as passkeys from "./passkeys.js";
import { calibrate, casePattern, notePrediction, pendingFor, pendingIds, outcomeFor, recordOutcome, outcomeFromPayPal, trackRecord } from "./outcomes.js";

const app = express();
// Behind Render's proxy: trust X-Forwarded-Proto/Host so passkeys see the real https origin.
app.set("trust proxy", true);
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
  "TRL-40": { name: "Trailblazer Hiking Backpack 40L", sku: "TRL-40", price: "149.00" },
  "MRN-THROW": { name: "Merino Wool Throw Blanket", sku: "MRN-THROW", price: "98.00" },
  "BREW-1L": { name: "Cold Brew Coffee Maker", sku: "BREW-1L", price: "39.99" },
  // Kawaii collection
  "MOCHI-PL": { name: "Mochi Kitty Plush", sku: "MOCHI-PL", price: "34.00" },
  "STRAW-MUG": { name: "Strawberry Milk Mug", sku: "STRAW-MUG", price: "22.00" },
  "BOW-HP": { name: "Pink Bow Headphones", sku: "BOW-HP", price: "79.00" },
  "HEART-BP": { name: "Heart Charm Mini Backpack", sku: "HEART-BP", price: "58.00" },
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
  const tracking = order?.shipping ? findTracking(order.shipping.trackingNumber) : null;
  const delivered = tracking?.status === "DELIVERED" ? tracking.events?.at(-1)?.time : null;
  return {
    order,
    tracking,
    customer: order ? findCustomer(order.customerEmail) : null,
    packageTag: dispute.transactionId ? tagEvidence(dispute.transactionId, delivered) : null,
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
    const withAi = disputes.map((d) => {
      const r = recommendations.get(d.id);
      return r ? { ...d, ai: { verdict: r.verdict, win: r.win_likelihood, saved: r.money_saved_estimate } } : d;
    });
    res.json({ disputes: withAi, activity });
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
      // Link for the order's NFC tag, so the seller can write it or simulate a tap.
      ...(() => {
        const tag = dispute.transactionId ? findTagsFor(dispute.transactionId)[0] : null;
        return tag ? { packageTagUrl: tagUrl(tag.id, baseUrl(req)), packageTagLocal: /localhost|127\.0\.0\.1/.test(baseUrl(req)) } : {};
      })(),
      pending: pendingFor(dispute.id),
      outcome: outcomeFor(dispute.id),
      // Demo: simulated ruling. Real PayPal cases (sandbox or live): recorded when PayPal closes the case.
      canSimulateRuling: !live() || dispute.id.startsWith("PP-D-SIM-"),
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

// One plain-language line per agent lookup, shown live during triage.
function finding(name, r) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  switch (name) {
    case "lookup_order": return r ? `Found the order${r.shipping?.carrier ? `, shipped ${r.shipping.carrier}` : ""}` : "No matching order on file";
    case "track_shipment": return r?.status ? `Tracking says ${r.status.toLowerCase().replace(/_/g, " ")}` : "No tracking found";
    case "get_customer_history": return r ? `Buyer has ${plural(r.orders ?? 0, "order")}, ${plural(r.priorDisputes ?? 0, "past dispute")}` : "New buyer, no history";
    case "get_store_policies": return "Checked our store policy";
    case "check_package_tag": return r?.taps?.length ? `Package tag was tapped ${plural(r.taps.length, "time")}` : "Package tag not tapped yet";
    case "inspect_photos": {
      const p = r?.photos ?? [];
      const top = p.find((x) => x.caption);
      return top ? `Photo: ${top.caption}` : `Looked at ${plural(p.length, "photo")}`;
    }
    case "track_record": return r?.label ? `Compared with past cases: ${r.label}` : null;
    default: return null;
  }
}

// Morning triage: runs the agent on every open dispute (a few at a time) and streams one result per case.
// Cases already analyzed reuse their plan. Nothing is sent to PayPal here.
app.get("/api/triage", async (req, res) => {
  const emit = sse(res);
  try {
    const open = (await listAllDisputes()).filter((d) => !["RESOLVED", "UNDER_REVIEW", "WAITING_FOR_BUYER_RESPONSE"].includes(d.status));
    emit({ type: "start", total: open.length });
    const queue = [...open];
    const worker = async () => {
      for (let d; (d = queue.shift()); ) {
        try {
          const dispute = await loadDispute(d.id);
          // Stream a short finding per lookup so the screen can show the agent thinking.
          const think = (ev) => {
            if (ev.type !== "tool_result") return;
            const text = finding(ev.name, ev.result);
            if (text) emit({ type: "step", id: d.id, name: ev.name, text });
          };
          const rec = recommendations.get(d.id) ?? (await runAgent(dispute, think));
          emit({ type: "item", id: d.id, verdict: rec.verdict, win: rec.win_likelihood, saved: rec.money_saved_estimate, offer: rec.offer_amount, headline: rec.headline });
        } catch (err) {
          emit({ type: "item", id: d.id, error: err.message });
        }
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));
    emit({ type: "done" });
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
    const verdict = req.body.verdict ?? recommendations.get(dispute.id)?.verdict ?? "response";
    if (!requireApproval(req, res, `respond:${dispute.id}`, `${{ FIGHT: "Submit evidence", OFFER_PARTIAL_REFUND: "Send refund offer", ACCEPT_CLAIM: "Accept claim and refund", SEND_MESSAGE: "Send reply" }[verdict] ?? "Respond"} on ${dispute.id} ($${Number(dispute.amount.value).toFixed(2)})`)) return;
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
// Demo disputes only. On real PayPal cases (sandbox or live) the ruling is recorded when PayPal closes the case.
// Without a chosen outcome, the chance of a win follows the calibrated odds, so the result is realistic, not rigged.
app.post(
  "/api/disputes/:id/ruling",
  wrap(async (req, res) => {
    const dispute = await loadDispute(req.params.id);
    const p = pendingFor(dispute.id);
    const wanted = ["WON", "SETTLED", "LOST"].includes(req.body?.outcome) ? req.body.outcome : null;
    if (live() && !dispute.id.startsWith("PP-D-SIM-"))
      return res.status(400).json({ error: "PayPal decides this case. The result is recorded automatically when PayPal closes it." });
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
    // A buyer message, an accepted offer or a status change: check PayPal now instead of waiting for the next poll.
    if (req.body.event_type === "CUSTOMER.DISPUTE.UPDATED" && live()) watchPayPal().catch(() => {});
    // A payment was captured anywhere on this PayPal account: score it in Risk Radar before it ships.
    if (req.body.event_type === "PAYMENT.CAPTURE.COMPLETED") handleCaptureWebhook(req.body.resource).catch((err) => console.error("Capture webhook:", err.message));
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

// Shipping puts the tracking number on the PayPal transaction (Add Tracking API).
async function pushTracking(order) {
  const call = "POST /v2/checkout/orders/{id}/track";
  const carrier = order.shipment?.carrier ?? "USPS";
  const trackingNumber = order.shipment?.trackingNumber ?? "9400" + String(Date.now()).slice(-18).padStart(18, "0");
  order.shipment = { carrier, trackingNumber, signature: order.decision === "SHIP_WITH_SIGNATURE", pushedToPayPal: false };
  if (live() && order.paypalOrderId && order.paypalCaptureId) {
    try {
      await timed("paypal_tracking", call, () => paypal.addTracking(order.paypalOrderId, { captureId: order.paypalCaptureId, trackingNumber, carrier }), () => `${carrier} ${trackingNumber} added to order ${order.paypalOrderId}`);
      order.shipment.pushedToPayPal = true;
      return { ok: true, simulated: false, call, detail: `Tracking ${carrier} ${trackingNumber} is now on the PayPal transaction. The buyer was notified.` };
    } catch (err) {
      return { ok: false, simulated: false, call, detail: err.message };
    }
  }
  logCall("paypal_tracking", call, { simulated: true, detail: `${carrier} ${trackingNumber} for ${order.id} (demo order, no PayPal call)` });
  return { ok: true, simulated: true, call, detail: `Demo order: with PayPal keys, ${carrier} ${trackingNumber} would be added to the PayPal transaction.` };
}

// Cancelling refunds the payment before it can turn into a chargeback (Payments API v2).
async function refundOrder(order) {
  const call = "POST /v2/payments/captures/{id}/refund";
  const note = "Your order was cancelled before shipping and has been refunded in full.";
  if (live() && order.paypalCaptureId) {
    try {
      const { data } = await timed("paypal_refunds", call, () => paypal.refundCapture(order.paypalCaptureId, { note }), ({ data }) => `refund ${data.id} ${data.status} for capture ${order.paypalCaptureId}`);
      order.refund = { id: data.id, status: data.status, amount: order.total };
      return { ok: true, simulated: false, call, detail: `Refunded $${order.total} through PayPal (refund ${data.id}, ${data.status}).` };
    } catch (err) {
      return { ok: false, simulated: false, call, detail: err.message };
    }
  }
  order.refund = { id: null, status: "SIMULATED", amount: order.total };
  logCall("paypal_refunds", call, { simulated: true, detail: `$${order.total} for ${order.id} (demo order, no PayPal call)` });
  return { ok: true, simulated: true, call, detail: `Demo order: with PayPal keys, $${order.total} would be refunded to the buyer now.` };
}

app.post(
  "/api/orders/:id/decision",
  wrap(async (req, res) => {
    const existing = getOrder(req.params.id);
    // A held order can still be shipped or cancelled. Shipped and cancelled orders are final.
    if (existing && ["SHIPPED", "CANCELLED"].includes(existing.status)) return res.status(409).json({ error: `Order is already ${existing.status.toLowerCase()}` });
    if (req.body.decision === "CANCEL" && !requireApproval(req, res, `refund:${req.params.id}`, `Refund order ${req.params.id}${existing ? ` ($${existing.total})` : ""}`)) return;
    const order = decideOrder(req.params.id, req.body.decision);
    const integration =
      order.status === "SHIPPED" ? await pushTracking(order)
      : order.status === "CANCELLED" ? await refundOrder(order)
      : null;
    // Every shipped box gets a Tap-to-Confirm tag.
    if (order.status === "SHIPPED") {
      const tag = createTag({ transactionId: order.paypalCaptureId ?? order.id, buyerName: order.buyerName, items: order.items.map((i) => i.name), total: order.total });
      order.tagId = tag.id;
    }
    saveOrders();
    publish({ type: "order_decision", order: { id: order.id, decision: order.decision, total: order.total }, integration });
    res.json({ order, stats: riskStats(), integration });
  }),
);

const addressText = (a) => (a ? [a.address_line_1, a.address_line_2, a.admin_area_2, a.admin_area_1, a.postal_code, a.country_code].filter(Boolean).join(", ") : "Address on file");

function riskOrderFromPayPal(data, capture, extra = {}) {
  const unit = data.purchase_units?.[0] ?? {};
  const payerName = [data.payer?.name?.given_name, data.payer?.name?.surname].filter(Boolean).join(" ");
  const address = addressText(unit.shipping?.address);
  const country = data.payer?.address?.country_code ?? unit.shipping?.address?.country_code ?? "US";
  return addOrder({
    buyerName: payerName || "PayPal buyer",
    email: data.payer?.email_address ?? "",
    items: (unit.items?.length ? unit.items : [{ name: unit.description ?? "Item", quantity: "1" }]).map((i) => ({ name: i.name, qty: Number(i.quantity ?? 1) })),
    total: capture?.amount?.value ?? unit.amount?.value ?? "0.00",
    shippingAddress: address,
    billingAddress: address,
    ipCountry: country,
    billingCountry: country,
    accountAgeDays: 365,
    priorOrders: 0,
    priorDisputes: 0,
    payerVerified: true,
    shippingSpeed: "Standard",
    paypalOrderId: data.id,
    paypalCaptureId: capture?.id,
    ...extra,
  });
}

// PAYMENT.CAPTURE.COMPLETED: any PayPal checkout (not just the demo shop) gets scored before it ships.
async function handleCaptureWebhook(capture) {
  if (!capture?.id || listOrders().some((o) => o.paypalCaptureId === capture.id)) return;
  const orderId = capture.supplementary_data?.related_ids?.order_id;
  const data = orderId
    ? await timed("paypal_orders", "GET /v2/checkout/orders/{id}", () => paypal.getOrder(orderId), (d) => `order ${d.id} for capture ${capture.id}`)
    : { id: null, purchase_units: [{ amount: capture.amount }] };
  if (listOrders().some((o) => o.paypalCaptureId === capture.id)) return; // the shop recorded it meanwhile
  await handleNewOrder(riskOrderFromPayPal(data, capture), "PayPal webhook");
}

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

// ---------- Integrations ----------
const baseUrl = (req) => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

app.get("/api/integrations", (req, res) => res.json({ ...integrationStatus(), calendarUrl: `${baseUrl(req)}/api/calendar.ics`, webhookUrl: `${baseUrl(req)}/api/webhooks/paypal` }));

// "Send test" button for Slack, Discord and the automation webhook.
app.post(
  "/api/integrations/:id/test",
  wrap(async (req, res) => {
    const item = CATALOG.find((i) => i.id === req.params.id && i.testable);
    if (!item) return res.status(404).json({ error: "Nothing to test for that integration" });
    if (!item.live()) return res.status(400).json({ error: `Set ${item.env.join(", ")} in .env first` });
    const r = await sendAlert({ type: "test", time: new Date().toISOString() }, item.id);
    res.status(r.sent ? 200 : 502).json(r.sent ? { ok: true, text: r.text } : { error: "The channel did not accept the message. See the call log." });
  }),
);

// Response deadlines as a calendar feed.
app.get(
  "/api/calendar.ics",
  wrap(async (req, res) => {
    const disputes = await listAllDisputes();
    logCall("calendar", "GET /api/calendar.ics", { detail: `served ${disputes.filter((d) => d.sellerResponseDue).length} deadlines to ${req.get("user-agent")?.split(" ")[0] ?? "a client"}` });
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `${req.query.download ? "attachment" : "inline"}; filename="dispute-deadlines.ics"`);
    res.send(buildCalendar(disputes, baseUrl(req)));
  }),
);

// Deadline reminders: one alert per dispute when its response window gets short.
const DEADLINE_HOURS = Number(process.env.DEADLINE_ALERT_HOURS ?? 48);
const reminded = new Set();
async function checkDeadlines() {
  const disputes = await listAllDisputes();
  for (const d of disputes) {
    if (!d.sellerResponseDue || d.status !== "WAITING_FOR_SELLER_RESPONSE" || reminded.has(d.id)) continue;
    const hoursLeft = Math.round((new Date(d.sellerResponseDue) - Date.now()) / 3600000);
    if (hoursLeft > DEADLINE_HOURS || hoursLeft < 0) continue;
    reminded.add(d.id);
    publish({ type: "deadline", disputeId: d.id, hoursLeft, amount: d.amount, buyerName: d.buyerName, item: d.item });
  }
}

// ---------- Passkey approval (WebAuthn) ----------
const pkCtx = (req) => ({ liveMode: live(), holder: req.get("x-passkey-holder") || null });
// The page's origin as the browser sees it. Passkeys are bound to this host name.
const rp = (req) => ({
  rpID: req.hostname,
  origins: [...new Set([`${req.protocol}://${req.get("host")}`, `https://${req.get("host")}`, process.env.PUBLIC_URL, process.env.RENDER_EXTERNAL_URL].filter(Boolean).map((o) => o.replace(/\/$/, "")))],
});

// True if the request may go ahead. Otherwise answers 401 so the dashboard asks for the passkey and retries.
function requireApproval(req, res, action, label) {
  if (!passkeys.isRequired(pkCtx(req))) return true;
  if (passkeys.consumeApproval(req.get("x-approval-token"), action)) {
    logCall("passkey", "approved", { detail: label });
    return true;
  }
  res.status(401).json({ error: "Approve this with your passkey. (On the phone app, approve it on the dashboard instead.)", passkey: "required", action, label });
  return false;
}

app.get("/api/passkeys", (req, res) => res.json(passkeys.status(pkCtx(req))));

app.post(
  "/api/passkeys/register/start",
  wrap(async (req, res) => {
    // Adding another passkey needs one you already have.
    if (!requireApproval(req, res, "passkey:add", "Add a new passkey")) return;
    res.json(await passkeys.startRegistration({ rpID: rp(req).rpID, label: req.body.label }));
  }),
);
app.post(
  "/api/passkeys/register/finish",
  wrap(async (req, res) => {
    const out = await passkeys.finishRegistration({ ...req.body, ...rp(req) });
    logCall("passkey", "registered", { detail: `${out.label} on ${req.hostname}` });
    res.json(out);
  }),
);
app.post(
  "/api/passkeys/approve/start",
  wrap(async (req, res) => {
    res.json(await passkeys.startApproval({ rpID: rp(req).rpID, action: String(req.body.action ?? ""), ...pkCtx(req) }));
  }),
);
app.post(
  "/api/passkeys/approve/finish",
  wrap(async (req, res) => {
    res.json(await passkeys.finishApproval({ ...req.body, ...rp(req) }));
  }),
);
app.post(
  "/api/passkeys/remove",
  wrap(async (req, res) => {
    if (!requireApproval(req, res, "passkey:remove", "Remove all passkeys")) return;
    passkeys.removeAll();
    logCall("passkey", "removed all", { detail: "Approvals no longer need a passkey" });
    res.json(passkeys.status(pkCtx(req)));
  }),
);

// ---------- Tap-to-Confirm (NFC package tags) ----------
const STORE_NAME = "Juniper & Co.";
const tagView = (tag, req) => ({ ...tag, url: tagUrl(tag.id, baseUrl(req)), localOnly: /localhost|127\.0\.0\.1/.test(baseUrl(req)) });

app.get("/api/nfc/tags", (req, res) => res.json({ tags: listTags().map((t) => tagView(t, req)) }));

// Add a tag to a dispute's order after the fact (orders that shipped before tags existed).
app.post(
  "/api/nfc/tags",
  wrap(async (req, res) => {
    const dispute = await loadDispute(String(req.body.disputeId ?? ""));
    if (!dispute.transactionId) return res.status(400).json({ error: "This dispute has no transaction to tag." });
    const order = findOrder(dispute.transactionId);
    const items = dispute.items?.length ? dispute.items.map((i) => i.name) : (order?.items ?? []).map((i) => i.name);
    const tag = createTag({ transactionId: dispute.transactionId, buyerName: dispute.buyerName, items: items.length ? items : ["Your order"], total: dispute.amount.value });
    publish({ type: "tag_written", tagId: tag.id, transactionId: tag.transactionId });
    res.json({ tag: tagView(tag, req) });
  }),
);
app.get("/api/nfc/tags/:id", (req, res) => {
  const tag = findTag(req.params.id);
  if (!tag) return res.status(404).json({ error: "Tag not found" });
  res.json({ tag: tagView(tag, req) });
});
// The seller's phone wrote the link to a sticker.
app.post("/api/nfc/tags/:id/written", (req, res) => {
  const tag = markWritten(req.params.id);
  if (!tag) return res.status(404).json({ error: "Tag not found" });
  publish({ type: "tag_written", tagId: tag.id, transactionId: tag.transactionId });
  res.json({ tag: tagView(tag, req) });
});

// The page a phone opens when it touches the box.
app.get("/t/:token", (req, res) => res.sendFile(path.resolve("public", "tap.html")));

const publicTag = (tag) => ({
  store: STORE_NAME,
  firstName: tag.label.buyerName?.split(" ")[0] ?? "there",
  items: tag.label.items,
  done: tag.taps.find((t) => t.kind === "CONFIRM_OK" || t.kind === "PROBLEM")?.kind ?? null,
});

app.get("/api/tap/:token", (req, res) => {
  const tag = verifyToken(req.params.token);
  if (!tag) return res.status(404).json({ error: "This tag isn't recognized." });
  const { tap, duplicate } = recordTap(tag, { kind: "OPEN", device: deviceLabel(req.get("user-agent")) });
  if (!duplicate) publish({ type: "package_tap", kind: "OPEN", tagId: tag.id, transactionId: tag.transactionId, buyerName: tag.label.buyerName, item: tag.label.items[0], device: tap.device });
  res.json(publicTag(tag));
});

app.post(
  "/api/tap/:token",
  wrap(async (req, res) => {
    const tag = verifyToken(req.params.token);
    if (!tag) return res.status(404).json({ error: "This tag isn't recognized." });
    const kind = req.body.kind === "PROBLEM" ? "PROBLEM" : "CONFIRM_OK";
    const loc = req.body.location;
    const location = loc && Number.isFinite(+loc.lat) && Number.isFinite(+loc.lon) ? { lat: +(+loc.lat).toFixed(5), lon: +(+loc.lon).toFixed(5), accuracy: Math.round(+loc.accuracy || 0) } : null;
    let photoUrl = null;
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(req.body.photo ?? "");
    if (m) {
      const bytes = Buffer.from(m[2], "base64");
      if (bytes.length > 5 * 1024 * 1024) return res.status(400).json({ error: "Photo must be under 5 MB." });
      const name = `tap-${tag.id}-${Date.now()}.${m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase()}`;
      fs.mkdirSync(path.resolve("data", "uploads"), { recursive: true });
      fs.writeFileSync(path.resolve("data", "uploads", name), bytes);
      photoUrl = `/uploads/${name}`;
    }
    const { tap } = recordTap(tag, { kind, device: deviceLabel(req.get("user-agent")), location, note: req.body.note, photoUrl });
    publish({ type: "package_tap", kind, tagId: tag.id, transactionId: tag.transactionId, buyerName: tag.label.buyerName, item: tag.label.items[0], device: tap.device, note: tap.note ?? null, located: Boolean(location) });
    res.json({ ok: true, ...publicTag(tag) });
  }),
);

// ---------- Demo shop: real sandbox checkout that feeds the order system ----------
app.get("/api/shop/items", (req, res) => res.json({ items: Object.values(SHOP_ITEMS) }));

// Demo mode (no PayPal keys): "buy" as a regular or a risky customer. The order goes to Risk Radar.
const DEMO_BUYERS = {
  good: [
    { buyerName: "Ava Thompson", email: "ava.thompson@example.com", shippingAddress: "12 Orchard Ln, Madison, WI 53703, US" },
    { buyerName: "Ben Carter", email: "ben.carter@example.com", shippingAddress: "301 River Rd, Raleigh, NC 27601, US" },
    { buyerName: "Chloe Nguyen", email: "chloe.nguyen@example.com", shippingAddress: "88 Sunset Blvd, Phoenix, AZ 85004, US" },
  ],
  risky: [
    { buyerName: "Alex Mercer", email: "am.deals.4471@example.net", shippingAddress: "Unit 31, 2100 NW 79th Ave (Freight Forwarder), Doral, FL 33122, US", billingAddress: "14 Elm St, Hartford, CT 06103, US", ipCountry: "RO" },
    { buyerName: "Sam Rivers", email: "s.rivers.x9@example.net", shippingAddress: "Locker 1182, 50 Depot St (Parcel Locker), Reno, NV 89501, US", billingAddress: "77 Lake Shore Dr, Chicago, IL 60611, US", ipCountry: "VN" },
  ],
};
let demoBuyerIdx = 0;
app.post(
  "/api/shop/demo-order",
  wrap(async (req, res) => {
    if (live()) return res.status(400).json({ error: "PayPal keys are set: use the PayPal checkout." });
    const item = SHOP_ITEMS[req.body.sku];
    if (!item) return res.status(400).json({ error: "Unknown item" });
    const risky = req.body.profile === "risky";
    const list = DEMO_BUYERS[risky ? "risky" : "good"];
    const who = list[demoBuyerIdx++ % list.length];
    const qty = risky ? 3 : 1;
    const order = addOrder({
      ...who,
      billingAddress: who.billingAddress ?? who.shippingAddress,
      items: [{ name: item.name, qty }],
      total: (Number(item.price) * qty).toFixed(2),
      ipCountry: who.ipCountry ?? "US",
      billingCountry: "US",
      accountAgeDays: risky ? 0 : 640,
      priorOrders: risky ? 0 : 3,
      priorDisputes: 0,
      payerVerified: !risky,
      shippingSpeed: risky ? "Overnight" : "Standard",
    });
    res.json({ ok: true, orderId: order.id, buyerName: order.buyerName, total: order.total });
    handleNewOrder(order, "demo shop checkout").catch((err) => publish({ type: "autopilot_error", disputeId: order.id, message: err.message }));
  }),
);

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
    const address = addressText(data.purchase_units?.[0]?.shipping?.address);
    // A Shippo test key only knows its own test numbers, so use one that reports "delivered".
    const shipment = shippoTestMode() ? { carrier: "SHIPPO", trackingNumber: "SHIPPO_DELIVERED" } : undefined;
    const { trackingNumber, carrier } = recordLiveOrder({
      captureId: capture?.id,
      orderId: data.id,
      payerEmail: data.payer?.email_address ?? "buyer@example.com",
      payerName: [data.payer?.name?.given_name, data.payer?.name?.surname].filter(Boolean).join(" "),
      address,
      item,
      shipment,
    });
    const order = riskOrderFromPayPal(data, capture, { items: [{ name: item.name, qty: 1 }], total: item.price, shipment: { carrier, trackingNumber } });
    // The shop "ships" at once, so the box gets its Tap-to-Confirm tag now.
    if (capture?.id) order.tagId = createTag({ transactionId: capture.id, buyerName: order.buyerName, items: [item.name], total: item.price }).id;
    saveOrders();
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

let watching = false;
async function watchPayPal() {
  if (watching) return; // a webhook can ask for a pass while one is running
  watching = true;
  try {
    await watchOnce();
  } finally {
    watching = false;
  }
}

async function watchOnce() {
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
  const extras = CATALOG.filter((i) => i.live() && ["paypal_webhooks", "shippo", "google_address", "slack", "discord", "outbound"].includes(i.id)).map((i) => i.name);
  console.log(`  Extras: ${extras.length ? extras.join(", ") : "none yet (see the Integrations tab)"}\n`);
  startWatcher();
  startNotifier();
  const tickDeadlines = () => checkDeadlines().catch((err) => console.error("Deadline check:", err.message));
  setTimeout(tickDeadlines, 5000);
  setInterval(tickDeadlines, 10 * 60000);
});
