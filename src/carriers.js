// Carrier tracking. With SHIPPO_API_KEY set, tracking comes live from the carrier through
// Shippo's universal tracking API. Without it, the store's own records are used.
import { findTracking, cacheTracking } from "./store.js";
import { timed } from "./integrations.js";

export const shippoConfigured = () => Boolean(process.env.SHIPPO_API_KEY);
// A shippo_test_ key only knows Shippo's test numbers (SHIPPO_DELIVERED, SHIPPO_TRANSIT, ...).
export const shippoTestMode = () => String(process.env.SHIPPO_API_KEY ?? "").startsWith("shippo_test_");

const SHIPPO_CARRIER = { USPS: "usps", UPS: "ups", FEDEX: "fedex", DHL: "dhl_express", DHL_API: "dhl_express", ONTRAC: "ontrac", LASERSHIP: "lasership", CANADA_POST: "canada_post", SHIPPO: "shippo" };
const STATUS = { DELIVERED: "DELIVERED", TRANSIT: "IN_TRANSIT", PRE_TRANSIT: "LABEL_CREATED", RETURNED: "RETURNED", FAILURE: "EXCEPTION", UNKNOWN: "UNKNOWN" };

const place = (l) => (l ? [l.city, l.state, l.country].filter(Boolean).join(", ") : "");
const toEvent = (s) => ({ time: s.status_date, location: place(s.location) || "-", detail: s.status_details || s.status });

async function shippoTrack(carrier, number) {
  const code = SHIPPO_CARRIER[String(carrier).toUpperCase()] ?? String(carrier).toLowerCase();
  const res = await fetch(`https://api.goshippo.com/tracks/${encodeURIComponent(code)}/${encodeURIComponent(number)}`, {
    headers: { Authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}` },
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Shippo ${res.status}: ${data.detail || data.message || "lookup failed"}`);
  if (!data.tracking_status) throw new Error("Carrier has no scans for this number yet");
  const history = (data.tracking_history ?? []).map(toEvent);
  if (!history.length) history.push(toEvent(data.tracking_status));
  return {
    status: STATUS[data.tracking_status.status] ?? data.tracking_status.status,
    events: history.sort((a, b) => new Date(a.time) - new Date(b.time)),
    eta: data.eta ?? null,
    deliveredTo: place(data.address_to) || null,
    source: `shippo (${code})`,
  };
}

// Tracking for the agent. Live lookups are cached into the store so other parts of the app agree.
export async function trackShipment(carrier, number) {
  const stored = findTracking(number);
  if (!shippoConfigured()) return stored;
  try {
    const live = await timed("shippo", `GET /tracks/${carrier}/${number}`, () => shippoTrack(carrier, number), (t) => `${t.status}, ${t.events.length} scans`);
    // Carriers answer UNKNOWN for numbers they've never seen (like the demo's sample numbers): keep our record.
    if (live.status === "UNKNOWN" && stored) return { ...stored, liveLookup: "carrier has no scans for this number" };
    cacheTracking(number, live);
    return live;
  } catch (err) {
    // Keep going on the store's record, and tell the agent the live check failed.
    return stored ? { ...stored, liveLookup: `failed: ${err.message}` } : { error: `Carrier lookup failed: ${err.message}` };
  }
}
