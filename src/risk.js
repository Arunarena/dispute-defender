// Risk Radar: score new orders for fraud and dispute risk BEFORE they ship.
// Prevention beats cure: a held fraudulent order never becomes a dispute.
import { z } from "zod";
import { claudeConfigured, claudeJSON } from "./claude.js";

const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();

const seedOrders = [
  { id: "ORD-30411", placed: hoursAgo(0.4), buyerName: "Kevin Brandt", email: "kb.deals.0021@example.net", items: [{ name: "Pulse X2 Smartwatch", qty: 2 }], total: "579.98",
    shippingAddress: "Unit 14, 7400 NW 25th St (Freight Forwarder), Miami, FL 33122, US", billingAddress: "88 Beacon St, Boston, MA 02108, US",
    ipCountry: "NG", billingCountry: "US", accountAgeDays: 0, priorOrders: 0, priorDisputes: 0, payerVerified: false, shippingSpeed: "Overnight" },
  { id: "ORD-30409", placed: hoursAgo(1.2), buyerName: "Sofia Martins", email: "sofia.martins@example.com", items: [{ name: "Aurora ANC Wireless Headphones", qty: 1 }], total: "129.00",
    shippingAddress: "21 Lake Rd, Madison, WI 53703, US", billingAddress: "21 Lake Rd, Madison, WI 53703, US",
    ipCountry: "US", billingCountry: "US", accountAgeDays: 840, priorOrders: 3, priorDisputes: 0, payerVerified: true, shippingSpeed: "Standard" },
  { id: "ORD-30406", placed: hoursAgo(2.5), buyerName: "Tyler Ross", email: "tyler.ross.gg@example.com", items: [{ name: "Nova Pro Gaming Headset", qty: 1 }], total: "219.00",
    shippingAddress: "502 Pine St, Apt 9, Seattle, WA 98101, US", billingAddress: "502 Pine St, Apt 9, Seattle, WA 98101, US",
    ipCountry: "US", billingCountry: "US", accountAgeDays: 3, priorOrders: 0, priorDisputes: 0, payerVerified: true, shippingSpeed: "Express" },
  { id: "ORD-30402", placed: hoursAgo(4), buyerName: "Grace Liu", email: "grace.liu@example.com", items: [{ name: "Handmade Ceramic Mug Set (4 mugs)", qty: 1 }], total: "64.00",
    shippingAddress: "9 Elm Ct, Sacramento, CA 95814, US (gift)", billingAddress: "1440 Oak Ave, San Jose, CA 95126, US",
    ipCountry: "US", billingCountry: "US", accountAgeDays: 520, priorOrders: 2, priorDisputes: 0, payerVerified: true, shippingSpeed: "Standard" },
  { id: "ORD-30398", placed: hoursAgo(6), buyerName: "Liam Novak", email: "liam.n.travel@example.org", items: [{ name: "Boombox Mini Bluetooth Speaker", qty: 3 }], total: "267.00",
    shippingAddress: "Grand Harbor Hotel, Front Desk, 200 Bay St, San Diego, CA 92101, US", billingAddress: "45 King St W, Toronto, ON M5H 1J8, CA",
    ipCountry: "RO", billingCountry: "CA", accountAgeDays: 12, priorOrders: 0, priorDisputes: 0, payerVerified: false, shippingSpeed: "Express" },
  { id: "ORD-30395", placed: hoursAgo(8), buyerName: "Amara Okafor", email: "amara.okafor@example.com", items: [{ name: "Organic Cotton Tote Bag (2-pack)", qty: 1 }], total: "42.50",
    shippingAddress: "3 Willow Way, Austin, TX 78704, US", billingAddress: "3 Willow Way, Austin, TX 78704, US",
    ipCountry: "US", billingCountry: "US", accountAgeDays: 1310, priorOrders: 9, priorDisputes: 0, payerVerified: true, shippingSpeed: "Standard" },
];

const incomingOrderTemplates = [
  { buyerName: "Dmitri Volkov", email: "dv.shop.991@example.net", items: [{ name: "Nova Pro Gaming Headset", qty: 3 }], total: "657.00",
    shippingAddress: "Dock 7, 1 Cargo Plaza (Freight Forwarder), Elizabeth, NJ 07201, US", billingAddress: "12 Maple Dr, Dayton, OH 45402, US",
    ipCountry: "VN", billingCountry: "US", accountAgeDays: 0, priorOrders: 0, priorDisputes: 0, payerVerified: false, shippingSpeed: "Overnight" },
  { buyerName: "Hannah Weiss", email: "hannah.weiss@example.com", items: [{ name: "Handmade Ceramic Mug Set (4 mugs)", qty: 2 }], total: "128.00",
    shippingAddress: "17 Birch Rd, Portland, ME 04101, US", billingAddress: "17 Birch Rd, Portland, ME 04101, US",
    ipCountry: "US", billingCountry: "US", accountAgeDays: 690, priorOrders: 4, priorDisputes: 0, payerVerified: true, shippingSpeed: "Standard" },
  { buyerName: "Jordan Miles", email: "jordan.miles@example.com", items: [{ name: "Pulse X2 Smartwatch", qty: 1 }], total: "289.99",
    shippingAddress: "418 Birch Lane, Portland, OR 97205, US", billingAddress: "418 Birch Lane, Portland, OR 97205, US",
    ipCountry: "US", billingCountry: "US", accountAgeDays: 1240, priorOrders: 6, priorDisputes: 2, payerVerified: true, shippingSpeed: "Standard" },
];

const orders = seedOrders.map((o) => ({ ...o, status: "AWAITING_SHIPMENT", risk: null, decision: null }));
let orderCounter = 30412;
let templateIdx = 0;

export const listOrders = () => orders;
export const getOrder = (id) => orders.find((o) => o.id === id);

export function addOrder(o) {
  const order = { id: `ORD-${orderCounter++}`, placed: new Date().toISOString(), status: "AWAITING_SHIPMENT", risk: null, decision: null, ...o };
  orders.unshift(order);
  return order;
}

export const simulateOrder = () => addOrder({ ...incomingOrderTemplates[templateIdx++ % incomingOrderTemplates.length] });

export const RiskSchema = z.object({
  score: z.number().int().min(0).max(100).describe("0 = safe, 100 = almost certainly fraud or a future dispute."),
  level: z.enum(["LOW", "MEDIUM", "HIGH"]),
  action: z.enum(["SHIP", "SHIP_WITH_SIGNATURE", "HOLD_AND_VERIFY"]),
  headline: z.string().describe("One plain sentence for the seller."),
  signals: z
    .array(z.object({ label: z.string(), impact: z.number().int().describe("Points added (+) or removed (-) from risk, -30..+40."), detail: z.string() }))
    .describe("3-6 signals that drove the score, most important first."),
});

const SYSTEM = `You are a payments fraud analyst for a small online store that sells through PayPal.
Score how likely this order is to turn into fraud or a dispute, and recommend an action before it ships:
SHIP (normal), SHIP_WITH_SIGNATURE (moderate risk: require signature on delivery), HOLD_AND_VERIFY (high risk: contact buyer / verify before shipping).
Weigh signals like: billing vs shipping mismatch, freight forwarders and hotels, IP country vs billing country, brand-new accounts, unverified PayPal payers, rush shipping on high-value or multi-quantity electronics, prior disputes. Also credit good signals (long history, verified, matching addresses). Gift orders with different addresses but otherwise clean history are usually fine.`;

// Keyless demo: transparent points-based scoring.
function scriptedRisk(o) {
  const s = [];
  const add = (label, impact, detail) => s.push({ label, impact, detail });
  const total = Number(o.total);
  if (o.shippingAddress !== o.billingAddress) {
    if (/gift/i.test(o.shippingAddress)) add("Gift shipment", 4, "Ships to a different address, marked as a gift");
    else add("Billing ≠ shipping", 18, "The order ships somewhere other than the billing address");
  }
  if (/forward/i.test(o.shippingAddress)) add("Freight forwarder", 30, "Common way to move stolen goods overseas");
  if (/hotel/i.test(o.shippingAddress)) add("Hotel delivery", 14, "Temporary address, hard to verify receipt");
  if (o.ipCountry !== o.billingCountry) add(`IP in ${o.ipCountry}`, 16, `Order placed from ${o.ipCountry} but card billing is in ${o.billingCountry}`);
  if (o.accountAgeDays < 7) add("Brand-new account", 18, `Account created ${o.accountAgeDays === 0 ? "today" : `${o.accountAgeDays} days ago`}`);
  if (!o.payerVerified) add("Unverified PayPal payer", 10, "PayPal reports the payer as unverified");
  if (/overnight|express/i.test(o.shippingSpeed) && total > 150) add("Rush shipping, high value", 8, `${o.shippingSpeed} shipping on a $${total.toFixed(2)} order`);
  if (o.items.some((i) => i.qty > 1) && total > 200) add("Multiple high-value units", 8, "Several of the same expensive item");
  if (o.priorDisputes > 0) add(`${o.priorDisputes} prior disputes`, 14, "This buyer has disputed orders before");
  if (o.priorOrders >= 2 && o.priorDisputes === 0) add("Loyal customer", -15, `${o.priorOrders} previous orders, no problems`);
  if (o.accountAgeDays > 365) add("Long-standing account", -8, `${Math.round(o.accountAgeDays / 365)}+ years on PayPal`);
  if (o.payerVerified && o.shippingAddress === o.billingAddress) add("Verified & matching", -6, "Verified payer, addresses match");
  const score = Math.max(2, Math.min(98, 10 + s.reduce((a, x) => a + x.impact, 0)));
  const level = score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";
  const action = level === "HIGH" ? "HOLD_AND_VERIFY" : level === "MEDIUM" && total > 100 ? "SHIP_WITH_SIGNATURE" : "SHIP";
  const headline =
    level === "HIGH" ? `Hold this order: ${s.filter((x) => x.impact > 0).length} fraud signals stack up on a $${total.toFixed(2)} order.`
    : action === "SHIP_WITH_SIGNATURE" ? "Probably fine, but require a signature on delivery to protect a dispute."
    : "Low risk. Ship as normal.";
  s.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  return { score, level, action, headline, signals: s.slice(0, 6), engine: "scripted-demo" };
}

export async function scoreOrder(order) {
  if (!claudeConfigured()) {
    await new Promise((r) => setTimeout(r, 900));
    order.risk = scriptedRisk(order);
    return order.risk;
  }
  const { risk, decision, status, ...facts } = order;
  const result = await claudeJSON({ system: SYSTEM, schema: RiskSchema, effort: "low", content: `Order to assess:\n${JSON.stringify(facts, null, 2)}` });
  order.risk = { ...result, engine: "claude" };
  return order.risk;
}

export function decideOrder(id, decision) {
  const o = getOrder(id);
  if (!o) throw Object.assign(new Error("Order not found"), { status: 404 });
  if (!["SHIP", "SHIP_WITH_SIGNATURE", "HOLD_AND_VERIFY", "CANCEL"].includes(decision)) throw Object.assign(new Error("Bad decision"), { status: 400 });
  o.decision = decision;
  o.status = { SHIP: "SHIPPED", SHIP_WITH_SIGNATURE: "SHIPPED", HOLD_AND_VERIFY: "ON_HOLD", CANCEL: "CANCELLED" }[decision];
  return o;
}

export function riskStats() {
  const held = orders.filter((o) => o.status === "ON_HOLD" || o.status === "CANCELLED");
  return {
    scanned: orders.filter((o) => o.risk).length,
    high: orders.filter((o) => o.risk?.level === "HIGH").length,
    prevented: held.filter((o) => o.risk?.level === "HIGH").reduce((s, o) => s + Number(o.total), 0).toFixed(2),
  };
}
