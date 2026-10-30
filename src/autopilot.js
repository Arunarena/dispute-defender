// Autopilot: when a new dispute arrives (PayPal webhook or simulation), the agent
// analyzes it at once and acts on its own only when the seller's rules allow it.
import { EventEmitter } from "events";

export const bus = new EventEmitter();
bus.setMaxListeners(100);

export const rules = {
  enabled: false,
  fightMinOdds: 80, // auto-submit evidence when win odds are at least this...
  fightMaxAmount: 200, // ...and the dispute is at most this amount
  autoReply: true, // auto-send reassurance messages (no money moves)
  settleMaxAmount: 25, // auto-approve refunds/offers up to this amount
};

export function updateRules(patch) {
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (!(k in rules)) continue;
    rules[k] = typeof rules[k] === "boolean" ? Boolean(v) : Math.max(0, Number(v) || 0);
  }
  return rules;
}

// Decide whether the recommendation may run without a human.
export function decide(dispute, rec) {
  const amount = Number(dispute.amount.value);
  switch (rec.verdict) {
    case "FIGHT":
      return rec.win_likelihood >= rules.fightMinOdds && amount <= rules.fightMaxAmount
        ? { auto: true, rule: `win odds ${rec.win_likelihood}% ≥ ${rules.fightMinOdds}% and $${amount.toFixed(2)} ≤ $${rules.fightMaxAmount}` }
        : { auto: false, rule: `fight needs ≥ ${rules.fightMinOdds}% odds and ≤ $${rules.fightMaxAmount} (got ${rec.win_likelihood}%, $${amount.toFixed(2)})` };
    case "SEND_MESSAGE":
      return rules.autoReply ? { auto: true, rule: "auto-reply is on (no money moves)" } : { auto: false, rule: "auto-reply is off" };
    case "OFFER_PARTIAL_REFUND": {
      const offer = Number(rec.offer_amount || 0);
      return offer <= rules.settleMaxAmount
        ? { auto: true, rule: `offer $${offer.toFixed(2)} ≤ auto-settle limit $${rules.settleMaxAmount}` }
        : { auto: false, rule: `offer $${offer.toFixed(2)} is above auto-settle limit $${rules.settleMaxAmount}` };
    }
    case "ACCEPT_CLAIM":
      return amount <= rules.settleMaxAmount
        ? { auto: true, rule: `refund $${amount.toFixed(2)} ≤ auto-settle limit $${rules.settleMaxAmount}` }
        : { auto: false, rule: `full refund $${amount.toFixed(2)} is above auto-settle limit $${rules.settleMaxAmount}` };
    default:
      return { auto: false, rule: "unknown verdict" };
  }
}
