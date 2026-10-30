// Negotiation arena: the seller's agent negotiates against a simulated buyer agent
// to find the lowest refund this buyer is likely to accept. The agreed amount
// can then be sent to the real buyer through PayPal's make-offer endpoint.
import { z } from "zod";
import { claudeConfigured, claudeJSON } from "./claude.js";
import { getPolicies } from "./store.js";

const MAX_TURNS = 8;

const TurnSchema = z.object({
  message: z.string().describe("What you say to the other party. Warm, natural, under 280 characters."),
  proposed_refund: z
    .string()
    .describe("The refund amount you are proposing (or accepting), as a decimal like '20.00'. Use '0.00' for no refund."),
  decision: z
    .enum(["COUNTER", "ACCEPT", "WALK_AWAY"])
    .describe("ACCEPT = you agree to the other side's latest proposed refund. COUNTER = you propose proposed_refund. WALK_AWAY = no deal, escalate to PayPal."),
});

const transcriptText = (turns) =>
  turns.length
    ? turns.map((t) => `${t.side === "seller" ? "SELLER" : "BUYER"}: "${t.message}" [proposes $${t.proposed_refund}, ${t.decision}]`).join("\n")
    : "(no messages yet: you open the negotiation)";

function sellerSystem(d, intel) {
  return `You are the negotiation agent for a small online store, talking to a customer about a PayPal dispute.
Goal: resolve it with the smallest refund the customer will genuinely be happy with, while keeping them as a customer. Never go above the full amount (${d.amount.value} ${d.amount.currency}).
Be honest and kind. You may mention non-cash extras (a discount code on the next order, a free replacement) but the deal is the refund amount.
Facts only you know:
- Order: ${JSON.stringify(intel.order ?? "not found")}
- Tracking: ${JSON.stringify(intel.tracking ?? "none")}
- Customer history: ${JSON.stringify(intel.customer ?? "none")}
- Policies: ${getPolicies()}
Accept the buyer's proposal if it's within policy and fair. Aim to close within 3-4 of your turns.`;
}

function buyerSystem(d) {
  return `You are simulating the customer in a PayPal dispute, so the seller can rehearse before contacting the real person.
You are ${d.buyerName}. You bought: ${d.items.map((i) => i.name).join(", ")} for ${d.amount.value} ${d.amount.currency}.
What you told PayPal: ${d.messages.filter((m) => m.by === "BUYER").map((m) => m.content).join(" / ")}
Behave like a reasonable real customer with this complaint: you want fair compensation for the actual problem, you push back on lowball offers, and you accept a fair deal. You don't know the seller's internal data.`;
}

async function claudeTurn(side, d, intel, turns) {
  return claudeJSON({
    system: side === "seller" ? sellerSystem(d, intel) : buyerSystem(d),
    schema: TurnSchema,
    effort: "low",
    maxTokens: 4000,
    content: `Conversation so far:\n${transcriptText(turns)}\n\nYour turn. Respond as the ${side}.`,
  });
}

// Keyless demo: a believable, rules-based haggle.
function scriptedTurns(d) {
  const A = Number(d.amount.value);
  const first = d.buyerName.split(" ")[0];
  const item = d.items[0]?.name ?? "your order";
  const f = (n) => n.toFixed(2);

  if (d.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED") {
    return [
      { side: "seller", decision: "COUNTER", proposed_refund: "0.00", message: `Hi ${first}! I checked: your ${item} is at your local post office and should arrive in 1-2 days. Could you give it until Friday? If it's not there, I'll refund you in full, no questions.` },
      { side: "buyer", decision: "COUNTER", proposed_refund: f(A * 0.2), message: `I've been waiting over a week and needed it sooner. Can you at least cover the shipping, around $${f(A * 0.2)}?` },
      { side: "seller", decision: "COUNTER", proposed_refund: f(Math.min(5, A * 0.12)), message: `That's fair, sorry for the wait. I'll refund $${f(Math.min(5, A * 0.12))} for the delay right now, and the full guarantee still stands if it doesn't show up.` },
      { side: "buyer", decision: "ACCEPT", proposed_refund: f(Math.min(5, A * 0.12)), message: `Okay, that works. Thanks for checking on it!` },
    ];
  }
  const setSize = Number(/\((\d+)/.exec(item)?.[1] ?? 4);
  const share = A / setSize;
  const ask = Math.min(A, share * 2);
  const mid = Math.round(((share + ask) / 2) * 2) / 2;
  return [
    { side: "seller", decision: "COUNTER", proposed_refund: f(share), message: `Hi ${first}, I'm so sorry one piece of your ${item} arrived damaged. I'd like to refund $${f(share)}, the full price of that piece. No need to send anything back.` },
    { side: "buyer", decision: "COUNTER", proposed_refund: f(ask), message: `Thanks, but it was meant as a set and now it's incomplete. I think $${f(ask)} is fairer.` },
    { side: "seller", decision: "COUNTER", proposed_refund: f(mid), message: `I understand, a set should be complete. How about $${f(mid)} back, plus 15% off your next order so you can replace it?` },
    { side: "buyer", decision: "ACCEPT", proposed_refund: f(mid), message: `That's reasonable. Deal, thank you!` },
  ];
}

export async function negotiate(dispute, intel, emit) {
  const turns = [];
  const live = claudeConfigured();
  emit({ type: "start", engine: live ? "claude" : "scripted-demo", max: Number(dispute.amount.value) });

  if (!live) {
    for (const t of scriptedTurns(dispute)) {
      emit({ type: "typing", side: t.side });
      await new Promise((r) => setTimeout(r, 1500));
      turns.push(t);
      emit({ type: "turn", ...t });
    }
  } else {
    for (let i = 0; i < MAX_TURNS; i++) {
      const side = i % 2 === 0 ? "seller" : "buyer";
      emit({ type: "typing", side });
      const t = { side, ...(await claudeTurn(side, dispute, intel, turns)) };
      const cap = Number(dispute.amount.value);
      t.proposed_refund = Math.min(cap, Math.max(0, Number(t.proposed_refund) || 0)).toFixed(2);
      if (t.decision === "ACCEPT" && turns.length) t.proposed_refund = turns.at(-1).proposed_refund;
      turns.push(t);
      emit({ type: "turn", ...t });
      if (t.decision !== "COUNTER") break;
    }
  }

  const last = turns.at(-1);
  const sellerLast = [...turns].reverse().find((t) => t.side === "seller");
  if (last?.decision === "ACCEPT") {
    const amount = last.proposed_refund;
    const saved = (Number(dispute.amount.value) - Number(amount)).toFixed(2);
    emit({ type: "deal", amount, saved, rounds: turns.length, note: sellerLast?.message ?? "" });
    return { deal: true, amount, saved, turns };
  }
  emit({ type: "no_deal", rounds: turns.length });
  return { deal: false, turns };
}
