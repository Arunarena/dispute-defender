// Insights: where is the store losing money to disputes, and what would fix it?
// Numbers are computed in code; Claude only interprets them (so it can't invent data).
import { z } from "zod";
import { claudeConfigured, claudeJSON } from "./claude.js";

// Deterministic pseudo-random generator so the demo history is the same every run.
function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

// 90 days of sample dispute history, with real-world patterns baked in.
function buildHistory() {
  const r = rng(42);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const rows = [];
  const add = (n, spec) => {
    for (let i = 0; i < n; i++) {
      const s = typeof spec === "function" ? spec() : spec;
      rows.push({ daysAgo: Math.floor(r() * 90), ...s });
    }
  };
  // Mugs: damage in transit, mostly refunded.
  add(14, () => ({ product: "Ceramic Mug Set", reason: "NOT_AS_DESCRIBED", amount: 64, outcome: pick(["LOST", "LOST", "SETTLED", "SETTLED", "LOST"]), cause: "Damaged in transit" }));
  // Electronics fraud via forwarders.
  add(9, () => ({ product: pick(["Pulse X2 Smartwatch", "Nova Pro Gaming Headset"]), reason: "UNAUTHORISED", amount: pick([289.99, 219]), outcome: "LOST", cause: "Freight forwarder fraud" }));
  // Delivered, no signature: "not received" claims.
  add(12, () => ({ product: pick(["Aurora ANC Headphones", "Boombox Mini Speaker", "Pulse X2 Smartwatch"]), reason: "NOT_RECEIVED", amount: pick([129, 89, 289.99]), outcome: pick(["WON", "LOST", "LOST", "WON", "LOST"]), cause: "Delivered without signature" }));
  // Missed deadlines: lost by default.
  add(6, () => ({ product: pick(["Organic Tote Bag", "Linen Napkins", "Aurora ANC Headphones"]), reason: pick(["NOT_RECEIVED", "NOT_AS_DESCRIBED"]), amount: pick([42.5, 18, 129]), outcome: "LOST", cause: "No response before deadline" }));
  // Genuine slow shipping.
  add(5, () => ({ product: pick(["Organic Tote Bag", "Linen Napkins"]), reason: "NOT_RECEIVED", amount: pick([42.5, 18]), outcome: pick(["WON", "SETTLED"]), cause: "Carrier delay" }));
  return rows.sort((a, b) => b.daysAgo - a.daysAgo);
}

const history = buildHistory();

export function computeInsights() {
  const lostAmount = (row) => (row.outcome === "LOST" ? row.amount : row.outcome === "SETTLED" ? row.amount * 0.4 : 0);
  const total = history.reduce((s, x) => s + x.amount, 0);
  const lost = history.reduce((s, x) => s + lostAmount(x), 0);
  const group = (key) => {
    const m = new Map();
    for (const x of history) {
      const g = m.get(x[key]) ?? { key: x[key], count: 0, disputed: 0, lost: 0, won: 0 };
      g.count++;
      g.disputed += x.amount;
      g.lost += lostAmount(x);
      if (x.outcome === "WON") g.won++;
      m.set(x[key], g);
    }
    return [...m.values()].map((g) => ({ ...g, disputed: +g.disputed.toFixed(2), lost: +g.lost.toFixed(2), winRate: Math.round((g.won / g.count) * 100) })).sort((a, b) => b.lost - a.lost);
  };
  // Weekly lost money, oldest first (13 weeks).
  const weeks = Array.from({ length: 13 }, (_, i) => ({ week: i + 1, lost: 0, count: 0 }));
  for (const x of history) {
    const w = 12 - Math.min(12, Math.floor(x.daysAgo / 7));
    weeks[w].lost += lostAmount(x);
    weeks[w].count++;
  }
  weeks.forEach((w) => (w.lost = +w.lost.toFixed(2)));
  const outcomes = ["WON", "SETTLED", "LOST"].map((o) => ({ outcome: o, count: history.filter((x) => x.outcome === o).length }));
  return {
    period: "last 90 days (sample history)",
    disputes: history.length,
    disputedAmount: +total.toFixed(2),
    lostAmount: +lost.toFixed(2),
    winRate: Math.round((history.filter((x) => x.outcome === "WON").length / history.length) * 100),
    byCause: group("cause"),
    byProduct: group("product"),
    outcomes,
    weeks,
  };
}

export const ReportSchema = z.object({
  headline: z.string().describe("One sentence: the single biggest money leak and its size."),
  findings: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string().describe("What the data shows, citing the numbers given."),
        fix: z.string().describe("A concrete operational change the seller can make this week."),
        monthly_savings: z.number().describe("Estimated $ saved per month if fixed, derived from the numbers given."),
        effort: z.enum(["LOW", "MEDIUM", "HIGH"]),
      }),
    )
    .describe("3-4 findings, biggest savings first."),
});

const SYSTEM = `You are a profitability consultant for a small online store that sells through PayPal.
You get aggregated dispute statistics (already computed, don't recompute or invent numbers).
Find where the store is losing money to disputes and recommend concrete, practical fixes.
Savings estimates must be derived from the given 90-day loss numbers (divide by 3 for monthly) times a realistic fix rate.`;

let cached = null;

export async function buildReport() {
  const data = computeInsights();
  if (cached && cached.engine === (claudeConfigured() ? "claude" : "scripted-demo")) return { data, report: cached };
  if (!claudeConfigured()) {
    await new Promise((r) => setTimeout(r, 1500));
    const c = Object.fromEntries(data.byCause.map((g) => [g.key, g]));
    const m = (k, rate) => Math.round(((c[k]?.lost ?? 0) / 3) * rate);
    const $ = (k) => `$${Math.round(c[k]?.lost ?? 0).toLocaleString("en-US")}`;
    cached = {
      engine: "scripted-demo",
      headline: `Freight-forwarder fraud and transit damage cost you $${Math.round((c["Freight forwarder fraud"]?.lost ?? 0) + (c["Damaged in transit"]?.lost ?? 0)).toLocaleString("en-US")} in 90 days, over half of all dispute losses.`,
      findings: [
        { title: "Electronics shipped to freight forwarders", detail: `${c["Freight forwarder fraud"]?.count} unauthorized-payment claims, all lost, ${$("Freight forwarder fraud")} gone. Every one shipped to a forwarding warehouse.`, fix: "Turn on Risk Radar holds for forwarder addresses and verify the buyer before shipping electronics.", monthly_savings: m("Freight forwarder fraud", 0.9), effort: "LOW" },
        { title: "Mugs breaking in the post", detail: `${c["Damaged in transit"]?.count} 'not as described' claims on the mug set, mostly chips, ${$("Damaged in transit")} lost or refunded.`, fix: "Double-box mug sets with molded pulp inserts (about $1.20 extra per order).", monthly_savings: m("Damaged in transit", 0.75), effort: "LOW" },
        { title: "Deliveries without a signature", detail: `${c["Delivered without signature"]?.count} 'not received' claims on delivered parcels; only ${c["Delivered without signature"]?.winRate}% won because there was no signature.`, fix: "Require signature confirmation on orders over $150.", monthly_savings: m("Delivered without signature", 0.6), effort: "LOW" },
        { title: "Missed response deadlines", detail: `${c["No response before deadline"]?.count} disputes were lost by default because nobody answered in time (${$("No response before deadline")}).`, fix: "Enable Autopilot so every new dispute is analyzed the minute it arrives.", monthly_savings: m("No response before deadline", 1), effort: "LOW" },
      ],
    };
    return { data, report: cached };
  }
  const result = await claudeJSON({ system: SYSTEM, schema: ReportSchema, effort: "medium", content: `Dispute statistics:\n${JSON.stringify(data, null, 2)}` });
  cached = { ...result, engine: "claude" };
  return { data, report: cached };
}
