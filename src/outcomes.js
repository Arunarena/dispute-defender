// Outcome learning: remember what the agent predicted, record what PayPal actually
// ruled, and use similar past cases to calibrate future win odds.
// All numbers are computed in code, so the agent can't talk itself into better odds.
import fs from "fs";
import path from "path";

const DATA_FILE = path.resolve("data", "outcomes.json");

export const PATTERNS = {
  NR_PHOTO: "Not received · delivered with photo proof",
  NR_SIGNED: "Not received · delivered with signature",
  NR_BARE: "Not received · delivered, no photo or signature",
  NR_TRANSIT: "Not received · still in transit",
  NAD_PARTIAL: "Not as described · partial damage",
  NAD_OTHER: "Not as described · other",
  UNAUTH_FRAUD: "Unauthorized · fraud signals",
  UNAUTH_CLEAN: "Unauthorized · clean order",
  CNP_REFUNDED: "Refund not received · refund already sent",
  CNP_OWED: "Refund not received · refund owed",
  DUP_REAL: "Duplicate charge · real double payment",
  DUP_DISTINCT: "Duplicate charge · separate orders",
  OTHER: "Other",
};

// How many "virtual cases" the agent's own estimate is worth when blended with history.
// More real cases → history counts for more.
const PRIOR_WEIGHT = 6;

// Sorts a dispute into a case pattern, using the same facts the agent sees.
export function casePattern(dispute, { order, tracking } = {}, photos = []) {
  const last = tracking?.events?.at(-1)?.detail ?? "";
  switch (dispute.reason) {
    case "MERCHANDISE_OR_SERVICE_NOT_RECEIVED": {
      if (!tracking) return "OTHER";
      if (tracking.status !== "DELIVERED") return "NR_TRANSIT";
      const carrierPhoto = photos.some((p) => p.source === "CARRIER" && p.analysis?.favors !== "BUYER");
      if (/photo/i.test(last) || carrierPhoto) return "NR_PHOTO";
      if (/signed by:/i.test(last)) return "NR_SIGNED";
      return "NR_BARE";
    }
    case "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED": {
      const text = (dispute.messages ?? []).filter((m) => m.by === "BUYER").map((m) => m.content).join(" ");
      const partial = photos.some((p) => p.source === "BUYER") || /\b(one|1 of|chipped|stain|cracked|broken)\b/i.test(text);
      return partial ? "NAD_PARTIAL" : "NAD_OTHER";
    }
    case "UNAUTHORISED": {
      let signals = 0;
      if (order && order.billingAddress !== order.shippingAddress) signals++;
      if (/forward/i.test(order?.shippingAddress ?? "")) signals++;
      if (order?.ipCountry && order.ipCountry !== "US") signals++;
      return signals >= 2 ? "UNAUTH_FRAUD" : "UNAUTH_CLEAN";
    }
    case "CREDIT_NOT_PROCESSED":
      return order?.refund?.issued ? "CNP_REFUNDED" : "CNP_OWED";
    case "DUPLICATE_TRANSACTION":
      return order?.duplicateCapture && !order.duplicateCapture.shipped ? "DUP_REAL" : "DUP_DISTINCT";
    default:
      return "OTHER";
  }
}

// ---------------- sample history ----------------
// Disputes the agent handled before outcome learning existed (raw odds only).
// Deterministic so the demo is the same every run.
function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function buildHistory() {
  const r = rng(7);
  const rows = [];
  const add = (pattern, verdict, [lo, hi], amounts, outcomes) => {
    for (const outcome of outcomes) {
      const amount = amounts[Math.floor(r() * amounts.length)];
      const raw = Math.round(lo + r() * (hi - lo));
      const offer = verdict === "OFFER_PARTIAL_REFUND" ? +(amount / 4).toFixed(2) : 0;
      rows.push({
        id: `H-${1000 + rows.length}`,
        disputeId: `PP-D-HIST-${4100 + rows.length}`,
        pattern,
        verdict,
        raw,
        odds: raw,
        amount,
        outcome,
        kept: outcome === "WON" ? amount : outcome === "SETTLED" ? +(amount - offer).toFixed(2) : 0,
        closed: new Date(Date.now() - Math.floor(5 + r() * 115) * 86400000).toISOString(),
        source: "history",
      });
    }
  };
  const W = "WON", L = "LOST", S = "SETTLED";
  add("NR_PHOTO", "FIGHT", [84, 92], [129, 89, 64], [W, W, W, W, W, L, W, W, W, W, W]);
  add("NR_SIGNED", "FIGHT", [76, 86], [129, 89, 289.99], [W, W, W, L, W, W, W, W, W, W]);
  add("NR_BARE", "FIGHT", [74, 82], [129, 89, 42.5], [L, W, L, L, W, L, W, L, L, W, L, W]);
  add("NR_TRANSIT", "SEND_MESSAGE", [85, 92], [42.5, 18, 64], [W, W, W, L, W, W, W, W]);
  add("NAD_PARTIAL", "OFFER_PARTIAL_REFUND", [30, 40], [64, 18], [S, S, L, S, S, S, L, S, S]);
  add("NAD_PARTIAL", "FIGHT", [35, 48], [64, 18], [L, L, L]);
  add("UNAUTH_FRAUD", "ACCEPT_CLAIM", [8, 15], [289.99, 219], [L, L, L, L, L, L, L]);
  add("UNAUTH_FRAUD", "FIGHT", [10, 22], [289.99, 219], [L, L, L, L]);
  add("UNAUTH_CLEAN", "FIGHT", [55, 66], [129, 89], [W, L, W, W, L, W]);
  return rows;
}

// ---------------- ledger ----------------
const history = buildHistory();
const recorded = []; // outcomes recorded since the server started (demo + live)
const pending = new Map(); // disputeId -> prediction waiting for PayPal's ruling

// Live (non-simulated) predictions and outcomes survive restarts.
try {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  recorded.push(...(saved.recorded ?? []));
  for (const p of saved.pending ?? []) pending.set(p.disputeId, p);
} catch {}

function save() {
  const keep = (x) => !x.simulated;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ recorded: recorded.filter(keep), pending: [...pending.values()].filter(keep) }, null, 2));
  } catch (err) {
    console.error("Could not save outcomes:", err.message);
  }
}

const ledger = () => [...recorded, ...history];

// Stats for one pattern: fought cases (for odds) and how often each plan worked.
function patternStats(pattern, rows = ledger()) {
  const same = rows.filter((x) => x.pattern === pattern);
  const fought = same.filter((x) => x.verdict === "FIGHT" && (x.outcome === "WON" || x.outcome === "LOST"));
  const won = fought.filter((x) => x.outcome === "WON").length;
  const avgRaw = fought.length ? fought.reduce((s, x) => s + x.raw, 0) / fought.length : null;
  return { same, fought, won, avgRaw };
}

const planWorked = (x) =>
  x.verdict === "FIGHT" ? x.outcome === "WON"
  : x.verdict === "OFFER_PARTIAL_REFUND" ? x.outcome === "SETTLED"
  : x.verdict === "SEND_MESSAGE" ? x.outcome === "WON"
  : null; // accepting a claim has no "win" to check

// Blend the agent's estimate with what actually happened in similar cases.
const blend = (raw, won, n) => Math.round(((raw / 100) * PRIOR_WEIGHT + won) / (PRIOR_WEIGHT + n) * 100);

// Adjusts a recommendation in place using the track record. Returns the calibration info.
export function calibrate(dispute, intel, photos, rec) {
  const pattern = casePattern(dispute, intel, photos);
  const { same, fought, won } = patternStats(pattern);
  const raw = Number(rec.win_likelihood) || 0;
  const n = fought.length;
  const calibrated = n ? Math.max(1, Math.min(99, blend(raw, won, n))) : raw;
  const plans = same.filter((x) => x.verdict === rec.verdict && planWorked(x) !== null);
  const worked = plans.filter(planWorked).length;
  const cal = {
    pattern,
    label: PATTERNS[pattern],
    raw,
    calibrated,
    shift: calibrated - raw,
    fought: { n, won, rate: n ? Math.round((won / n) * 100) : null },
    plan: { verdict: rec.verdict, n: plans.length, worked, rate: plans.length ? Math.round((worked / plans.length) * 100) : null },
  };
  rec.calibration = cal;
  rec.win_likelihood = calibrated;
  if (n) {
    rec.reasoning = [
      ...(rec.reasoning ?? []),
      `Track record: ${won} of ${n} similar fought cases won (${cal.fought.rate}%), so win odds were ${cal.shift === 0 ? `kept at ${calibrated}%` : `adjusted from ${raw}% to ${calibrated}%`}.`,
    ];
  }
  if (rec.verdict === "FIGHT" && n >= 4 && cal.fought.rate < 50) {
    rec.risk_flags = [...(rec.risk_flags ?? []), `Past cases like this were usually lost (${won} of ${n} won). Consider a partial refund or accepting.`];
  }
  return cal;
}

// Called when a plan is sent to PayPal: remember the prediction until PayPal rules.
export function notePrediction(dispute, rec, { simulated, pattern }) {
  const cal = rec.calibration;
  pending.set(dispute.id, {
    disputeId: dispute.id,
    pattern: pattern ?? cal?.pattern ?? "OTHER",
    verdict: rec.verdict,
    raw: cal?.raw ?? (Number(rec.win_likelihood) || 0),
    odds: Number(rec.win_likelihood) || 0,
    amount: Number(dispute.amount.value),
    offer: rec.verdict === "OFFER_PARTIAL_REFUND" ? Number(rec.offer_amount || 0) : 0,
    item: dispute.items?.[0]?.name ?? null,
    actedAt: new Date().toISOString(),
    simulated,
  });
  save();
}

export const pendingFor = (disputeId) => pending.get(disputeId) ?? null;
export const pendingIds = () => [...pending.keys()];
export const outcomeFor = (disputeId) => recorded.find((x) => x.disputeId === disputeId) ?? null;

// PayPal ruled. outcome: WON (seller keeps everything), SETTLED (partial refund), LOST.
export function recordOutcome(disputeId, outcome, { source = "paypal", refunded = null } = {}) {
  const p = pending.get(disputeId);
  if (!p) return null;
  pending.delete(disputeId);
  const kept =
    refunded != null ? Math.max(0, p.amount - Number(refunded))
    : outcome === "WON" ? p.amount
    : outcome === "SETTLED" ? p.amount - p.offer
    : 0;
  const entry = { id: `R-${Date.now().toString(36)}`, ...p, outcome, kept: +kept.toFixed(2), closed: new Date().toISOString(), source };
  entry.correct = planWorked(entry);
  recorded.unshift(entry);
  save();
  return entry;
}

// Maps PayPal's dispute_outcome to our outcome.
export function outcomeFromPayPal(code, refunded, disputed) {
  if (!code) return null;
  if (["RESOLVED_SELLER_FAVOUR", "CANCELED_BY_BUYER", "DENIED"].includes(code)) return "WON";
  const r = Number(refunded ?? 0);
  if (r > 0 && r < Number(disputed)) return "SETTLED";
  return "LOST";
}

// ---------------- track record report ----------------
const brier = (rows, pick) => rows.reduce((s, x) => s + (pick(x) / 100 - (x.outcome === "WON" ? 1 : 0)) ** 2, 0) / (rows.length || 1);

export function trackRecord() {
  const all = ledger();
  const fought = all.filter((x) => x.verdict === "FIGHT" && (x.outcome === "WON" || x.outcome === "LOST"));

  // What the calibrated odds would have been for each past case, judged without that case
  // (leave-one-out), so the comparison isn't graded on data it already saw.
  const looCalibrated = (x) => {
    const others = all.filter((y) => y !== x);
    const { fought: f, won } = patternStats(x.pattern, others);
    return f.length ? blend(x.raw, won, f.length) : x.raw;
  };
  const brierRaw = brier(fought, (x) => x.raw);
  const brierCal = brier(fought, looCalibrated);

  // Calibration chart: predicted odds (in 20-point buckets) vs. how often the seller actually won.
  const buckets = [0, 20, 40, 60, 80].map((lo) => {
    const rows = fought.filter((x) => x.raw >= lo && (x.raw < lo + 20 || (lo === 80 && x.raw <= 100)));
    const cal = fought.filter((x) => { const c = looCalibrated(x); return c >= lo && (c < lo + 20 || (lo === 80 && c <= 100)); });
    const point = (rs, pick) => rs.length ? { n: rs.length, predicted: Math.round(rs.reduce((s, x) => s + pick(x), 0) / rs.length), actual: Math.round((rs.filter((x) => x.outcome === "WON").length / rs.length) * 100) } : null;
    return { range: `${lo}–${lo + 20}%`, raw: point(rows, (x) => x.raw), calibrated: point(cal, looCalibrated) };
  });

  // Per-pattern scorecard and what the agent learned.
  const patterns = Object.keys(PATTERNS)
    .map((key) => {
      const { same, fought: f, won, avgRaw } = patternStats(key, all);
      if (!same.length) return null;
      const byVerdict = {};
      for (const x of same) {
        const w = planWorked(x);
        if (w === null) continue;
        const v = (byVerdict[x.verdict] ??= { n: 0, worked: 0 });
        v.n++;
        if (w) v.worked++;
      }
      const actual = f.length ? Math.round((won / f.length) * 100) : null;
      return {
        key,
        label: PATTERNS[key],
        cases: same.length,
        fought: f.length,
        avgPredicted: avgRaw == null ? null : Math.round(avgRaw),
        actual,
        bias: avgRaw == null ? null : Math.round(avgRaw - actual),
        byVerdict,
        kept: +same.reduce((s, x) => s + x.kept, 0).toFixed(2),
        atStake: +same.reduce((s, x) => s + x.amount, 0).toFixed(2),
      };
    })
    .filter(Boolean);

  const lessons = [];
  for (const p of patterns) {
    if (p.fought >= 4 && p.bias >= 10)
      lessons.push({ kind: "OVERCONFIDENT", pattern: p.label, text: `Was too optimistic on "${p.label}": predicted ${p.avgPredicted}% on average, actually won ${p.actual}% of ${p.fought} cases. Odds for these are now lowered.` });
    else if (p.fought >= 4 && p.bias <= -10)
      lessons.push({ kind: "UNDERCONFIDENT", pattern: p.label, text: `Was too cautious on "${p.label}": predicted ${p.avgPredicted}% on average, actually won ${p.actual}% of ${p.fought} cases. Odds for these are now raised.` });
    else if (p.fought >= 4)
      lessons.push({ kind: "CALIBRATED", pattern: p.label, text: `Predictions for "${p.label}" match reality: ${p.avgPredicted}% predicted vs. ${p.actual}% won over ${p.fought} cases.` });
    const fight = p.byVerdict.FIGHT, offer = p.byVerdict.OFFER_PARTIAL_REFUND;
    if (fight?.n >= 3 && offer?.n >= 3 && offer.worked / offer.n > fight.worked / fight.n)
      lessons.push({ kind: "STRATEGY", pattern: p.label, text: `For "${p.label}", partial refunds settled ${offer.worked} of ${offer.n} cases while fighting won ${fight.worked} of ${fight.n}. Offering first is the better play.` });
  }
  lessons.sort((a, b) => ["OVERCONFIDENT", "STRATEGY", "UNDERCONFIDENT", "CALIBRATED"].indexOf(a.kind) - ["OVERCONFIDENT", "STRATEGY", "UNDERCONFIDENT", "CALIBRATED"].indexOf(b.kind));

  const judged = all.filter((x) => planWorked(x) !== null);
  return {
    resolved: all.length,
    newSinceStart: recorded.length,
    pending: [...pending.values()],
    planSuccess: Math.round((judged.filter(planWorked).length / (judged.length || 1)) * 100),
    fought: fought.length,
    fightWinRate: Math.round((fought.filter((x) => x.outcome === "WON").length / (fought.length || 1)) * 100),
    brier: { raw: +brierRaw.toFixed(3), calibrated: +brierCal.toFixed(3), improvement: Math.round((1 - brierCal / brierRaw) * 100) },
    buckets,
    patterns,
    lessons,
    recent: all
      .slice()
      .sort((a, b) => new Date(b.closed) - new Date(a.closed))
      .slice(0, 10)
      .map((x) => ({ ...x, label: PATTERNS[x.pattern], correct: planWorked(x) })),
  };
}
