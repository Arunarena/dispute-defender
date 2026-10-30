// PayPal REST client (sandbox): OAuth, Disputes API v1, Orders API v2.
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
