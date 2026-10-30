// Defender Copilot: a voice/chat assistant that answers questions about your
// disputes and drives the app. It can read data and navigate, but never moves
// money: fights and refunds still need the seller's approval in the app.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { MODEL, claudeConfigured, getClient, FALLBACK_PARAMS } from "./claude.js";

const SYSTEM = `You are Defender Copilot, the voice assistant inside Dispute Defender, an app that helps a small online store handle PayPal disputes.
Your replies are read aloud, so answer in 1-3 short, natural spoken sentences. No markdown, no bullet lists, no IDs unless asked; say amounts like "$129".
Use the data tools to answer questions accurately. Use the action tools to do what the user asks in the app (open a dispute, run an investigation, open negotiation, switch views, toggle Autopilot, simulate a dispute).
You cannot send anything to PayPal or move money yourself. If the user asks to fight, refund or settle, start the investigation or negotiation and tell them to approve the result on screen.
When the user refers to a dispute by product or buyer name ("the headphones", "Priya"), find its ID with list_disputes first.`;

// ctx: { disputes(), dispute(id), overview(), orders() }
function buildTools(ctx, actions) {
  const act = (type, extra = {}) => { actions.push({ type, ...extra }); return `Done: ${type} queued in the app.`; };
  return [
    betaZodTool({ name: "list_disputes", description: "List all disputes with ID, buyer, item, amount, reason, stage, status, days left, and the AI verdict if one exists.", inputSchema: z.object({}), run: async () => JSON.stringify(await ctx.disputes()) }),
    betaZodTool({ name: "get_dispute", description: "Full details of one dispute: messages, order, tracking, buyer history, AI recommendation.", inputSchema: z.object({ dispute_id: z.string() }), run: async ({ dispute_id }) => JSON.stringify(await ctx.dispute(dispute_id)) }),
    betaZodTool({ name: "get_overview", description: "Totals: open disputes, money at stake, revenue protected, recent actions, Autopilot rules, Risk Radar stats.", inputSchema: z.object({}), run: async () => JSON.stringify(await ctx.overview()) }),
    betaZodTool({ name: "list_orders", description: "Recent orders awaiting shipment with their fraud risk scores (Risk Radar).", inputSchema: z.object({}), run: async () => JSON.stringify(ctx.orders()) }),
    betaZodTool({ name: "open_dispute", description: "Show a dispute on screen.", inputSchema: z.object({ dispute_id: z.string() }), run: async ({ dispute_id }) => act("open_dispute", { id: dispute_id }) }),
    betaZodTool({ name: "run_investigation", description: "Open a dispute and start the AI investigation on screen. The seller reviews and approves the result.", inputSchema: z.object({ dispute_id: z.string() }), run: async ({ dispute_id }) => act("analyze", { id: dispute_id }) }),
    betaZodTool({ name: "open_negotiation", description: "Open the negotiation arena for an inquiry-stage dispute.", inputSchema: z.object({ dispute_id: z.string() }), run: async ({ dispute_id }) => act("negotiate", { id: dispute_id }) }),
    betaZodTool({ name: "show_view", description: "Switch the main screen.", inputSchema: z.object({ view: z.enum(["disputes", "radar", "insights"]) }), run: async ({ view }) => act("view", { view }) }),
    betaZodTool({ name: "set_autopilot", description: "Turn Autopilot on or off.", inputSchema: z.object({ enabled: z.boolean() }), run: async ({ enabled }) => act("autopilot", { enabled }) }),
    betaZodTool({ name: "simulate_dispute", description: "Simulate a new dispute arriving from PayPal (demo).", inputSchema: z.object({}), run: async () => act("simulate") }),
  ];
}

export async function askCopilot(history, ctx) {
  const actions = [];
  if (!claudeConfigured()) return { reply: await scripted(history.at(-1)?.text ?? "", ctx, actions), actions, engine: "scripted-demo" };

  const messages = history.slice(-10).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }));
  const runner = getClient().beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 4000,
    max_iterations: 8,
    output_config: { effort: "low" },
    ...FALLBACK_PARAMS,
    system: SYSTEM,
    tools: buildTools(ctx, actions),
    messages,
  });
  const final = await runner.runUntilDone();
  if (final.stop_reason === "refusal") return { reply: "Sorry, I can't help with that one.", actions: [], engine: MODEL };
  const reply = final.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
  return { reply: reply || "Done.", actions, engine: MODEL };
}

// ---------- keyless demo: simple intent matching ----------
async function scripted(text, ctx, actions) {
  const t = text.toLowerCase();
  const list = await ctx.disputes();
  const open = list.filter((d) => !d.done);
  const find = () =>
    list.find((d) => [d.item, d.buyerName, d.id].some((s) => s && s.toLowerCase().split(/[\s(),-]+/).some((w) => w.length > 3 && t.includes(w))));
  const money = (n) => `$${Number(n).toFixed(0)}`;

  if (/brief|summary|morning|status|what.*(going on|happening)|overview/.test(t)) {
    const ov = await ctx.overview();
    const urgent = [...open].sort((a, b) => a.daysLeft - b.daysLeft)[0];
    const fraud = open.find((d) => d.reason === "UNAUTHORISED");
    const fraudNote = fraud ? (fraud.id === urgent?.id ? " It also looks like stolen-account fraud." : ` ${fraud.buyerName}'s ${fraud.item} looks like fraud.`) : "";
    const savedNote = Number(ov.saved) > 0 ? ` So far I've protected ${money(ov.saved)}.` : "";
    const radar = ov.riskRadar.high ? ` Risk Radar flagged ${ov.riskRadar.high} risky orders.` : "";
    return `You have ${open.length} open disputes with ${money(ov.atStake)} at stake. Most urgent is ${urgent?.buyerName}'s ${urgent?.item}, with ${urgent?.daysLeft} days left.${fraudNote}${radar}${savedNote}`;
  }
  if (/autopilot/.test(t)) {
    const on = !/off|disable|stop/.test(t);
    actions.push({ type: "autopilot", enabled: on });
    return on ? "Autopilot is on. New disputes will be handled within your rules." : "Autopilot is off. Every dispute will wait for you.";
  }
  if (/simulat|new dispute|incoming/.test(t)) { actions.push({ type: "simulate" }); return "Simulating a new dispute from PayPal now."; }
  if (/radar|order|fraud check|ship/.test(t) && !/dispute/.test(t)) {
    actions.push({ type: "view", view: "radar" });
    const risky = ctx.orders().filter((o) => o.risk?.level === "HIGH");
    return risky.length ? `Opening Risk Radar. ${risky.length} orders look high risk, so hold them before shipping.` : "Opening Risk Radar. I'll score every order awaiting shipment.";
  }
  if (/insight|losing|leak|report|why/.test(t)) { actions.push({ type: "view", view: "insights" }); return "Opening Insights. Here's where disputes are costing you money and how to fix it."; }
  if (/due|deadline|urgent|soon/.test(t)) {
    const s = [...open].sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 2);
    return `Most urgent: ${s.map((d) => `${d.buyerName}'s ${d.item}, ${d.daysLeft} days left`).join(", and ")}.`;
  }
  const d = find();
  if (d && /negotiat|offer|settle|deal/.test(t)) {
    if (d.stage !== "INQUIRY") { actions.push({ type: "open_dispute", id: d.id }); return `${d.buyerName}'s dispute is past the inquiry stage, so PayPal won't allow offers. I've opened it so you can fight or accept.`; }
    actions.push({ type: "negotiate", id: d.id });
    return `Opening the negotiation arena for ${d.buyerName}'s ${d.item}. Approve the deal when you're happy.`;
  }
  if (d && /fight|analy|investigat|check|look|handle|deal with/.test(t)) {
    actions.push({ type: "analyze", id: d.id });
    return `On it. Investigating ${d.buyerName}'s ${d.item} dispute now. Review my recommendation and approve it on screen.`;
  }
  if (d) { actions.push({ type: "open_dispute", id: d.id }); return `Here's ${d.buyerName}'s ${d.item} dispute for ${money(d.amount)}.`; }
  if (/risk|fraud|worst|dangerous/.test(t)) {
    const f = open.find((x) => x.reason === "UNAUTHORISED") ?? open[0];
    if (f) actions.push({ type: "open_dispute", id: f.id });
    return f ? `The riskiest is ${f.buyerName}'s ${f.item} for ${money(f.amount)}. It has the classic signs of stolen-account fraud.` : "No risky disputes right now.";
  }
  return `I can brief you, find urgent disputes, investigate or negotiate one, open Risk Radar or Insights, or switch Autopilot on. Try "brief me" or "fight the headphones dispute". (Demo mode: add a Claude API key for full conversations.)`;
}
