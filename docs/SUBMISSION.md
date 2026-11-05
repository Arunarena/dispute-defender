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
- **Learns from PayPal's rulings.** Every plan's outcome is recorded. Results from similar past cases calibrate the win odds on new disputes, so the agent stops being overconfident where it has been wrong before, and Autopilot holds those cases for approval. A Track Record screen shows its accuracy and what it learned.
- **Finds the profit leaks.** An AI report over 90 days of disputes shows where money is lost and which fixes are worth the most per month.
- **Proves delivery with an NFC tap.** Each shipped box gets a cheap NFC sticker with a signed link. When the buyer's phone touches the box (no app needed), the tap is logged and the buyer can confirm arrival or report a problem straight to the seller, before it becomes a PayPal dispute. If a "never arrived" claim comes in anyway, the agent cites the tap ("tapped 2.5 hours after delivery") in the evidence it sends to PayPal.
- **Approves with a fingerprint, on any device.** With a passkey registered (Face ID, Touch ID, Windows Hello), every PayPal response and refund needs a biometric check, using single-use tokens tied to one action. The dashboard installs as an app on iPhone, Android, Windows and Mac.
- **Connects to the tools sellers already use.** An Integrations hub shows each outside API, live or demo, with a call log. Shipping an order puts its tracking on the PayPal transaction (Add Tracking API). A risky order can be refunded before it becomes a chargeback (Payments API). The agent reads the buyer's real PayPal history (Transaction Search). Live carrier tracking comes from Shippo, address checks from Google, alerts go to Slack, Discord or Zapier, and deadlines go to the seller's calendar.
- **Talks.** Defender Copilot answers by voice ("brief me", "fight the headphones dispute") and drives the app hands-free.
- **Human in control.** The agent's tools are read-only. Money moves only after approval or under an explicit rule.

## How PayPal is used
- **Disputes API v1:** list and read disputes; `provide-evidence` (multipart, with tracking info and photo files), `make-offer`, `accept-claim`, `send-message`.
- **Webhooks:** `CUSTOMER.DISPUTE.CREATED` starts Autopilot. `CUSTOMER.DISPUTE.UPDATED` refreshes the case. `CUSTOMER.DISPUTE.RESOLVED` feeds the ruling back into the Track Record. `PAYMENT.CAPTURE.COMPLETED` sends every checkout to Risk Radar. Signatures are checked with `verify-webhook-signature`.
- **Add Tracking API:** shipping from Risk Radar puts the tracking number on the PayPal transaction.
- **Payments API v2:** cancel & refund a risky order before it becomes a chargeback.
- **Transaction Search API:** the agent checks the buyer's real PayPal history with the store.
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
