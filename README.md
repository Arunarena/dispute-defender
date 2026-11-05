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
8. **📄 Evidence dossier PDF:** one click builds a professional evidence document with the case summary, the seller's position, a delivery timeline, an address check, AI-analyzed photos and policies. It's attached automatically when evidence is submitted to PayPal. Internal notes like margins are left out.
9. **🎙️ Defender Copilot:** a voice and chat assistant (Ctrl+K or the mic). Ask "brief me", "what's due soon?" or "fight the headphones dispute". It answers out loud and drives the app (opens cases, starts investigations, opens negotiations, toggles Autopilot), but it never moves money.
10. **🛰️ Risk Radar (prevention):** every new PayPal order is scored for fraud and dispute risk *before it ships*, with an explanation of each signal (address mismatch, freight forwarders, IP country, account age, unverified payer…). Each order gets a recommendation: ship, ship with signature, or hold and verify. Holding a fraudulent order counts as "fraud prevented".
11. **📊 Insights:** an AI "profit leak" report over 90 days of dispute history, with charts. The numbers are computed in code and the AI only interprets them. It shows where money is lost (root cause, product, week) and the fixes worth the most per month.
12. **🧠 Track Record (outcome learning):** every plan the agent sends is remembered until PayPal rules on it (`CUSTOMER.DISPUTE.RESOLVED` webhook, or **⚖️ Simulate PayPal ruling** in demo mode). Results from similar past cases then calibrate the win odds on new disputes, and Autopilot uses the calibrated odds. For example, "delivered" tracking with no photo or signature used to get 78% odds but won only 42% of the time, so a new case like that drops to 54% and waits for approval instead of being fought automatically. The Track Record screen shows the agent's accuracy, a calibration chart and the lessons it learned. All the numbers are computed in code.
13. **📲 NFC Tap-to-Confirm packages:** every box that ships gets a ~$0.20 NFC sticker holding a signed link to that order. When the buyer's phone touches the box (iPhone or Android, no app needed), the tap is logged with the time and device, and the buyer can confirm arrival or report a problem with a photo and GPS. Problems reach the seller *before* they become PayPal disputes. If a "never arrived" dispute comes in anyway, the agent finds the tap and cites it. In the demo, the headphones tag was tapped in Portland 2.5 hours after USPS marked it delivered. The tap goes into the evidence PDF too. Sellers write tags from Chrome on Android (Web NFC) or with any NFC writer app.
14. **🔐 Passkey approval:** register Face ID, Touch ID, Windows Hello or a phone fingerprint, and every response to PayPal and every refund asks for it first (WebAuthn). Approval tokens are single-use, last two minutes and are tied to one action. In live mode one passkey protects every approval. In demo mode only the browser that registered is asked, so a shared demo never locks visitors out.
15. **📱 Installable on any device (PWA):** install the dashboard on iPhone, Android, Windows or Mac, with its own icon, window and shortcuts (Disputes, Risk Radar, Integrations). The app opens offline, and dispute data always loads live.
16. **🔌 Integrations hub:** one screen shows every outside API the app talks to, whether it's live or in demo mode, which key turns it on, and a log of every call. Most are off until you add a key. In demo mode the app logs the call it would have made. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).
    - **PayPal Add Tracking API:** shipping an order from Risk Radar puts the tracking number on the PayPal transaction. The buyer sees it in PayPal, and Seller Protection asks for it on "not received" claims.
    - **PayPal refunds (Payments v2):** **💸 Cancel & refund** on a risky order refunds it before it can become a chargeback, which avoids the chargeback fee and a mark on your dispute rate.
    - **PayPal Transaction Search:** a new agent tool checks the buyer's real PayPal history with your store (payments, refunds, chargebacks).
    - **More PayPal webhooks:** `PAYMENT.CAPTURE.COMPLETED` sends *every* PayPal checkout to Risk Radar, not only demo-shop orders. `CUSTOMER.DISPUTE.UPDATED` refreshes a case at once.
    - **Shippo:** live carrier tracking (USPS, UPS, FedEx, DHL and more) for the agent and the evidence dossier.
    - **Google Address Validation:** Risk Radar flags mail-drop addresses (USPS CMRA), undeliverable addresses and business addresses.
    - **Slack, Discord and Zapier / Make / n8n:** alerts for new disputes, cases needing approval, Autopilot actions, PayPal rulings, high-risk orders and deadlines. The automation webhook is signed with HMAC-SHA256.
    - **Deadline calendar:** an iCal feed of response deadlines with a reminder a day before, for Google Calendar, Outlook or Apple Calendar.
17. **The demo shop** uses PayPal **Orders API v2** and the **JavaScript SDK** checkout buttons, so you can make real sandbox purchases and open real sandbox disputes against them.

### Demo scenarios (included)

| Dispute | What the agent finds | Recommendation |
|---|---|---|
| Headphones, "never arrived", $129 | USPS delivered to the address with a photo; the NFC tag in the box was tapped 2.5 hours after delivery; buyer has 2 prior "not received" claims | **Fight**, ~93% win odds |
| Mug set, "one arrived chipped", $64 | 1 of 4 damaged, policy says refund that item's share, loyal customer | **Offer $16**, keep $48 |
| Smartwatch, "unauthorized", $289.99 | Freight forwarder, billing ≠ shipping, 1-day-old account, foreign IP | **Accept**: it's fraud and can't be won |
| Tote bags, "where is it?", $42.50 | Delayed by weather, now at the local post office | **Reply** with tracking, no refund |

---

## Quick start (2 minutes, no keys needed)

**Fastest:** [open it in StackBlitz](https://stackblitz.com/github/Arunarena/dispute-defender). It runs in your browser with nothing to install (Chrome or Edge on desktop).

Or run it locally. Requires **Node.js 20+**.

```bash
git clone https://github.com/Arunarena/dispute-defender.git
cd dispute-defender
npm install
npm start
```

Open **http://localhost:3000**. With no keys set, the app runs in **demo mode**: built-in sample disputes, and a scripted agent in place of Claude. Both are labeled in the header.

### Try each feature

| Feature | Where | Notes |
|---|---|---|
| AI investigation | Click a dispute → **⚡ Deploy AI agent** → **Approve** | Start with the headphones case |
| Negotiation | Mug set dispute → **🤝 Negotiation arena** | Inquiry-stage cases only |
| Autopilot | Turn on the **🤖 Autopilot** switch, then click **📡 Simulate dispute** | |
| NFC Tap-to-Confirm | Headphones dispute → **PACKAGE TAG · NFC**, or Risk Radar → **📦 Ship** an order → **👆 Simulate buyer tap** | The buyer page opens in a new tab. Confirm, or report a problem, and watch the dashboard react |
| Passkey approval | **🔌 Integrations** → **🔐 Register a passkey on this device**, then approve any dispute | Works on `localhost` with Windows Hello, Touch ID or a phone (Chrome, Edge, Safari) |
| Install as an app | **⬇ Install app** in the header (Chrome/Edge), or the install icon in the address bar | iPhone: open the hosted URL in Safari → Share → Add to Home Screen |
| Risk Radar, Insights, Track Record | The tabs at the top | |
| Copilot | **Ctrl+K**, or the 🛡️ button | Try "brief me" |

**On a phone (real NFC stickers, iPhone install, phone passkeys):** a phone can't open `localhost`, so use the hosted Render URL (see [Deploy to Render](#deploy-to-render-hosted-demo)).
- **Write a sticker:** open the URL in **Chrome on Android**, go to Risk Radar, ship an order, tap **✍️ Write NFC tag** and hold a blank NTAG213/215 sticker to the back of the phone.
- **Tap it:** use any iPhone or Android phone.

### Turn on real PayPal + real AI

```bash
cp .env.example .env    # Windows: copy .env.example .env
```

Fill in `.env`:

| Variable | Where to get it | What it turns on |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | [developer.paypal.com](https://developer.paypal.com) → Apps & Credentials → **Sandbox** → Create App | Live sandbox disputes plus demo-shop checkout |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Claude (`claude-opus-5-5`) for the agent, vision and negotiation |
| `PAYPAL_WEBHOOK_ID` (optional) | Your sandbox app → **Webhooks** → add `https://<host>/api/webhooks/paypal` for `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, `CUSTOMER.DISPUTE.RESOLVED` and `PAYMENT.CAPTURE.COMPLETED` | Real-time Autopilot, outcome learning, and Risk Radar for every checkout. Signatures are checked with PayPal's verify-webhook-signature API |

Optional extras, each switched on by its own key (see [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for setup):

| Variable | What it turns on |
|---|---|
| `SHIPPO_API_KEY` | Live carrier tracking. A `shippo_test_` key works with Shippo's `SHIPPO_DELIVERED` test number, which demo-shop orders then use |
| `GOOGLE_MAPS_API_KEY` | Address checks in Risk Radar (enable the Address Validation API on the key) |
| `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL` | Alerts in a Slack or Discord channel |
| `OUTBOUND_WEBHOOK_URL`, `OUTBOUND_WEBHOOK_SECRET` | Every event as signed JSON, for Zapier, Make or n8n |
| `PUBLIC_URL` | Your public address, used for links in alerts and the calendar (Render sets this for you) |
| `DEADLINE_ALERT_HOURS` | When to send the deadline reminder (default 48 hours before) |
| `NFC_TAG_SECRET` | Signs NFC tag links. Optional: one is generated and saved in `data/` if unset. Set it on Render so written tags survive redeploys |

Turn on **Transaction search** under your sandbox app's features to let the agent read the buyer's PayPal history.

Restart with `npm start`. Both badges in the header should now show live mode.

### Create a real sandbox dispute end to end

1. On developer.paypal.com → **Testing Tools → Sandbox Accounts**, note your sandbox **personal** (buyer) login.
2. Open **http://localhost:3000/shop.html** and buy an item with the PayPal button, logging in as the sandbox buyer. The store records the order with a (simulated) tracking number.
3. Log in to **https://www.sandbox.paypal.com** as the buyer → **Resolution Center** → report a problem with that payment (for example, "item not received").
4. Back in Dispute Defender, click ↻. The dispute appears. Click **Analyze with AI**, review the recommendation, then **Approve**.

---

## Android companion app

[mobile/](mobile/) is a separate Android app (Capacitor). It connects to this server so you can review AI recommendations, approve responses, see PayPal's rulings and get alerts about new disputes from your phone. See [mobile/README.md](mobile/README.md) to build the APK and connect it.

## Run it in your browser (no install, no account)

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/Arunarena/dispute-defender)

StackBlitz runs the Node server inside your browser tab (best in Chrome or Edge on a desktop). It installs, starts and opens the dashboard in demo mode, with no keys needed. The first load takes about a minute.

A [Dockerfile](deploy/huggingface/Dockerfile) that builds the app straight from this repo is also included for any Docker host.

## Deploy to Render (hosted demo)

This repo includes a [render.yaml](render.yaml) blueprint.

1. Push this repo to GitHub.
2. In [Render](https://dashboard.render.com): **New → Blueprint**, then pick the repo.
3. Optionally fill in `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ANTHROPIC_API_KEY` and `PAYPAL_WEBHOOK_ID`. Leave them empty for demo mode.
4. Deploy. For Autopilot with real webhooks, point a PayPal sandbox webhook at `https://<your-app>.onrender.com/api/webhooks/paypal`.

On Render's free plan the app sleeps when idle, so the first visit takes a few extra seconds.

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
| [src/dossier.js](src/dossier.js) | Evidence dossier PDF builder (pdfkit) |
| [src/copilot.js](src/copilot.js) | Voice/chat Copilot: Claude agent with data tools and app-action tools |
| [src/risk.js](src/risk.js) | Risk Radar: order fraud and dispute-risk scoring |
| [src/insights.js](src/insights.js) | Dispute analytics and the AI profit-leak report |
| [src/outcomes.js](src/outcomes.js) | Track Record: outcome ledger, case patterns and win-odds calibration |
| [public/views.js](public/views.js) | Risk Radar and Insights screens, charts |
| [public/copilot.js](public/copilot.js) | Copilot panel, speech recognition and speech output |
| [src/photos.js](src/photos.js) | Photo evidence storage and Claude vision analysis |
| [src/negotiate.js](src/negotiate.js) | Agent-vs-agent negotiation arena |
| [src/autopilot.js](src/autopilot.js) | Autopilot rules and decision logic |
| [src/integrations.js](src/integrations.js) | Integration catalog, live/demo status and the call log |
| [src/carriers.js](src/carriers.js) | Shippo live carrier tracking, with the store's records as fallback |
| [src/address.js](src/address.js) | Google Address Validation for Risk Radar |
| [src/notify.js](src/notify.js) | Slack, Discord and signed automation-webhook alerts |
| [src/calendar.js](src/calendar.js) | iCal feed of dispute deadlines |
| [src/passkeys.js](src/passkeys.js) | Passkey registration, approval and one-time approval tokens (SimpleWebAuthn) |
| [public/passkey.js](public/passkey.js) | Browser side of passkeys: create, sign, retry the approved request |
| [public/sw.js](public/sw.js), [public/manifest.webmanifest](public/manifest.webmanifest) | Installable app: service worker and manifest |
| [src/nfc.js](src/nfc.js) | NFC Tap-to-Confirm: signed tag links, tap recording, evidence for the agent |
| [public/tap.html](public/tap.html) | The page a buyer's phone opens when it taps the box |
| [public/nfc.js](public/nfc.js) | Seller-side tag writing (Web NFC) and tap timeline |
| [src/claude.js](src/claude.js) | Shared Claude client and structured-output helper |
| [src/scripted.js](src/scripted.js) | Rules-based stand-in agent for keyless demo mode |
| [src/demoData.js](src/demoData.js) | Sample disputes and store data |
| [src/server.js](src/server.js) | HTTP API and streaming of agent progress |
| [public/](public/) | Dashboard and demo shop UI |

### AI tools used

- **Claude Opus 5.5 (`claude-opus-5-5`) through the Anthropic TypeScript/JS SDK (`@anthropic-ai/sdk`).** The agent runs with the SDK's **tool runner**. Claude decides which back-office lookups to make for each dispute reason (for example, it skips tracking on a fraud case and checks it first on a "not received" case). It weighs the evidence the way a PayPal adjudicator would, then calls `submit_recommendation`. That tool has a strict Zod schema, so the UI always receives valid structured output: verdict, odds, reasons, PayPal `evidence_type`, carrier tracking, offer amount and drafted text.
- **Vision:** each photo is sent to Claude as an image along with the dispute context. Claude returns structured findings (summary, visible facts, which side the photo supports, confidence).
- **Negotiation:** two Claude roles take turns. The seller agent sees the store's private data (orders, tracking, policies). The buyer agent sees only what the buyer wrote. Each turn returns a structured message, refund amount and decision, and amounts are clamped to the disputed total.
- **Copilot:** a Claude agent with read-only data tools plus "action" tools that drive the UI. Voice uses the browser's speech recognition and speech synthesis.
- **Outcome learning:** after the agent files its recommendation, the server sorts the case into a pattern (for example "not received, delivered with signature") and blends the agent's win odds with the results of similar past cases. The more past cases there are, the more weight they get. On the sample history this lowers prediction error (Brier score) by about 12%, measured leave-one-out so each case is graded without its own result.
- **Risk Radar and Insights:** structured-output calls. Risk returns a score, level, action and signed signals. Insights interprets aggregates that the code has already computed, so it can't invent numbers.
- **Safety:** every tool the agent can call is read-only. Money only moves after a person approves, and with a passkey registered that approval needs a fingerprint, face or PIN. Server-side refusal fallbacks are enabled (`fallbacks: "default"`).
- **Demo mode** uses a scripted rules engine ([src/scripted.js](src/scripted.js)) so judges can click through without an API key. The header shows which engine is active.

### PayPal technologies used

- **Disputes API v1:** list disputes, show details, provide evidence (multipart, with `tracking_info` and photo files), make an offer, accept a claim, send a message.
- **Webhooks:** `CUSTOMER.DISPUTE.CREATED` triggers Autopilot, `CUSTOMER.DISPUTE.UPDATED` refreshes the case, `CUSTOMER.DISPUTE.RESOLVED` records the ruling for the Track Record, and `PAYMENT.CAPTURE.COMPLETED` sends each checkout to Risk Radar. Signatures are checked with `/v1/notifications/verify-webhook-signature`.
- **Add Tracking API:** `POST /v2/checkout/orders/{id}/track` when an order ships from Risk Radar.
- **Payments API v2:** `POST /v2/payments/captures/{id}/refund` for **Cancel & refund** on risky orders.
- **Transaction Search API:** `GET /v1/reporting/transactions`, used by the agent for the buyer's PayPal history.
- **Orders API v2:** create, capture and read orders (demo shop, and orders that arrive by webhook).
- **PayPal JavaScript SDK:** checkout buttons in the demo shop.
- **OAuth 2.0 client credentials:** sandbox authentication.

---

## Notes and limits

- Carrier tracking is simulated unless `SHIPPO_API_KEY` is set. With a Shippo key, the agent's tracking checks are live.
- Demo-mode actions are simulated and reset when the server restarts.
- Some dispute actions are only allowed at certain stages. For example, offers and messages only work in the **inquiry** stage. The agent is told this, and PayPal returns a clear error if an action isn't allowed.

## License

[MIT](LICENSE)
