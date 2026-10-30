// The Dispute Defender agent.
// Claude investigates a PayPal dispute with read-only tools over the merchant's
// back office, then files a recommendation. A human approves before anything
// is sent to PayPal.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { findOrder, findTracking, findCustomer, getPolicies } from "./store.js";
import { scriptedRecommendation } from "./scripted.js";
import { MODEL, claudeConfigured, getClient, FALLBACK_PARAMS } from "./claude.js";
import { listPhotos, analyzePhoto } from "./photos.js";

export { MODEL, claudeConfigured };

export const EVIDENCE_TYPES = [
  "PROOF_OF_FULFILLMENT",
  "PROOF_OF_DELIVERY_SIGNATURE",
  "PROOF_OF_REFUND",
  "RETURN_POLICY",
  "ITEM_DESCRIPTION",
  "PROOF_OF_RESHIPMENT",
  "OTHER",
];

export const RecommendationSchema = z.object({
  verdict: z
    .enum(["FIGHT", "OFFER_PARTIAL_REFUND", "ACCEPT_CLAIM", "SEND_MESSAGE"])
    .describe(
      "FIGHT = submit evidence to win. OFFER_PARTIAL_REFUND = propose a smaller refund (inquiry stage only). ACCEPT_CLAIM = refund in full, the seller is likely to lose or it's not worth fighting. SEND_MESSAGE = reply to the buyer to resolve without money moving (inquiry stage only).",
    ),
  win_likelihood: z.number().int().min(0).max(100).describe("Chance (0-100) the seller wins if they fight."),
  headline: z.string().describe("One sentence the seller reads first. Plain language."),
  reasoning: z.array(z.string()).describe("3-6 short bullets explaining the decision, each citing a fact you found."),
  risk_flags: z.array(z.string()).describe("Red flags or weaknesses, may be empty."),
  evidence: z
    .array(
      z.object({
        evidence_type: z.enum(EVIDENCE_TYPES),
        title: z.string(),
        detail: z.string(),
      }),
    )
    .describe("Evidence items to submit or reference. Empty if not fighting."),
  primary_evidence_type: z
    .enum(EVIDENCE_TYPES)
    .nullable()
    .describe("The PayPal evidence_type to submit if verdict is FIGHT, else null."),
  tracking: z
    .object({ carrier: z.string(), tracking_number: z.string() })
    .nullable()
    .describe("Carrier (PayPal enum like USPS, UPS, FEDEX, DHL, OTHER) and tracking number, if relevant."),
  offer_amount: z
    .string()
    .nullable()
    .describe("Refund amount like '16.00' if verdict is OFFER_PARTIAL_REFUND, else null."),
  response_text: z
    .string()
    .describe(
      "The exact text to send: evidence notes for PayPal (FIGHT), the offer note (OFFER), the acceptance note (ACCEPT), or the message to the buyer (MESSAGE). Professional, factual, under 1500 characters.",
    ),
  money_saved_estimate: z
    .string()
    .describe("Dollar amount the seller keeps vs. a full refund if this plan works, like '113.00'."),
});

const SYSTEM_PROMPT = `You are Dispute Defender, an expert PayPal dispute analyst working for a small online store.

Your job: investigate one PayPal dispute and recommend the response that leaves the seller best off, then call submit_recommendation exactly once.

How to work:
1. Look up the order with lookup_order using the dispute's transaction ID.
2. If inspect_photos lists photos, inspect them: a carrier delivery photo or a buyer damage photo often decides the case.
3. Check the shipment with track_shipment, the buyer's history with get_customer_history, and the store policies with get_store_policies. Use what's relevant to the dispute reason.
4. Weigh the facts like a PayPal adjudicator would:
   - Item not received + carrier shows delivered to the shipping address = strong seller case (PROOF_OF_FULFILLMENT with tracking).
   - Item not received + still in transit and in INQUIRY stage = reassure the buyer with tracking (SEND_MESSAGE); don't refund yet.
   - Not as described + partial damage = a partial refund matching the store policy is usually cheaper than losing the full amount (only possible in INQUIRY stage).
   - Unauthorized + mismatched billing/shipping, freight forwarder, new account, foreign IP, no signature = seller will very likely lose; accept to avoid extra fees and time.
   - In CHARGEBACK stage you cannot make offers or just message; choose FIGHT or ACCEPT_CLAIM.
5. Be honest about weak cases. Never invent evidence; only cite facts returned by tools.

Write response_text as the seller would send it, in a calm, factual tone. Address PayPal for evidence notes and the buyer for messages and offers.`;

const money = (v) => Number(v).toFixed(2);

// Read-only tools. `emit` streams progress to the UI.
function buildTools(emit, captured, dispute) {
  const traced = (name, label, fn) => async (input) => {
    emit({ type: "tool", name, label, input });
    const result = await fn(input);
    emit({ type: "tool_result", name, result });
    return JSON.stringify(result);
  };

  return [
    betaZodTool({
      name: "lookup_order",
      description:
        "Look up the store's order record for a PayPal transaction ID: items, prices, shipping and billing addresses, carrier and tracking number, customer email, IP country.",
      inputSchema: z.object({ transaction_id: z.string() }),
      run: traced("lookup_order", "Looking up the order", async ({ transaction_id }) =>
        findOrder(transaction_id) ?? { error: "No order found for that transaction ID." },
      ),
    }),
    betaZodTool({
      name: "track_shipment",
      description: "Get the carrier tracking history and delivery status for a tracking number.",
      inputSchema: z.object({ carrier: z.string(), tracking_number: z.string() }),
      run: traced("track_shipment", "Checking carrier tracking", async ({ tracking_number }) =>
        findTracking(tracking_number) ?? { error: "Carrier has no record of that tracking number." },
      ),
    }),
    betaZodTool({
      name: "get_customer_history",
      description: "Get the buyer's history with this store: account age, orders, total spent, prior disputes, notes.",
      inputSchema: z.object({ email: z.string() }),
      run: traced("get_customer_history", "Reviewing the buyer's history", async ({ email }) =>
        findCustomer(email) ?? { error: "No history for this customer." },
      ),
    }),
    betaZodTool({
      name: "get_store_policies",
      description: "Get the store's shipping, damage, returns, lost-package and fraud policies plus margin notes.",
      inputSchema: z.object({}),
      run: traced("get_store_policies", "Reading store policies", async () => ({ policies: getPolicies() })),
    }),
    betaZodTool({
      name: "inspect_photos",
      description:
        "Inspect the photo evidence attached to this dispute (carrier proof-of-delivery photos, buyer damage photos, seller uploads). Returns what vision analysis sees in each photo and which side it supports. Returns an empty list if there are none.",
      inputSchema: z.object({}),
      run: traced("inspect_photos", "Inspecting photo evidence", async () => {
        const photos = listPhotos(dispute.id);
        const order = dispute.transactionId ? findOrder(dispute.transactionId) : null;
        for (const p of photos) if (!p.analysis) await analyzePhoto(dispute, p, order);
        return { photos: photos.map((p) => ({ url: p.url, source: p.source, label: p.label, ...p.analysis })) };
      }),
    }),
    betaZodTool({
      name: "submit_recommendation",
      description:
        "Submit your final recommendation for the seller. Call this exactly once, after investigating. This does not contact PayPal; the seller reviews it first.",
      inputSchema: RecommendationSchema,
      run: async (input) => {
        captured.recommendation = input;
        return "Recommendation recorded. You're done.";
      },
    }),
  ];
}

function disputeBrief(d) {
  return `Dispute to investigate:
- Dispute ID: ${d.id}
- Reason: ${d.reason}
- Stage: ${d.stage} | Status: ${d.status}
- Amount: ${money(d.amount.value)} ${d.amount.currency}
- Buyer: ${d.buyerName}
- Transaction ID: ${d.transactionId ?? "unknown"}
- Items: ${d.items.map((i) => `${i.quantity} x ${i.name}`).join("; ") || "not listed"}
- Seller response due: ${d.sellerResponseDue ?? "unknown"}
- Messages:
${d.messages.map((m) => `  [${m.by} ${m.time}] ${m.content}`).join("\n") || "  (none)"}`;
}

export async function analyzeDispute(dispute, emit) {
  if (!claudeConfigured()) return scriptedRecommendation(dispute, emit);

  const client = getClient();
  const captured = {};
  emit({ type: "status", message: `Claude (${MODEL}) is investigating...` });

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    max_iterations: 12,
    output_config: { effort: "medium" },
    ...FALLBACK_PARAMS,
    system: SYSTEM_PROMPT,
    tools: buildTools(emit, captured, dispute),
    messages: [{ role: "user", content: disputeBrief(dispute) }],
  });

  for await (const message of runner) {
    for (const block of message.content) {
      if (block.type === "text" && block.text.trim()) emit({ type: "note", message: block.text.trim() });
    }
    if (message.stop_reason === "refusal") throw new Error("The model declined to analyze this dispute.");
  }

  if (!captured.recommendation) throw new Error("The agent finished without a recommendation. Try again.");
  return { ...captured.recommendation, engine: MODEL };
}
