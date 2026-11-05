// Integration hub: which outside services are switched on, plus a log of every call
// the app makes to them (live or simulated). The Integrations screen reads this.
import { bus } from "./autopilot.js";

const has = (...keys) => keys.every((k) => Boolean(process.env[k]));

// One entry per integration. `live()` says whether real calls are made.
export const CATALOG = [
  // ---- PayPal ----
  { id: "paypal_disputes", group: "PayPal", name: "Disputes API v1", env: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"], live: () => has("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"),
    what: "List disputes, read details, submit evidence, make offers, accept claims, message buyers." },
  { id: "paypal_webhooks", group: "PayPal", name: "Webhooks", env: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID"], live: () => has("PAYPAL_CLIENT_ID", "PAYPAL_WEBHOOK_ID"),
    what: "CUSTOMER.DISPUTE.CREATED / UPDATED / RESOLVED drive Autopilot and the Track Record. PAYMENT.CAPTURE.COMPLETED sends every checkout to Risk Radar." },
  { id: "paypal_tracking", group: "PayPal", name: "Add Tracking API", env: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"], live: () => has("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"),
    what: "When you ship from Risk Radar, the tracking number goes onto the PayPal transaction. Buyers see it in PayPal, and it counts toward Seller Protection, which stops most 'not received' claims." },
  { id: "paypal_refunds", group: "PayPal", name: "Payments API v2 (refunds)", env: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"], live: () => has("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"),
    what: "Cancel & refund a high-risk order before it ships. A refund now costs less than a chargeback later (no chargeback fee, no hit to your dispute rate)." },
  { id: "paypal_transactions", group: "PayPal", name: "Transaction Search API", env: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"], live: () => has("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"),
    what: "The AI agent checks the buyer's real PayPal history with your store (payments, refunds, reversals). Turn on 'Transaction search' in your PayPal app's features." },
  { id: "paypal_orders", group: "PayPal", name: "Orders API v2 + JS SDK", env: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"], live: () => has("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"),
    what: "Demo shop checkout. Also reads payer and shipping details for orders that arrive by webhook." },
  // ---- Evidence & fraud signals ----
  { id: "shippo", group: "Evidence & fraud signals", name: "Shippo carrier tracking", env: ["SHIPPO_API_KEY"], live: () => has("SHIPPO_API_KEY"),
    what: "Live tracking from USPS, UPS, FedEx, DHL and 40+ more carriers, for the agent and the evidence dossier. A shippo_test_ key works with the SHIPPO_DELIVERED test number." },
  { id: "google_address", group: "Evidence & fraud signals", name: "Google Address Validation", env: ["GOOGLE_MAPS_API_KEY"], live: () => has("GOOGLE_MAPS_API_KEY"),
    what: "Risk Radar checks each shipping address: is it deliverable, residential or business, a PO box, or a mail-drop (USPS CMRA), a common sign of reshipping fraud." },
  { id: "claude", group: "Evidence & fraud signals", name: "Claude API", env: ["ANTHROPIC_API_KEY"], live: () => has("ANTHROPIC_API_KEY") || has("ANTHROPIC_AUTH_TOKEN"),
    what: "The investigating agent, photo vision, negotiation, Risk Radar scoring, Insights and Copilot." },
  // ---- Alerts & automation ----
  { id: "slack", group: "Alerts & automation", name: "Slack", env: ["SLACK_WEBHOOK_URL"], live: () => has("SLACK_WEBHOOK_URL"), testable: true,
    what: "New disputes, cases that need approval, Autopilot actions, PayPal rulings, high-risk orders and deadline reminders, posted to a channel." },
  { id: "discord", group: "Alerts & automation", name: "Discord", env: ["DISCORD_WEBHOOK_URL"], live: () => has("DISCORD_WEBHOOK_URL"), testable: true,
    what: "The same alerts, posted to a Discord channel." },
  { id: "outbound", group: "Alerts & automation", name: "Zapier / Make / n8n webhook", env: ["OUTBOUND_WEBHOOK_URL"], live: () => has("OUTBOUND_WEBHOOK_URL"), testable: true,
    what: "Every event as signed JSON (X-Defender-Signature: sha256 HMAC). Connect it to Google Sheets, a helpdesk, SMS or email with no code." },
  { id: "calendar", group: "Alerts & automation", name: "Deadline calendar (iCal)", env: [], live: () => true,
    what: "Each open dispute's response deadline, with a reminder a day before. Subscribe from Google Calendar, Outlook or Apple Calendar." },
];

const calls = [];
let callSeq = 0;

// Record one outside call. `simulated` = demo mode, nothing left this machine.
export function logCall(id, action, { ok = true, simulated = false, detail = "", ms = null } = {}) {
  const entry = { seq: ++callSeq, id, action, ok, simulated, detail: String(detail).slice(0, 300), ms, time: new Date().toISOString() };
  calls.unshift(entry);
  calls.length = Math.min(calls.length, 60);
  bus.emit("event", { type: "integration_call", entry, time: entry.time });
  return entry;
}

// Time a live call and log it either way.
export async function timed(id, action, fn, describe = () => "") {
  const t0 = Date.now();
  try {
    const out = await fn();
    logCall(id, action, { ok: true, detail: describe(out), ms: Date.now() - t0 });
    return out;
  } catch (err) {
    logCall(id, action, { ok: false, detail: err.message, ms: Date.now() - t0 });
    throw err;
  }
}

export function integrationStatus() {
  return {
    integrations: CATALOG.map(({ live, ...i }) => {
      const on = live();
      return { ...i, live: on, missing: i.env.filter((k) => !process.env[k]), calls: calls.filter((c) => c.id === i.id).length };
    }),
    calls: calls.slice(0, 40),
  };
}
