# Submission form text

Copy these into the hackathon submission form.

## Project name
Dispute Defender

## Tagline
An AI agent that helps small sellers win PayPal disputes, or settle them cheaply, with a human always in control.

## Description

Small online sellers lose money to PayPal disputes even when they're in the right. Answering well takes time, the evidence is spread across the store, the carrier and the inbox, and deadlines are short. Many sellers simply refund.

Dispute Defender is an AI dispute analyst for PayPal sellers:

- **Investigates every dispute.** A Claude agent uses tools to pull the order, carrier tracking, buyer history, store policies and photo evidence, then weighs them the way an adjudicator would.
- **Recommends the best response:** fight with evidence, offer a partial refund, accept, or reply to the buyer. It shows win odds, cites the facts behind its reasons, flags risks, and estimates the money saved. It drafts the exact text to send.
- **Reads photos with AI vision.** Carrier delivery photos, buyer damage photos and seller uploads are analyzed for visible facts (house numbers, labels, GPS stamps, damage). Photos that support the seller are attached to the PayPal evidence submission.
- **Negotiates, agent vs. agent.** For inquiry-stage disputes, the seller's agent rehearses a negotiation against a simulated buyer agent built from the buyer's own words, then sends the agreed amount to the real buyer as a PayPal offer.
- **Runs on Autopilot.** PayPal webhooks trigger analysis the moment a dispute opens. The agent acts on its own only within rules the seller sets (minimum win odds, maximum amounts) and holds everything else for approval. Every automatic action is logged with the rule that allowed it.
- **Builds an evidence dossier.** A professional PDF with the timeline, address check, AI-read photos and policies is attached to the PayPal evidence submission automatically.
- **Prevents disputes before they happen.** Risk Radar scores each new PayPal order for fraud and dispute risk before it ships and recommends ship, require a signature, or hold.
- **Finds the profit leaks.** An AI report over 90 days of disputes shows where money is lost and which fixes are worth the most per month.
- **Talks.** Defender Copilot answers by voice ("brief me", "fight the headphones dispute") and drives the app hands-free.
- **Human in control.** The agent's tools are read-only. Money moves only after approval or under an explicit rule.

## How PayPal is used
- **Disputes API v1:** list and read disputes; `provide-evidence` (multipart, with tracking info and photo files), `make-offer`, `accept-claim`, `send-message`.
- **Webhooks:** `CUSTOMER.DISPUTE.CREATED` starts Autopilot. Signatures are checked with `verify-webhook-signature`.
- **Orders API v2 + JavaScript SDK:** the demo shop creates real sandbox purchases to dispute.
- **OAuth 2.0** client credentials, all in the PayPal sandbox.

## AI tools used
- **Claude Opus 5.5 (`claude-opus-5-5`) through the Anthropic SDK (`@anthropic-ai/sdk`):**
  - **Agent:** the SDK tool runner drives a tool-using investigation agent. The final recommendation comes back through a schema-validated tool, so the UI always receives valid structured data.
  - **Vision:** dispute photos are sent as images; Claude returns structured findings and which side each photo supports.
  - **Negotiation:** two Claude roles (seller with private store data; buyer with only public claims) exchange structured turns.
  - Server-side refusal fallbacks are enabled.
- A rules-based stand-in agent lets the app run without an API key for quick evaluation. The app's header shows which engine is active.

## Try it
- Hosted demo: `<your Render URL>`
- Code: https://github.com/Arunarena/dispute-defender. Runs with `npm install && npm start` and no keys needed (demo mode).
