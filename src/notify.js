// Alerts to Slack, Discord and any automation webhook (Zapier, Make, n8n).
// Listens to the app's event bus and forwards the events a seller would want on their phone.
import crypto from "crypto";
import { bus } from "./autopilot.js";
import { logCall } from "./integrations.js";

const money = (a) => `$${Number(a?.value ?? a ?? 0).toFixed(2)}`;
const baseUrl = () => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
const caseLink = (id) => `${baseUrl()}/#${id}`;

// Plain-text line for an event, or null if the event isn't worth an alert.
export function describe(ev) {
  switch (ev.type) {
    case "dispute_new":
      return `🚨 New PayPal dispute ${ev.dispute.id}: ${ev.dispute.buyerName}, ${ev.dispute.item ?? "item"}, ${money(ev.dispute.amount)} (${ev.dispute.reason}). ${caseLink(ev.dispute.id)}`;
    case "needs_approval":
      return ev.verdict ? `✋ ${ev.disputeId} needs your approval: the AI suggests ${ev.verdict}. Held because ${ev.reason}. ${caseLink(ev.disputeId)}` : null;
    case "action":
      return ev.entry.source === "AUTOPILOT"
        ? `🤖 Autopilot sent ${ev.entry.verdict} on ${ev.entry.disputeId} (${ev.entry.rule}). Kept ${money(ev.entry.saved)}.${ev.entry.simulated ? " [demo]" : ""}`
        : null;
    case "outcome":
      return `⚖️ PayPal ruled on ${ev.entry.disputeId}: ${ev.entry.outcome}. Kept ${money(ev.entry.kept)} (AI predicted ${ev.entry.odds}%).`;
    case "order_scored":
      return ev.order.level === "HIGH" ? `🛑 High-risk order ${ev.order.id}: ${ev.order.buyerName}, ${money(ev.order.total)}, risk ${ev.order.score}. AI says ${ev.order.action}. ${baseUrl()}` : null;
    case "deadline":
      return `⏰ ${ev.disputeId} is due in ${ev.hoursLeft}h: ${ev.buyerName}, ${money(ev.amount)}. Respond or PayPal rules for the buyer. ${caseLink(ev.disputeId)}`;
    case "package_tap":
      if (ev.kind === "CONFIRM_OK") return `📲 ${ev.buyerName} tapped their package and confirmed it arrived OK (${ev.item}).`;
      if (ev.kind === "PROBLEM") return `⚠️ ${ev.buyerName} tapped their package and reported a problem with ${ev.item}: "${ev.note ?? ""}". Fix it now, before it becomes a PayPal dispute.`;
      return null;
    case "test":
      return `✅ Dispute Defender test alert. This channel is connected. (${baseUrl()})`;
    default:
      return null;
  }
}

// Automations also get these, even though they are too noisy for a chat channel.
const DATA_ONLY = new Set(["action", "dispute_update", "order_decision", "package_tap", "tag_written"]);

async function post(id, url, body, label, headers = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body, signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    logCall(id, "POST webhook", { ok: true, detail: label, ms: Date.now() - t0 });
    return true;
  } catch (err) {
    logCall(id, "POST webhook", { ok: false, detail: err.message, ms: Date.now() - t0 });
    return false;
  }
}

// Sends one event to every configured channel. `only` limits it to one channel (for the test button).
export async function send(ev, only = null) {
  const text = describe(ev);
  const jobs = [];
  const want = (id) => !only || only === id;
  if (text && want("slack") && process.env.SLACK_WEBHOOK_URL) jobs.push(post("slack", process.env.SLACK_WEBHOOK_URL, JSON.stringify({ text }), text));
  if (text && want("discord") && process.env.DISCORD_WEBHOOK_URL) jobs.push(post("discord", process.env.DISCORD_WEBHOOK_URL, JSON.stringify({ content: text.slice(0, 1900) }), text));
  if (want("outbound") && process.env.OUTBOUND_WEBHOOK_URL && (text || only || DATA_ONLY.has(ev.type))) {
    const { type, time, ...data } = ev;
    const body = JSON.stringify({ event: type, text, data, sent_at: time ?? new Date().toISOString() });
    const headers = {};
    // Receivers check this to know the call came from us: HMAC-SHA256 of the raw body.
    if (process.env.OUTBOUND_WEBHOOK_SECRET) headers["X-Defender-Signature"] = "sha256=" + crypto.createHmac("sha256", process.env.OUTBOUND_WEBHOOK_SECRET).update(body).digest("hex");
    jobs.push(post("outbound", process.env.OUTBOUND_WEBHOOK_URL, body, `event ${type}`, headers));
  }
  const results = await Promise.all(jobs);
  return { sent: results.filter(Boolean).length, tried: results.length, text };
}

export const anyChannel = () => Boolean(process.env.SLACK_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL || process.env.OUTBOUND_WEBHOOK_URL);

export function startNotifier() {
  if (!anyChannel()) return;
  bus.on("event", (ev) => {
    if (ev.type === "integration_call") return; // never alert about our own alert calls
    send(ev).catch(() => {});
  });
}
