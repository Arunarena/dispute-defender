// Tap-to-Confirm: NFC package tags.
// At packing time the seller writes a tag holding a signed link and puts it in the box.
// Any phone (iPhone or Android) opens the link when it touches the box, no app needed.
// The tap is recorded with time and device. The buyer can then confirm arrival or report
// a problem, which reaches the seller before it turns into a PayPal dispute.
//
// The signature stops anyone guessing other orders' links. A plain NTAG213 tag holds a fixed
// link, so a copied link could be replayed; NTAG 424 DNA tags (SUN messages) fix that in production.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { allTags, findTag, findTagsFor, saveTag } from "./store.js";
import { logCall } from "./integrations.js";

const SECRET_FILE = path.resolve("data", "nfc-secret.txt");

// Use NFC_TAG_SECRET if set. Otherwise create one and keep it, so written tags keep working after a restart.
const secret = (() => {
  if (process.env.NFC_TAG_SECRET) return process.env.NFC_TAG_SECRET;
  try {
    return fs.readFileSync(SECRET_FILE, "utf8").trim();
  } catch {
    const s = crypto.randomBytes(24).toString("hex");
    try {
      fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
      fs.writeFileSync(SECRET_FILE, s);
    } catch { /* read-only disk: tags work until restart */ }
    return s;
  }
})();

const sign = (id) => crypto.createHmac("sha256", secret).update(id).digest("base64url").slice(0, 16);
export const tokenFor = (id) => `${id}.${sign(id)}`;
export const tagUrl = (id, base) => `${base}/t/${tokenFor(id)}`;

// Returns the tag for a valid token, or null.
export function verifyToken(token) {
  const [id, sig] = String(token ?? "").split(".");
  if (!id || !sig) return null;
  const want = Buffer.from(sign(id));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  return findTag(id);
}

export function createTag({ transactionId, buyerName, items, total }) {
  const existing = findTagsFor(transactionId)[0];
  if (existing) return existing;
  const tag = {
    id: `tg-${crypto.randomBytes(5).toString("hex")}`,
    transactionId,
    label: { buyerName, items, total },
    createdAt: new Date().toISOString(),
    writtenAt: null,
    taps: [],
  };
  logCall("nfc", "create tag", { detail: `${tag.id} for ${transactionId} (${items.join(", ")})` });
  return saveTag(tag);
}

export function markWritten(id) {
  const tag = findTag(id);
  if (!tag) return null;
  tag.writtenAt = new Date().toISOString();
  logCall("nfc", "write tag (Web NFC)", { detail: `${id} written to an NFC sticker` });
  return saveTag(tag);
}

// A short device label from the user agent, without keeping the full string.
export function deviceLabel(ua = "") {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Device";
  const browser = /EdgA?\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox|FxiOS/.test(ua) ? "Firefox" : "Browser";
  return `${os} · ${browser}`;
}

// kind: OPEN (the tag was read), CONFIRM_OK, or PROBLEM.
export function recordTap(tag, { kind, device, location = null, note = null, photoUrl = null }) {
  const last = tag.taps.at(-1);
  // A page reload isn't a new tap.
  if (kind === "OPEN" && last?.kind === "OPEN" && last.device === device && Date.now() - new Date(last.time) < 2 * 60000) return { tag, tap: last, duplicate: true };
  const tap = { time: new Date().toISOString(), kind, device, ...(location && { location }), ...(note && { note: String(note).slice(0, 1000) }), ...(photoUrl && { photoUrl }) };
  tag.taps.push(tap);
  saveTag(tag);
  logCall("nfc", `tap: ${kind}`, { detail: `${tag.id} · ${device}${location ? ` · GPS ±${Math.round(location.accuracy ?? 0)} m` : ""}${note ? ` · "${String(note).slice(0, 60)}"` : ""}` });
  return { tag, tap, duplicate: false };
}

// Facts for the agent and the dossier, in plain terms.
export function tagEvidence(transactionId, deliveredAt = null) {
  const tags = findTagsFor(transactionId);
  if (!tags.length) return null;
  const t = tags[0];
  const after = (x) => (deliveredAt ? (new Date(x.time) - new Date(deliveredAt)) / 3600000 : null);
  return {
    tagId: t.id,
    writtenAtPacking: t.writtenAt,
    tapCount: t.taps.length,
    taps: t.taps.map((x) => ({ ...x, hoursAfterDelivery: after(x) == null ? null : Math.round(after(x) * 10) / 10 })),
    buyerConfirmedOk: t.taps.some((x) => x.kind === "CONFIRM_OK"),
    buyerReportedProblem: t.taps.find((x) => x.kind === "PROBLEM")?.note ?? null,
    note: "Each tap means a phone touched the NFC tag sealed inside this package. The tag link is signed per order. A plain tag's link could in theory be copied, so treat a tap as strong but not cryptographic proof.",
  };
}

export const listTags = allTags;
