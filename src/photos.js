// Photo evidence: carrier delivery photos, buyer damage photos, seller uploads.
// Claude's vision reads each photo and reports what it shows for the dispute.
import fs from "fs";
import path from "path";
import { z } from "zod";
import { claudeConfigured, claudeJSON } from "./claude.js";
import { demoPhotoAnalyses } from "./demoData.js";

const UPLOAD_DIR = path.resolve("data", "uploads");
const PUBLIC_DIR = path.resolve("public");
const MEDIA = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

// disputeId -> [{ id, url, source, label, analysis }]
const photosByDispute = new Map();
let counter = 0;

export function seedPhotos(disputeId, photos = []) {
  if (!photosByDispute.has(disputeId)) {
    photosByDispute.set(disputeId, photos.map((p) => ({ ...p, id: `ph${++counter}`, analysis: null })));
  }
}

export const listPhotos = (disputeId) => photosByDispute.get(disputeId) ?? [];

export function addUpload(disputeId, { dataUrl, label, source = "SELLER" }) {
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i.exec(dataUrl ?? "");
  if (!m) throw Object.assign(new Error("Upload a PNG, JPG, WEBP or GIF image."), { status: 400 });
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > 5 * 1024 * 1024) throw Object.assign(new Error("Image must be under 5 MB."), { status: 400 });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const id = `ph${++counter}`;
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  fs.writeFileSync(path.join(UPLOAD_DIR, `${id}.${ext}`), bytes);
  const photo = { id, url: `/uploads/${id}.${ext}`, source, label: label || "Seller upload", analysis: null };
  photosByDispute.set(disputeId, [...listPhotos(disputeId), photo]);
  return photo;
}

// Reads the image bytes behind a photo URL (sample images or uploads).
export function readPhoto(photo) {
  const file = photo.url.startsWith("/uploads/")
    ? path.join(UPLOAD_DIR, path.basename(photo.url))
    : path.join(PUBLIC_DIR, "samples", path.basename(photo.url));
  const ext = path.extname(file).slice(1).toLowerCase();
  return { bytes: fs.readFileSync(file), mediaType: MEDIA[ext] ?? "image/png", filename: path.basename(file) };
}

export const PhotoAnalysisSchema = z.object({
  summary: z.string().describe("One or two sentences: what the photo shows."),
  findings: z.array(z.string()).describe("3-5 specific, visible facts relevant to the dispute (labels, numbers, damage, location cues)."),
  favors: z.enum(["SELLER", "BUYER", "NEUTRAL"]).describe("Which side this photo supports."),
  confidence: z.number().int().min(0).max(100),
  caption: z.string().describe("Short evidence label, under 60 characters."),
});

const SYSTEM = `You are a forensic evidence analyst for e-commerce payment disputes.
Describe only what is visible in the photo. Read any text, labels, timestamps, house numbers or GPS overlays exactly.
Then judge whether the photo supports the seller's or the buyer's side of this specific dispute. Be neutral and precise.`;

export async function analyzePhoto(dispute, photo, order) {
  if (!claudeConfigured()) {
    const canned = demoPhotoAnalyses[path.basename(photo.url)];
    photo.analysis = canned
      ? { ...canned, engine: "scripted-demo" }
      : {
          summary: "Demo mode can't read new photos. Add ANTHROPIC_API_KEY to use Claude vision.",
          findings: [],
          favors: "NEUTRAL",
          confidence: 0,
          caption: photo.label,
          engine: "scripted-demo",
        };
    await new Promise((r) => setTimeout(r, 1800)); // keep the scan animation visible
    return photo.analysis;
  }

  const { bytes, mediaType } = readPhoto(photo);
  const context = `Dispute ${dispute.id}: ${dispute.reason} (${dispute.stage}), ${dispute.amount.value} ${dispute.amount.currency}.
Items: ${dispute.items.map((i) => i.name).join(", ")}.
Buyer says: ${dispute.messages.filter((m) => m.by === "BUYER").map((m) => m.content).join(" / ") || "(no message)"}
${order ? `Order ships to: ${order.shippingAddress}. Carrier: ${order.shipping?.carrier} ${order.shipping?.trackingNumber}.` : ""}
Photo source: ${photo.source} (${photo.label}).`;

  const result = await claudeJSON({
    system: SYSTEM,
    schema: PhotoAnalysisSchema,
    effort: "medium",
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: bytes.toString("base64") } },
      { type: "text", text: context },
    ],
  });
  photo.analysis = { ...result, engine: "claude" };
  return photo.analysis;
}
