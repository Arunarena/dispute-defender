# 🛡️ Dispute Defender

**An AI copilot that helps small online sellers win PayPal disputes, or settle them cheaply.**

Small sellers lose a lot of money to disputes. That isn't always because they're wrong: answering a dispute well takes time, the evidence is spread across different systems, and deadlines are short. Dispute Defender reads each PayPal dispute and investigates it like an experienced analyst. It recommends the response that leaves the seller best off and drafts the response. The seller approves it with one click, and it's sent through the PayPal Disputes API.

> Built for the *Build What's Next with PayPal and AI* hackathon.

---

## What it does

1. **Pulls open disputes** from the PayPal **Disputes API**: reason, stage, amount, deadline and the buyer's messages.
2. **An AI agent investigates** each dispute with read-only tools over the seller's back office:
   - 🧾 order lookup (by PayPal transaction ID)
   - 🚚 carrier tracking history
   - 👤 buyer history (prior disputes, account age)
   - 📜 store policies and margins
3. **Recommends one of four responses**, with a win-likelihood score, reasons that cite the facts it found, risk flags, and an estimate of the money saved:
   | Verdict | When | PayPal call on approval |
   |---|---|---|
   | **Fight it** | Strong evidence, e.g. carrier confirms delivery | `POST /v1/customer/disputes/{id}/provide-evidence` (with tracking info) |
   | **Offer partial refund** | Partly the seller's fault, cheaper than losing | `POST /v1/customer/disputes/{id}/make-offer` |
   | **Accept & move on** | Likely fraud or a case that can't be won | `POST /v1/customer/disputes/{id}/accept-claim` |
   | **Reply to buyer** | Package still in transit, early inquiry | `POST /v1/customer/disputes/{id}/send-message` |
4. **A person stays in charge.** The seller can edit the drafted text or offer amount before approving. Nothing reaches PayPal without that approval.
5. **📸 Photo evidence with AI vision:** Claude reads carrier delivery photos, buyer damage photos and your own uploads. It reads house numbers, label text and GPS stamps, and says which side each photo supports. Photos that support you are attached as files when evidence goes to PayPal.
6. **🤝 Negotiation arena (agent vs. agent):** for inquiry-stage disputes, your seller agent negotiates live against a simulated buyer agent built from the buyer's own words, with a price track showing the offers converging. When they reach a deal, one click sends it to the real buyer through `make-offer`.
7. **🤖 Autopilot with PayPal webhooks:** when PayPal sends `CUSTOMER.DISPUTE.CREATED`, the agent analyzes the dispute right away and acts **only within your rules** (e.g. "auto-fight if win odds ≥ 80% and amount ≤ $200", "auto-settle refunds ≤ $25"). Everything else waits for approval. Each automatic action is logged with the rule that allowed it. Click **📡 Simulate incoming dispute** to see it without a public URL.
8. **The demo shop** uses PayPal **Orders API v2** and the **JavaScript SDK** checkout buttons, so you can make real sandbox purchases and open real sandbox disputes against them.

### Demo scenarios (included)

| Dispute | What the agent finds | Recommendation |
|---|---|---|
| Headphones, "never arrived", $129 | USPS delivered to the address with a photo; buyer has 2 prior "not received" claims | **Fight**, ~85% win odds |
| Mug set, "one arrived chipped", $64 | 1 of 4 damaged, policy says refund that item's share, loyal customer | **Offer $16**, keep $48 |
| Smartwatch, "unauthorized", $289.99 | Freight forwarder, billing ≠ shipping, 1-day-old account, foreign IP | **Accept**: it's fraud and can't be won |
| Tote bags, "where is it?", $42.50 | Delayed by weather, now at the local post office | **Reply** with tracking, no refund |

---

## Quick start (2 minutes, no keys needed)

Requires **Node.js 20+**.

```bash
git clone <this repo>
cd dispute-defender
npm install
npm start
```

Open **http://localhost:3000**. With no keys set, the app runs in **demo mode**: built-in sample disputes, and a scripted agent in place of Claude. Both are labeled in the header.

### Turn on real PayPal + real AI

```bash
cp .env.example .env    # Windows: copy .env.example .env
```

Fill in `.env`:

| Variable | Where to get it | What it turns on |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | [developer.paypal.com](https://developer.paypal.com) → Apps & Credentials → **Sandbox** → Create App | Live sandbox disputes plus demo-shop checkout |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Claude (`claude-opus-5-5`) for the agent, vision and negotiation |
| `PAYPAL_WEBHOOK_ID` (optional) | Your sandbox app → **Webhooks** → add `https://<host>/api/webhooks/paypal` for `CUSTOMER.DISPUTE.CREATED` | Real-time Autopilot. Signatures are checked with PayPal's verify-webhook-signature API |

Restart with `npm start`. Both badges in the header should now show live mode.

### Create a real sandbox dispute end to end

1. On developer.paypal.com → **Testing Tools → Sandbox Accounts**, note your sandbox **personal** (buyer) login.
2. Open **http://localhost:3000/shop.html** and buy an item with the PayPal button, logging in as the sandbox buyer. The store records the order with a (simulated) tracking number.
3. Log in to **https://www.sandbox.paypal.com** as the buyer → **Resolution Center** → report a problem with that payment (for example, "item not received").
4. Back in Dispute Defender, click ↻. The dispute appears. Click **Analyze with AI**, review the recommendation, then **Approve**.

---

## How it works

```
Browser (public/)                 Node/Express (src/server.js)
┌────────────────────┐   SSE      ┌──────────────────────────────────────────┐
│ Dispute dashboard  │◀──────────▶│ /api/disputes/:id/analyze                │
│ live agent trace   │            │   └─ agent.js: Claude tool-use loop       │
│ approve & send     │──POST────▶ │        tools → store.js (orders, tracking,│
└────────────────────┘            │                 customers, policies)      │
┌────────────────────┐            │ /api/disputes/:id/respond                 │
│ Demo shop          │──Orders──▶ │   └─ paypal.js → PayPal Disputes API v1   │
│ (PayPal JS SDK)    │            │ /api/shop/orders → PayPal Orders API v2   │
└────────────────────┘            └──────────────────────────────────────────┘
```

| File | Purpose |
|---|---|
| [src/agent.js](src/agent.js) | Claude agent: system prompt, tools, recommendation schema |
| [src/paypal.js](src/paypal.js) | PayPal OAuth, Disputes API (list, details, evidence, offer, accept, message), Orders API |
| [src/store.js](src/store.js) | The seller's back office: orders, shipments, customers, policies |
| [src/photos.js](src/photos.js) | Photo evidence storage and Claude vision analysis |
| [src/negotiate.js](src/negotiate.js) | Agent-vs-agent negotiation arena |
| [src/autopilot.js](src/autopilot.js) | Autopilot rules and decision logic |
| [src/claude.js](src/claude.js) | Shared Claude client and structured-output helper |
| [src/scripted.js](src/scripted.js) | Rules-based stand-in agent for keyless demo mode |
| [src/demoData.js](src/demoData.js) | Sample disputes and store data |
| [src/server.js](src/server.js) | HTTP API and streaming of agent progress |
| [public/](public/) | Dashboard and demo shop UI |

### AI tools used

- **Claude Opus 5.5 (`claude-opus-5-5`) through the Anthropic TypeScript/JS SDK (`@anthropic-ai/sdk`).** The agent runs with the SDK's **tool runner**. Claude decides which back-office lookups to make for each dispute reason (for example, it skips tracking on a fraud case and checks it first on a "not received" case). It weighs the evidence the way a PayPal adjudicator would, then calls `submit_recommendation`. That tool has a strict Zod schema, so the UI always receives valid structured output: verdict, odds, reasons, PayPal `evidence_type`, carrier tracking, offer amount and drafted text.
- **Vision:** each photo is sent to Claude as an image along with the dispute context. Claude returns structured findings (summary, visible facts, which side the photo supports, confidence).
- **Negotiation:** two Claude roles take turns. The seller agent sees the store's private data (orders, tracking, policies). The buyer agent sees only what the buyer wrote. Each turn returns a structured message, refund amount and decision, and amounts are clamped to the disputed total.
- **Safety:** every tool the agent can call is read-only. Money only moves after a person approves. Server-side refusal fallbacks are enabled (`fallbacks: "default"`).
- **Demo mode** uses a scripted rules engine ([src/scripted.js](src/scripted.js)) so judges can click through without an API key. The header shows which engine is active.

### PayPal technologies used

- **Disputes API v1:** list disputes, show details, provide evidence (multipart, with `tracking_info` and photo files), make an offer, accept a claim, send a message.
- **Webhooks:** `CUSTOMER.DISPUTE.CREATED` triggers Autopilot; signatures are checked with `/v1/notifications/verify-webhook-signature`.
- **Orders API v2:** create and capture orders in the demo shop.
- **PayPal JavaScript SDK:** checkout buttons in the demo shop.
- **OAuth 2.0 client credentials:** sandbox authentication.

---

## Notes and limits

- Carrier tracking in the demo shop is simulated. A production version would use the carrier APIs or PayPal's tracking API.
- Demo-mode actions are simulated and reset when the server restarts.
- Some dispute actions are only allowed at certain stages. For example, offers and messages only work in the **inquiry** stage. The agent is told this, and PayPal returns a clear error if an action isn't allowed.

## License

[MIT](LICENSE)
