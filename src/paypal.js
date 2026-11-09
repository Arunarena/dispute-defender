// PayPal REST client (sandbox): OAuth, Disputes API v1, Orders API v2, Add Tracking, Payments v2 refunds, Transaction Search, webhook verification.
const BASE = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";

export const paypalConfigured = () =>
  Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

let cachedToken = null;

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

async function call(method, path, { json, form } = {}) {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}` };
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form; // fetch sets the multipart boundary itself
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(
      `PayPal ${method} ${path} failed (${res.status}): ${data.message || data.name || text}`,
    );
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return { status: res.status, data, debugId: res.headers.get("paypal-debug-id") };
}

// ---------- Disputes ----------

export function normalizeDispute(d) {
  const txn = d.disputed_transactions?.[0] ?? {};
  return {
    id: d.dispute_id,
    reason: d.reason,
    status: d.status,
    stage: d.dispute_life_cycle_stage,
    amount: {
      value: d.dispute_amount?.value ?? "0.00",
      currency: d.dispute_amount?.currency_code ?? "USD",
    },
    created: d.create_time,
    sellerResponseDue: d.seller_response_due_date ?? null,
    buyerName: txn.buyer?.name ?? "Unknown buyer",
    transactionId: txn.seller_transaction_id ?? null,
    items: (txn.items ?? []).map((i) => ({
      name: i.item_name ?? i.item_description ?? "Item",
      quantity: Number(i.item_quantity ?? 1),
    })),
    messages: (d.messages ?? []).map((m) => ({
      by: m.posted_by,
      time: m.time_posted,
      content: m.content,
    })),
    allowedResponses: d.allowed_response_options ?? null,
    evidences: d.evidences ?? [],
    outcome: d.dispute_outcome
      ? { code: d.dispute_outcome.outcome_code, refunded: d.dispute_outcome.amount_refunded?.value ?? null }
      : null,
  };
}

export async function listDisputes() {
  const { data } = await call("GET", "/v1/customer/disputes?page_size=50");
  return (data.items ?? []).map((d) => ({
    id: d.dispute_id,
    reason: d.reason,
    status: d.status,
    stage: d.dispute_life_cycle_stage,
    amount: {
      value: d.dispute_amount?.value ?? "0.00",
      currency: d.dispute_amount?.currency_code ?? "USD",
    },
    created: d.create_time,
    sellerResponseDue: d.seller_response_due_date ?? null,
  }));
}

export async function getDispute(id) {
  const { data } = await call("GET", `/v1/customer/disputes/${encodeURIComponent(id)}`);
  return normalizeDispute(data);
}

const multipartInput = (payload) => {
  const form = new FormData();
  form.append("input", new Blob([JSON.stringify(payload)], { type: "application/json" }));
  return form;
};

// Submit evidence to fight a claim. `files`: [{ bytes, mediaType, filename }] photos to attach.
export function provideEvidence(id, { evidenceType, notes, tracking, files = [] }) {
  const evidence = { evidence_type: evidenceType, notes };
  if (tracking?.trackingNumber && evidenceType === "PROOF_OF_FULFILLMENT") {
    evidence.evidence_info = {
      tracking_info: [{ carrier_name: tracking.carrier || "OTHER", tracking_number: tracking.trackingNumber }],
    };
  }
  const form = multipartInput({ evidences: [evidence] });
  for (const f of files) form.append("evidence-file", new Blob([f.bytes], { type: f.mediaType }), f.filename);
  return call("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, { form });
}

export function sendMessage(id, message) {
  return call("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/send-message`, {
    json: { message },
  });
}

export function makeOffer(id, { note, amount, currency }) {
  return call("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/make-offer`, {
    json: { note, offer_type: "REFUND", offer_amount: { currency_code: currency, value: amount } },
  });
}

export function acceptClaim(id, note) {
  return call("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/accept-claim`, {
    json: { note },
  });
}

// ---------- Sandbox-only controls (PayPal rejects these on live accounts) ----------

// Moves a dispute from UNDER_REVIEW to waiting for the seller's (or buyer's) response.
export function requireEvidence(id, action = "SELLER_EVIDENCE") {
  return call("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/require-evidence`, { json: { action } });
}

// ---------- Orders (demo shop checkout) ----------

export async function createOrder(item) {
  const { data } = await call("POST", "/v2/checkout/orders", {
    json: {
      intent: "CAPTURE",
      purchase_units: [
        {
          description: item.name,
          amount: {
            currency_code: "USD",
            value: item.price,
            breakdown: { item_total: { currency_code: "USD", value: item.price } },
          },
          items: [
            {
              name: item.name,
              sku: item.sku,
              quantity: "1",
              unit_amount: { currency_code: "USD", value: item.price },
              category: "PHYSICAL_GOODS",
            },
          ],
        },
      ],
    },
  });
  return data;
}

export async function captureOrder(orderId) {
  const { data } = await call("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    json: {},
  });
  return data;
}

export async function getOrder(orderId) {
  const { data } = await call("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  return data;
}

// ---------- Add Tracking API ----------

// PayPal's carrier enum covers the big ones; anything else goes in as OTHER with a name.
const PAYPAL_CARRIERS = new Set(["USPS", "UPS", "FEDEX", "DHL", "DHL_API", "ONTRAC", "LASERSHIP", "CANADA_POST", "ROYAL_MAIL", "AUSTRALIA_POST"]);

// Puts a shipment's tracking number on the PayPal transaction. The buyer sees it in PayPal,
// and valid tracking is what Seller Protection asks for on "item not received" claims.
export function addTracking(orderId, { captureId, trackingNumber, carrier = "USPS", notifyPayer = true }) {
  const c = String(carrier).toUpperCase();
  const json = { capture_id: captureId, tracking_number: trackingNumber, notify_payer: notifyPayer };
  if (PAYPAL_CARRIERS.has(c)) json.carrier = c;
  else Object.assign(json, { carrier: "OTHER", carrier_name_other: carrier });
  return call("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/track`, { json });
}

// ---------- Payments API v2: refunds ----------

// Refunds a captured payment. With no amount, PayPal refunds the full capture.
export function refundCapture(captureId, { amount, currency = "USD", note } = {}) {
  const json = {};
  if (amount) json.amount = { value: amount, currency_code: currency };
  if (note) json.note_to_payer = note.slice(0, 255);
  return call("POST", `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, { json });
}

// ---------- Transaction Search API ----------

// The buyer's payments with this store over the last `days` (PayPal allows at most 31 per query).
// Needs "Transaction search" turned on for the app, and new payments can take a few hours to appear.
export async function buyerTransactions(email, days = 31) {
  const end = new Date();
  const start = new Date(end - Math.min(days, 31) * 86400000);
  const q = new URLSearchParams({ start_date: start.toISOString().replace(/\.\d+Z$/, "Z"), end_date: end.toISOString().replace(/\.\d+Z$/, "Z"), fields: "transaction_info,payer_info", page_size: "500" });
  const { data } = await call("GET", `/v1/reporting/transactions?${q}`);
  const mine = (data.transaction_details ?? []).filter((t) => t.payer_info?.email_address?.toLowerCase() === String(email).toLowerCase());
  const kind = (code = "") =>
    code.startsWith("T11") ? "REVERSAL_OR_REFUND" : code.startsWith("T12") ? "ADJUSTMENT_OR_CHARGEBACK" : code.startsWith("T00") ? "PAYMENT" : "OTHER";
  const list = mine.map((t) => ({
    id: t.transaction_info?.transaction_id,
    date: t.transaction_info?.transaction_initiation_date,
    type: kind(t.transaction_info?.transaction_event_code),
    code: t.transaction_info?.transaction_event_code,
    amount: t.transaction_info?.transaction_amount?.value,
    status: t.transaction_info?.transaction_status,
  }));
  const count = (k) => list.filter((t) => t.type === k).length;
  return {
    window: `last ${Math.min(days, 31)} days`,
    payments: count("PAYMENT"),
    refundsOrReversals: count("REVERSAL_OR_REFUND"),
    chargebacksOrAdjustments: count("ADJUSTMENT_OR_CHARGEBACK"),
    totalPaid: list.filter((t) => t.type === "PAYMENT").reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0).toFixed(2),
    recent: list.slice(0, 10),
  };
}

// ---------- Webhooks ----------

// Asks PayPal to confirm a webhook really came from PayPal.
export async function verifyWebhook(headers, event) {
  if (!process.env.PAYPAL_WEBHOOK_ID) return false;
  const { data } = await call("POST", "/v1/notifications/verify-webhook-signature", {
    json: {
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    },
  });
  return data.verification_status === "SUCCESS";
}
