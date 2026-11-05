// Shipping address check for Risk Radar, using Google's Address Validation API.
// It reports whether an address is deliverable, residential or business, a PO box,
// or a USPS CMRA (a commercial mail-drop), which is a common sign of reshipping fraud.
import { timed } from "./integrations.js";

export const addressConfigured = () => Boolean(process.env.GOOGLE_MAPS_API_KEY);

const cache = new Map();

export async function checkAddress(address) {
  if (!addressConfigured() || !address) return null;
  if (cache.has(address)) return cache.get(address);
  // Our addresses are one line ending in a country code, like "21 Lake Rd, Madison, WI 53703, US".
  const parts = address.split(",").map((s) => s.trim());
  const regionCode = /^[A-Z]{2}$/.test(parts.at(-1)) ? parts.pop() : "US";
  const result = await timed(
    "google_address",
    "POST /v1:validateAddress",
    async () => {
      const res = await fetch(`https://addressvalidation.googleapis.com/v1:validateAddress?key=${encodeURIComponent(process.env.GOOGLE_MAPS_API_KEY)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: { regionCode, addressLines: [parts.join(", ")] }, enableUspsCass: regionCode === "US" }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Google ${res.status}: ${data.error?.message ?? "validation failed"}`);
      const r = data.result ?? {};
      const usps = r.uspsData ?? {};
      return {
        source: "google-address-validation",
        formatted: r.address?.formattedAddress ?? null,
        granularity: r.verdict?.validationGranularity ?? null,
        complete: Boolean(r.verdict?.addressComplete),
        unconfirmedParts: Boolean(r.verdict?.hasUnconfirmedComponents),
        deliverable: usps.dpvConfirmation ? usps.dpvConfirmation === "Y" : null,
        residential: r.metadata?.residential ?? null,
        business: r.metadata?.business ?? null,
        poBox: r.metadata?.poBox ?? null,
        mailDrop: usps.dpvCmra === "Y",
      };
    },
    (a) => `${a.granularity ?? "?"}${a.mailDrop ? ", mail-drop" : ""}${a.business ? ", business" : ""}${a.residential ? ", residential" : ""}`,
  );
  cache.set(address, result);
  return result;
}
