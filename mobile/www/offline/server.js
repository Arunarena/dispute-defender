// Offline demo: the server's demo mode, running inside the app.
// Answers the same API paths as src/server.js, using the engine files copied from src/.
// No PayPal calls and no Claude: the scripted agent decides, and rulings are simulated.
// Mirrors the demo-mode parts of src/server.js; keep them in step when that changes.
import { demoDisputes, demoPhotos, incomingTemplates } from "./engine/demoData.js";
import { findOrder, findTracking, findCustomer } from "./engine/store.js";
import { seedPhotos, listPhotos } from "./engine/photos.js";
import { scriptedRecommendation } from "./engine/scripted.js";
import { bus, rules, updateRules, decide } from "./engine/autopilot.js";
import { calibrate, casePattern, notePrediction, pendingFor, outcomeFor, recordOutcome, trackRecord } from "./engine/outcomes.js";

const demoState = structuredClone(demoDisputes);
for (const d of demoState) seedPhotos(d.id, demoPhotos[d.id]);
const recommendations = new Map();
const activity = [];
let simCounter = 0;

const publish = (event) => bus.emit("event", { ...event, time: new Date().toISOString() });
const copy = (x) => JSON.parse(JSON.stringify(x)); // like sending JSON over the wire
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function loadDispute(id) {
  const d = demoState.find((x) => x.id === id);
  if (!d) throw fail("Dispute not found", 404);
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

async function runAgent(dispute, emit) {
  const rec = await scriptedRecommendation(dispute, emit);
  emit({ type: "tool", name: "track_record", label: "Checking the track record", input: {} });
  const cal = calibrate(dispute, intelFor(dispute), listPhotos(dispute.id), rec);
  emit({ type: "tool_result", name: "track_record", result: cal });
  recommendations.set(dispute.id, rec);
  return rec;
}

const CALLS = {
  FIGHT: "POST /v1/customer/disputes/{id}/provide-evidence",
  OFFER_PARTIAL_REFUND: "POST /v1/customer/disputes/{id}/make-offer",
  ACCEPT_CLAIM: "POST /v1/customer/disputes/{id}/accept-claim",
  SEND_MESSAGE: "POST /v1/customer/disputes/{id}/send-message",
};

function executeAction(dispute, rec, { source = "MANUAL", rule = null } = {}) {
  const call = CALLS[rec.verdict];
  if (!call) throw fail(`Unknown verdict ${rec.verdict}`);
  const text = String(rec.response_text ?? "").slice(0, 2000);
  const full = Number(dispute.amount.value);
  const saved =
    rec.verdict === "OFFER_PARTIAL_REFUND" ? full - Number(rec.offer_amount || 0)
    : rec.verdict === "ACCEPT_CLAIM" ? 0
    : Number(rec.money_saved_estimate ?? full);
  const attached = rec.verdict === "FIGHT" ? listPhotos(dispute.id).filter((p) => p.analysis?.favors === "SELLER").length + 1 : 0;
  const entry = {
    disputeId: dispute.id,
    verdict: rec.verdict,
    amount: dispute.amount,
    saved: Math.max(0, saved).toFixed(2),
    call,
    source,
    rule,
    photosAttached: attached,
    time: new Date().toISOString(),
    simulated: true,
    paypalStatus: 200,
    debugId: null,
  };
  activity.unshift(entry);
  notePrediction(dispute, rec, {
    simulated: true,
    pattern: rec.calibration?.pattern ?? casePattern(dispute, intelFor(dispute), listPhotos(dispute.id)),
  });
  dispute.status = { FIGHT: "UNDER_REVIEW", OFFER_PARTIAL_REFUND: "WAITING_FOR_BUYER_RESPONSE", ACCEPT_CLAIM: "RESOLVED", SEND_MESSAGE: "WAITING_FOR_BUYER_RESPONSE" }[rec.verdict];
  dispute.messages.push({ by: "SELLER", time: entry.time, content: text });
  publish({ type: "action", entry });
  return { entry, paypalResponse: { simulated: true, note: "Offline demo: no PayPal call was made." } };
}

async function handleIncoming(disputeId, via) {
  const dispute = loadDispute(disputeId);
  publish({ type: "dispute_new", via, dispute: { id: dispute.id, item: dispute.items[0]?.name, amount: dispute.amount, reason: dispute.reason, buyerName: dispute.buyerName } });
  if (!rules.enabled) return publish({ type: "needs_approval", disputeId, reason: "Autopilot is off" });
  publish({ type: "autopilot_start", disputeId });
  const rec = await runAgent(dispute, (ev) => {
    if (ev.type === "tool") publish({ type: "autopilot_step", disputeId, label: ev.label });
  });
  const verdict = decide(dispute, rec);
  publish({ type: "autopilot_decision", disputeId, verdict: rec.verdict, odds: rec.win_likelihood, rawOdds: rec.calibration?.raw, ...verdict });
  if (verdict.auto) executeAction(dispute, rec, { source: "AUTOPILOT", rule: verdict.rule });
  else publish({ type: "needs_approval", disputeId, reason: verdict.rule, verdict: rec.verdict });
}

function simulateDispute() {
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
  setTimeout(() => handleIncoming(d.id, "simulated webhook").catch((err) => publish({ type: "autopilot_error", disputeId: d.id, message: err.message })), 300);
  return { ok: true, disputeId: d.id };
}

function simulateRuling(dispute, wanted) {
  const p = pendingFor(dispute.id);
  if (!p) throw fail(outcomeFor(dispute.id) ? "PayPal has already ruled on this dispute." : "Respond to this dispute first.");
  const roll = Math.random() * 100;
  const outcome = ["WON", "SETTLED", "LOST"].includes(wanted)
    ? wanted
    : p.verdict === "FIGHT" ? (roll < p.odds ? "WON" : "LOST")
    : p.verdict === "OFFER_PARTIAL_REFUND" ? (roll < 80 ? "SETTLED" : "LOST")
    : p.verdict === "SEND_MESSAGE" ? (roll < 85 ? "WON" : "LOST")
    : "LOST";
  const entry = recordOutcome(dispute.id, outcome, { source: "simulated" });
  dispute.status = "RESOLVED";
  dispute.outcome = outcome;
  const note = {
    WON: "Case closed in the seller's favor. No refund is due.",
    SETTLED: "The buyer accepted the seller's offer. Case closed.",
    LOST: "Case closed in the buyer's favor. The buyer has been refunded.",
  }[outcome];
  dispute.messages.push({ by: "PAYPAL", time: entry.closed, content: note });
  publish({ type: "outcome", entry });
  return { ok: true, entry };
}

// ---------------- request handling ----------------
const ROUTES = [
  ["GET", /^\/api\/config$/, () => ({ paypalMode: "demo", aiMode: "scripted", model: null, paypalClientId: null, webhooks: false, offline: true })],
  ["GET", /^\/api\/disputes$/, () => ({
    disputes: demoState.map(({ messages, items, ...rest }) => ({ ...rest, item: items[0]?.name, photos: listPhotos(rest.id).length })),
    activity,
  })],
  ["GET", /^\/api\/disputes\/([^/]+)$/, (id) => {
    const dispute = loadDispute(id);
    return {
      dispute,
      intel: intelFor(dispute),
      photos: listPhotos(dispute.id),
      recommendation: recommendations.get(dispute.id) ?? null,
      pending: pendingFor(dispute.id),
      outcome: outcomeFor(dispute.id),
      canSimulateRuling: true,
    };
  }],
  ["POST", /^\/api\/disputes\/([^/]+)\/respond$/, (id, body) => {
    const dispute = loadDispute(id);
    const rec = { ...(recommendations.get(dispute.id) ?? {}), ...body };
    if (!rec.verdict) throw fail("Run the analysis first.");
    return { ok: true, ...executeAction(dispute, rec, { source: "MANUAL" }) };
  }],
  ["POST", /^\/api\/disputes\/([^/]+)\/ruling$/, (id, body) => simulateRuling(loadDispute(id), body?.outcome)],
  ["GET", /^\/api\/track-record$/, () => trackRecord()],
  ["GET", /^\/api\/autopilot$/, () => ({ rules })],
  ["POST", /^\/api\/autopilot$/, (body) => {
    updateRules(body);
    publish({ type: "rules", rules });
    return { rules };
  }],
  ["POST", /^\/api\/simulate\/dispute$/, () => simulateDispute()],
];

// Same shape as a JSON API call: resolves with the data or throws an Error with the message.
export async function request(path, { method = "GET", body } = {}) {
  const pathname = decodeURI(path.split("?")[0]);
  const data = body ? JSON.parse(body) : {};
  for (const [m, re, fn] of ROUTES) {
    const match = m === method && re.exec(pathname);
    if (!match) continue;
    const params = match.slice(1).map(decodeURIComponent);
    return copy(await fn(...params, data));
  }
  throw fail(`Not available offline: ${method} ${pathname}`, 404);
}

// Stand-in for EventSource: same onmessage / onerror / onopen / close() shape.
export function stream(path) {
  const es = { onmessage: null, onerror: null, onopen: null, closed: false, close() { this.closed = true; off?.(); } };
  const send = (ev) => { if (!es.closed) es.onmessage?.({ data: JSON.stringify(ev) }); };
  let off = null;
  setTimeout(async () => {
    es.onopen?.();
    if (path === "/api/events") {
      bus.on("event", send);
      off = () => bus.off("event", send);
      return;
    }
    const m = /^\/api\/disputes\/([^/]+)\/analyze$/.exec(path);
    if (!m) return send({ type: "error", message: `Not available offline: ${path}` });
    try {
      const offlineNote = (ev) => send(ev.type === "status" ? { ...ev, message: "Offline demo: scripted agent on this phone" } : ev);
      const rec = await runAgent(loadDispute(decodeURIComponent(m[1])), offlineNote);
      send({ type: "result", recommendation: copy(rec) });
    } catch (err) {
      send({ type: "error", message: err.message });
    }
  }, 0);
  return es;
}
