// Evidence dossier: a professional PDF that bundles everything supporting the
// seller's case. It's shown to the seller and attached to PayPal evidence.
import PDFDocument from "pdfkit";
import { getPolicies } from "./store.js";
import { readPhoto } from "./photos.js";

const C = { ink: "#14213d", muted: "#5b6782", line: "#dde3ef", navy: "#0b1426", cyan: "#0aa5c2", green: "#109868", red: "#c0392b", amber: "#b26a00", soft: "#f3f6fc" };
const VERDICT = {
  FIGHT: ["SELLER CONTESTS THIS CLAIM", C.green],
  OFFER_PARTIAL_REFUND: ["SELLER OFFERS A PARTIAL REFUND", C.cyan],
  ACCEPT_CLAIM: ["SELLER ACCEPTS THIS CLAIM", C.red],
  SEND_MESSAGE: ["SELLER RESPONSE TO INQUIRY", C.cyan],
};
// pdfkit's built-in fonts only cover basic Latin, so strip anything else.
const clean = (s) => String(s ?? "").replace(/[≥]/g, ">=").replace(/[≤]/g, "<=").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\x7E\n·•]/g, "");
const date = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "-");

export function buildDossier({ dispute: d, intel, photos, recommendation: rec }) {
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: `Evidence dossier ${d.id}`, Author: "Dispute Defender" } });
  const W = doc.page.width - 96;
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const ensure = (h) => { if (doc.y + h > doc.page.height - 70) doc.addPage(); };
  const section = (n, title) => {
    ensure(60);
    doc.moveDown(0.8);
    doc.fillColor(C.cyan).font("Helvetica-Bold").fontSize(8).text(`SECTION ${n}`, { characterSpacing: 1.5 });
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(14).text(title);
    doc.moveTo(48, doc.y + 3).lineTo(48 + W, doc.y + 3).strokeColor(C.line).lineWidth(1).stroke();
    doc.moveDown(0.6);
  };
  const body = (t, opts = {}) => doc.fillColor(opts.color ?? C.ink).font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.size ?? 10).text(clean(t), opts);
  const rows = (pairs) => {
    for (const [k, v] of pairs) {
      ensure(22);
      const y = doc.y;
      doc.fillColor(C.muted).font("Helvetica").fontSize(9).text(k, 48, y, { width: 150 });
      doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(10).text(clean(v), 200, y, { width: W - 152 });
      doc.y = Math.max(doc.y, y + 14) + 4;
    }
    doc.x = 48;
  };

  // ---- cover band ----
  doc.rect(0, 0, doc.page.width, 128).fill(C.navy);
  doc.fillColor("#2bffb1").font("Helvetica-Bold").fontSize(9).text("DISPUTE DEFENDER  ·  EVIDENCE DOSSIER", 48, 38, { characterSpacing: 2 });
  doc.fillColor("#ffffff").fontSize(22).text(clean(d.items.map((i) => i.name).join(", ") || "Disputed transaction"), 48, 56, { width: W });
  doc.fillColor("#9fb3d9").font("Helvetica").fontSize(10).text(`PayPal case ${d.id}   ·   Prepared ${date(new Date().toISOString())}`, 48, 98);
  doc.y = 150;

  if (rec) {
    const [label, color] = VERDICT[rec.verdict] ?? VERDICT.FIGHT;
    doc.roundedRect(48, doc.y, W, 62, 8).fillAndStroke(C.soft, color);
    doc.fillColor(color).font("Helvetica-Bold").fontSize(9).text(label, 64, doc.y + 12, { characterSpacing: 1.2 });
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(12).text(clean(rec.headline), 64, doc.y + 4, { width: W - 32 });
    doc.y = Math.max(doc.y, 150 + 62) + 10;
    doc.x = 48;
  }

  // ---- 1. case summary ----
  section(1, "Case summary");
  rows([
    ["PayPal dispute ID", d.id],
    ["PayPal transaction ID", d.transactionId ?? "-"],
    ["Dispute reason", d.reason.replaceAll("_", " ").toLowerCase()],
    ["Stage / status", `${d.stage} / ${d.status.replaceAll("_", " ")}`],
    ["Amount disputed", `${Number(d.amount.value).toFixed(2)} ${d.amount.currency}`],
    ["Buyer", d.buyerName],
    ["Store order", intel?.order ? `${intel.order.orderId}, placed ${date(intel.order.placed)}` : "not found"],
    ["Response due", date(d.sellerResponseDue)],
  ]);
  const buyerMsg = d.messages.find((m) => m.by === "BUYER");
  if (buyerMsg) {
    ensure(50);
    doc.moveDown(0.4);
    body("Buyer's claim:", { color: C.muted, size: 9 });
    body(`"${buyerMsg.content}"`, { size: 10, oblique: true });
  }

  // ---- 2. seller's position ----
  if (rec) {
    section(2, "Seller's position");
    for (const r of rec.reasoning ?? []) { ensure(30); body(`•  ${r}`, { width: W, paragraphGap: 4 }); }
    if (rec.response_text) {
      ensure(80);
      doc.moveDown(0.4);
      const y = doc.y;
      const h = doc.heightOfString(clean(rec.response_text), { width: W - 28 }) + 20;
      doc.roundedRect(48, y, W, h, 6).fill(C.soft);
      doc.fillColor(C.ink).font("Helvetica").fontSize(10).text(clean(rec.response_text), 62, y + 10, { width: W - 28 });
      doc.y = y + h + 4;
      doc.x = 48;
    }
  }

  // ---- 3. shipment ----
  if (intel?.tracking) {
    section(3, `Shipment and delivery (${intel.order?.shipping?.carrier ?? "carrier"} ${intel.order?.shipping?.trackingNumber ?? ""})`);
    const evs = intel.tracking.events;
    ensure(Math.min(evs.length * 40 + 30, 400)); // keep the timeline on one page
    evs.forEach((e, i) => {
      ensure(40);
      const y = doc.y;
      const last = i === evs.length - 1;
      if (!last) doc.moveTo(58, y + 10).lineTo(58, y + 36).strokeColor(C.line).lineWidth(2).stroke();
      doc.circle(58, y + 6, 5).fill(last ? (intel.tracking.status === "DELIVERED" ? C.green : C.amber) : C.cyan);
      doc.fillColor(C.muted).font("Helvetica").fontSize(8.5).text(`${date(e.time)}  ·  ${clean(e.location)}`, 74, y);
      doc.fillColor(C.ink).font(last ? "Helvetica-Bold" : "Helvetica").fontSize(10).text(clean(e.detail), 74, doc.y + 1, { width: W - 30 });
      doc.y += 8;
    });
    doc.x = 48;
    body(`Final carrier status: ${intel.tracking.status}`, { bold: true, color: intel.tracking.status === "DELIVERED" ? C.green : C.amber });
  }

  // ---- 4. address verification ----
  if (intel?.order) {
    section(4, "Address verification");
    const same = intel.order.shippingAddress === intel.order.billingAddress;
    rows([
      ["Shipping address", intel.order.shippingAddress],
      ["Billing address", intel.order.billingAddress],
      ["Match", same ? "Yes, addresses are identical" : "NO, addresses differ"],
      ["Order IP country", intel.order.ipCountry ?? "-"],
    ]);
  }

  // ---- 5. photos ----
  const usable = (photos ?? []).filter((p) => p.analysis);
  if (usable.length) {
    section(5, "Photo evidence (analyzed with AI vision)");
    for (const p of usable) {
      ensure(230);
      const y = doc.y;
      try {
        const { bytes, mediaType } = readPhoto(p);
        if (/png|jpe?g/.test(mediaType)) doc.image(bytes, 48, y, { fit: [220, 165] });
      } catch { /* image unavailable */ }
      const x = 284;
      doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(8).text(`${p.source} PHOTO  ·  SUPPORTS ${p.analysis.favors}  ·  ${p.analysis.confidence}% CONFIDENCE`, x, y, { width: W - 236 });
      doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(11).text(clean(p.analysis.caption), x, doc.y + 3, { width: W - 236 });
      for (const f of p.analysis.findings ?? []) doc.font("Helvetica").fontSize(9).fillColor(C.ink).text(`•  ${clean(f)}`, x, doc.y + 2, { width: W - 236 });
      doc.y = Math.max(doc.y, y + 170) + 10;
      doc.x = 48;
    }
  }

  // ---- 6. policy ----
  section(usable.length ? 6 : 5, "Store policies on record");
  // Internal notes (margins, costs) stay private: only customer-facing policies go to PayPal.
  const publicPolicies = getPolicies().split("\n").filter((l) => !/margin|cost to us/i.test(l)).join("\n");
  body(publicPolicies, { size: 9, color: C.muted, width: W });

  // ---- footer on every page ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // let the footer sit below the normal margin without adding a page
    doc.fillColor(C.muted).font("Helvetica").fontSize(7.5)
      .text(`Dispute Defender evidence dossier  ·  ${d.id}  ·  Facts sourced from carrier tracking, store order records and submitted photos. Analysis prepared with AI assistance.`, 48, doc.page.height - 40, { width: W - 50, lineBreak: false })
      .text(`${i + 1} / ${range.count}`, 48 + W - 40, doc.page.height - 40, { width: 40, align: "right" });
  }
  doc.end();
  return done;
}
