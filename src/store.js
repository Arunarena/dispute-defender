// The merchant's "back office": orders, shipments, customers and policies.
// The AI agent reads from here through its tools.
import fs from "fs";
import path from "path";
import { demoOrders, demoTracking, demoCustomers, storePolicies } from "./demoData.js";

const DATA_DIR = path.resolve("data");
const LIVE_FILE = path.join(DATA_DIR, "live-orders.json");

function loadLive() {
  try {
    return JSON.parse(fs.readFileSync(LIVE_FILE, "utf8"));
  } catch {
    return { orders: {}, tracking: {}, customers: {} };
  }
}

function saveLive(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LIVE_FILE, JSON.stringify(data, null, 2));
}

export function findOrder(transactionId) {
  const live = loadLive();
  return live.orders[transactionId] ?? demoOrders[transactionId] ?? null;
}

export function findTracking(trackingNumber) {
  const live = loadLive();
  return live.tracking[trackingNumber] ?? demoTracking[trackingNumber] ?? null;
}

export function findCustomer(email) {
  const live = loadLive();
  return live.customers[email] ?? demoCustomers[email] ?? null;
}

export function getPolicies() {
  return storePolicies;
}

// Called after a real sandbox checkout in the demo shop. We record the order
// and simulate a shipment so the agent has evidence to work with.
export function recordLiveOrder({ captureId, orderId, payerEmail, payerName, address, item }) {
  const live = loadLive();
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const trackingNumber = "9400" + String(now).slice(-18).padStart(18, "0");

  live.orders[captureId] = {
    orderId,
    placed: iso(0),
    customerEmail: payerEmail,
    shippingAddress: address,
    billingAddress: address,
    items: [{ name: item.name, sku: item.sku, price: item.price }],
    shipping: { carrier: "USPS", trackingNumber, shipped: iso(0) },
    ipCountry: "US",
  };
  live.tracking[trackingNumber] = {
    status: "DELIVERED",
    events: [
      { time: iso(0), location: "Asheville, NC", detail: "Accepted at USPS origin facility (simulated)" },
      { time: iso(0), location: "Destination", detail: "Delivered, front door/porch. Photo-on-delivery captured (simulated)" },
    ],
  };
  const existing = live.customers[payerEmail];
  live.customers[payerEmail] = {
    accountAgeDays: existing?.accountAgeDays ?? 400,
    orders: (existing?.orders ?? 0) + 1,
    totalSpent: (Number(existing?.totalSpent ?? 0) + Number(item.price)).toFixed(2),
    priorDisputes: existing?.priorDisputes ?? 0,
    notes: `Sandbox buyer ${payerName ?? ""}`.trim(),
  };
  saveLive(live);
  return { trackingNumber };
}
