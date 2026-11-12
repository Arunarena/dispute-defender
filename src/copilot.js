// Defender Copilot: a voice/chat assistant that answers questions about your
// disputes and drives the app. It can read data and navigate, but never moves
// money: fights and refunds still need the seller's approval in the app.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { MODEL, claudeConfigured, getClient, FALLBACK_PARAMS } from "./claude.js";

const SYSTEM = `You are Defender Copilot, the voice assistant inside Dispute Defender, an app that helps a small online store handle PayPal disputes.
Your replies are read aloud, so talk like a sharp, friendly teammate: 1-3 short spoken sentences, contractions, plain words, and vary your phrasing. Refer to cases by buyer and product ("Jordan's headphones"), never by ID unless asked. Say amounts like "$129". No markdown or lists. When it helps, end with a short offer such as "Want me to dig into it?" and treat a following "yes" as agreement.
Use the data tools to answer questions accurately. Use the action tools to do what the user asks in the app (triage every dispute at once, open a dispute, run an investigation, open negotiation, switch views, toggle Autopilot, simulate a dispute).
You cannot send anything to PayPal or move money yourself. If the user asks to fight, refund or settle, start the investigation or negotiation and tell them to approve the result on screen.
When the user refers to a dispute by product or buyer name ("the headphones", "Priya"), find its ID with list_disputes first.`;

// ctx: { disputes(), dispute(id), overview(), orders() }
function buildTools(ctx, actions) {
  const act = (type, extra = {}) => { actions.push({ type, ...extra }); return `Done: ${type} queued in the app.`; };
  return [
    betaZodTool({ name: "list_disputes", description: "List all disputes with ID, buyer, item, amount, reason, stage, status, days left, and the AI verdict if one exists.", inputSchema: z.object({}), run: async () => JSON.stringify(await ctx.disputes()) }),
    betaZodTool({ name: "get_dispute", description: "Full details of one dispute: messages, order, tracking, buyer history, AI recommendation.", inputSchema: z.object({ dispute_id: z.string() }), run: async ({ dispute_id }) => JSON.stringify(await ctx.dispute(dispute_id)) }),
    betaZodTool({ name: "get_overview", description: "Totals: open disputes, money at stake, revenue protected, recent actions, Autopilot rules, Risk Radar stats, and the agent's track record (how often its plans worked and what it learned from past rulings).", inputSchema: z.object({}), run: async () => JSON.stringify(await ctx.overview()) }),
    betaZodTool({ name: "list_orders", description: "Recent orders awaiting shipment with their fraud risk scores (Risk Radar).", inputSchema: z.object({}), run: async () => JSON.stringify(ctx.orders()) }),
    betaZodTool({ name: "open_dispute", description: "Show a dispute on screen.", inputSchema: z.object({ dispute_id: z.string() }), run: async ({ dispute_id }) => act("open_dispute", { id: dispute_id }) }),
    betaZodTool({ name: "run_investigation", description: "Open a dispute and start the AI investigation on screen. The seller reviews and approves the result.", inputSchema: z.object({ dispute_id: z.string() }), run: async ({ dispute_id }) => act("analyze", { id: dispute_id }) }),
    betaZodTool({ name: "open_negotiation", description: "Open the negotiation arena for an inquiry-stage dispute.", inputSchema: z.object({ dispute_id: z.string() }), run: async ({ dispute_id }) => act("negotiate", { id: dispute_id }) }),
    betaZodTool({ name: "show_view", description: "Switch the main screen: disputes, radar (Risk Radar), insights, track (Track Record: prediction accuracy and what the agent learned from past PayPal rulings), or integrations (which outside APIs are live: PayPal tracking/refunds/transaction search, Shippo, Google address check, Slack/Discord/Zapier alerts, deadline calendar).", inputSchema: z.object({ view: z.enum(["disputes", "radar", "insights", "track", "integrations"]) }), run: async ({ view }) => act("view", { view }) }),
    betaZodTool({ name: "set_autopilot", description: "Turn Autopilot on or off.", inputSchema: z.object({ enabled: z.boolean() }), run: async ({ enabled }) => act("autopilot", { enabled }) }),
    betaZodTool({ name: "triage_all", description: "Run the AI investigation on every open dispute at once and show the morning briefing with a plan for each. Nothing is sent to PayPal.", inputSchema: z.object({}), run: async () => act("triage") }),
    betaZodTool({ name: "simulate_dispute", description: "Simulate a new dispute arriving from PayPal (demo).", inputSchema: z.object({}), run: async () => act("simulate") }),
  ];
}

export async function askCopilot(history, ctx) {
  const actions = [];
  if (!claudeConfigured()) return { reply: await scripted(history, ctx, actions), actions, engine: "scripted-demo" };

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

// ---------- keyless demo: a conversational stand-in for Claude ----------
// Remembers which case you're talking about, understands "yes, do it",
// handles small talk, and varies its wording so it doesn't sound canned.
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const money = (n) => `$${Math.round(Number(n))}`;
const first = (name = "") => name.split(" ")[0];
const REASON = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "says it never arrived",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "says it wasn't as described",
  UNAUTHORISED: "says they never made the purchase",
  DUPLICATE_TRANSACTION: "says they were charged twice",
  CREDIT_NOT_PROCESSED: "says their refund never came through",
};
const VERDICT_WORDS = { FIGHT: "fight it", OFFER_PARTIAL_REFUND: "offer a partial refund", ACCEPT_CLAIM: "accept it", SEND_MESSAGE: "send the buyer a message" };
const days = (n) => (n == null ? "no deadline yet" : n <= 0 ? "due today" : n === 1 ? "1 day left" : `${n} days left`);

// Which dispute a piece of text points at, by buyer name or product word.
function matchDispute(text, list) {
  const t = ` ${text.toLowerCase()} `;
  const STOP = new Set(["pack", "with", "wireless", "handmade", "organic", "cotton", "mini", "set", "mugs"]);
  let best = null, bestScore = 0;
  for (const d of list) {
    let score = 0;
    const name = (d.buyerName ?? "").toLowerCase();
    if (name && t.includes(first(name))) score += 3;
    if (d.id && t.includes(d.id.toLowerCase())) score += 5;
    for (const w of (d.item ?? "").toLowerCase().split(/[\s(),-]+/)) {
      const stem = w.replace(/s$/, "");
      if (stem.length > 3 && !STOP.has(w) && t.includes(stem)) score += 2;
    }
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

async function scripted(history, ctx, actions) {
  const text = history.at(-1)?.text ?? "";
  const t = text.toLowerCase().trim();
  const lastBot = [...history].reverse().find((m) => m.role === "assistant")?.text ?? "";
  const list = await ctx.disputes();
  const open = list.filter((d) => !d.done);
  const byUrgency = [...open].sort((a, b) => (a.daysLeft ?? 99) - (b.daysLeft ?? 99));

  // The case in focus: named now, or the last one we talked about.
  let d = matchDispute(t, list);
  const pronoun = /\b(it|that|this|that one|this one|them|her|him)\b/.test(t);
  if (!d && (pronoun || /^(yes|yeah|yep|sure|ok|okay|do it|go ahead|please|let'?s)/.test(t))) {
    for (const m of [...history].reverse().slice(1)) { d = matchDispute(m.text, list); if (d) break; }
  }
  const caseName = (x) => `${first(x.buyerName)}'s ${x.item.replace(/\s*\(.*\)/, "")}`;

  // ---- yes / no to whatever we just offered ----
  const yes = /^(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|please do|let'?s do it|go for it|sounds good)\b/.test(t);
  const no = /^(no|nah|nope|not now|later|never mind|nevermind)\b/.test(t);
  if (yes && lastBot) {
    if (/triage|all of them|every/.test(lastBot.toLowerCase())) { actions.push({ type: "triage" }); return pick(["Okay, going through all of them now. Give me a few seconds.", "On it. Working through every case at once."]); }
    if (/negotiat/.test(lastBot.toLowerCase()) && d) { actions.push({ type: "negotiate", id: d.id }); return `Great. Opening the negotiation with ${first(d.buyerName)}. I'll aim for something fair, and you sign off on the final number.`; }
    if (/radar/.test(lastBot.toLowerCase())) { actions.push({ type: "view", view: "radar" }); return "Here's Risk Radar."; }
    if (d) { actions.push({ type: "analyze", id: d.id }); return pick([`Okay, digging into ${caseName(d)} now.`, `On it. Pulling the tracking, the buyer's history and the photos for ${caseName(d)}.`]); }
  }
  if (no) return pick(["No problem. I'm here when you need me.", "Sure, we can leave it for now.", "Okay. Just say the word."]);

  // ---- small talk ----
  if (/^(hi|hey|hello|yo|good (morning|afternoon|evening))\b/.test(t)) {
    const top = byUrgency[0];
    return open.length
      ? `${pick(["Hey!", "Hi there!", "Hello!"])} We've got ${open.length} open disputes this morning. ${top ? `The most urgent is ${caseName(top)}, with ${days(top.daysLeft)}.` : ""} Want me to triage all of them?`
      : "Hey! Good news, there are no open disputes right now.";
  }
  if (/thank|thanks|cheers|appreciate/.test(t)) return pick(["Anytime!", "Happy to help.", "Of course. That's what I'm here for."]);
  if (/how are you|how'?s it going/.test(t)) return pick([`Doing well, thanks! Busy morning though: ${open.length} disputes waiting.`, "I'm good! Ready to save you some money."]);
  if (/^(help|who are you|what are you)\b|what can you do/.test(t))
    return "I'm Defender, your dispute assistant. I can triage every case at once, dig into one, haggle a fair refund, or watch new orders for fraud. Anything that moves money still needs your okay.";

  // ---- whole-inbox actions ----
  if (/triage|(check|investigate|analy[sz]e|handle|go through|sort out|look at).*(all|every|everything)/.test(t)) {
    actions.push({ type: "triage" });
    return pick([
      `On it. I'm going through all ${open.length} disputes at once, about ${money(open.reduce((s, x) => s + Number(x.amount), 0))} in total. Nothing goes to PayPal until you approve.`,
      `Sure. Investigating all ${open.length} cases now. You'll have a plan for each in a few seconds.`,
    ]);
  }
  if (/brief|summary|morning|status|what.*(going on|happening|up)|overview|catch me up/.test(t) && !d) {
    const ov = await ctx.overview();
    const top = byUrgency[0];
    const fraud = open.find((x) => x.reason === "UNAUTHORISED" && x.id !== top?.id);
    return [
      `Quick rundown: ${open.length} open disputes, ${money(ov.atStake)} on the line.`,
      top ? `${caseName(top)} is the most urgent, ${days(top.daysLeft)}.` : "",
      fraud ? `${caseName(fraud)} looks like stolen-account fraud.` : "",
      ov.riskRadar?.high ? `Risk Radar is holding ${ov.riskRadar.high} risky order${ov.riskRadar.high === 1 ? "" : "s"}.` : "",
      Number(ov.saved) > 0 ? `And we've protected ${money(ov.saved)} so far.` : "Want me to triage them all?",
    ].filter(Boolean).join(" ");
  }
  if (/how much.*(saved|protected|kept)|money (saved|protected)/.test(t)) {
    const ov = await ctx.overview();
    return Number(ov.saved) > 0 ? `${money(ov.saved)} so far, and ${money(ov.atStake)} is still in play.` : `Nothing locked in yet. ${money(ov.atStake)} is at stake, so let's change that.`;
  }
  if (/how many/.test(t) && /dispute|case/.test(t)) return `${open.length} open right now${list.length > open.length ? `, and ${list.length - open.length} already handled` : ""}.`;
  if (/(what|which).*(first|start|priorit)|where (do|should) (i|we) start/.test(t)) {
    const top = byUrgency[0];
    if (!top) return "Nothing urgent. Enjoy your coffee.";
    return `I'd start with ${caseName(top)}. ${top.buyerName ? first(top.buyerName) : "The buyer"} ${REASON[top.reason] ?? "opened a dispute"}, with ${days(top.daysLeft)}. Want me to dig into it?`;
  }
  if (/due|deadline|urgent|soon/.test(t)) {
    const s = byUrgency.slice(0, 2);
    return s.length ? `Next up: ${s.map((x) => `${caseName(x)}, ${days(x.daysLeft)}`).join(". Then ")}.` : "Nothing's due. You're all caught up.";
  }

  // ---- settings and screens ----
  if (/autopilot/.test(t)) {
    const on = !/off|disable|stop|pause/.test(t);
    actions.push({ type: "autopilot", enabled: on });
    return on ? "Autopilot's on. I'll handle the clear-cut cases within your rules and hold the rest for you." : "Autopilot's off. Every case will wait for you.";
  }
  if (/simulat|new dispute|incoming|test dispute/.test(t)) { actions.push({ type: "simulate" }); return pick(["Okay, sending a test dispute in from PayPal. Watch the inbox.", "Here comes a new one from PayPal."]); }
  if (/integration|connect|slack|discord|zapier|calendar|shippo|api key/.test(t)) { actions.push({ type: "view", view: "integrations" }); return "Here's Integrations. It shows what's connected and every call made this session."; }
  if (/radar|new order|fraud check|before (we )?ship/.test(t) && !d) {
    actions.push({ type: "view", view: "radar" });
    const risky = ctx.orders().filter((o) => o.risk?.level === "HIGH");
    return risky.length ? `Here's Risk Radar. ${risky.length} order${risky.length === 1 ? " looks" : "s look"} risky, so I'd hold ${risky.length === 1 ? "it" : "them"} before shipping.` : "Here's Risk Radar. I score every order before it ships.";
  }
  if (/track record|learn|accura|calibrat|predict|how good are you/.test(t)) {
    actions.push({ type: "view", view: "track" });
    const tr = (await ctx.overview()).trackRecord;
    return `My plans worked in ${tr.planSuccess}% of ${tr.resolved} past cases, and learning from PayPal's rulings cut my wrong calls by ${tr.predictionError.improvement}%. I've got the details on screen.`;
  }
  if (/insight|losing|leak|report|why.*(money|lose)/.test(t)) { actions.push({ type: "view", view: "insights" }); return "Here's where disputes are costing you, and what to fix first."; }

  // ---- one case ----
  if (d && /negotiat|offer|settle|deal|haggle/.test(t)) {
    if (d.stage !== "INQUIRY") { actions.push({ type: "open_dispute", id: d.id }); return `PayPal won't allow offers on ${caseName(d)} anymore, it's past that stage. I've opened it so you can fight or accept.`; }
    actions.push({ type: "negotiate", id: d.id });
    return `Okay, opening the negotiation with ${first(d.buyerName)}. I'll aim for a fair number, and you approve the deal.`;
  }
  if (d && /fight|analy|investigat|check|look into|handle|deal with|dig/.test(t)) {
    actions.push({ type: "analyze", id: d.id });
    return pick([`On it. Digging into ${caseName(d)} now.`, `Sure. I'll pull the tracking, ${first(d.buyerName)}'s history and the photos, then show you my call.`]);
  }
  if (d && /refund|accept|give up/.test(t)) {
    actions.push({ type: "open_dispute", id: d.id });
    return `I've opened ${caseName(d)}. Want me to check it first, in case it's worth fighting?`;
  }
  if (d) {
    actions.push({ type: "open_dispute", id: d.id });
    const verdict = d.aiVerdict ? ` My call: ${VERDICT_WORDS[d.aiVerdict]}${d.aiVerdict === "FIGHT" && d.winOdds ? `, about ${d.winOdds}% odds` : ""}.` : " Want me to dig into it?";
    return `${first(d.buyerName)} ${REASON[d.reason] ?? "opened a dispute"}, ${money(d.amount)}, ${days(d.daysLeft)}.${verdict}`;
  }
  if (/risk|fraud|worst|dangerous|suspicious/.test(t)) {
    const f = open.find((x) => x.reason === "UNAUTHORISED") ?? byUrgency[0];
    if (!f) return "Nothing suspicious right now.";
    actions.push({ type: "open_dispute", id: f.id });
    return `${caseName(f)} worries me most, ${money(f.amount)}. It has the classic signs of a stolen account. Want me to dig in?`;
  }
  return pick([
    "Hmm, I didn't quite catch that. You could ask me what's urgent, or tell me to triage everything.",
    "Not sure I follow. Try asking about a buyer by name, like Priya, or say brief me.",
  ]);
}
