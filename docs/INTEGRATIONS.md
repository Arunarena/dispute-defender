# Integrations

Dispute Defender works with no keys. Each integration below turns on by itself when its key is set in `.env`. Until then it runs in **demo mode**, and the **🔌 Integrations** tab logs the call it would have made. The same tab shows which integrations are live, what each one does, and every call made this session.

## Built in

### PayPal

| API | Where it's used | Why it matters |
|---|---|---|
| **Disputes API v1** | List, read, `provide-evidence`, `make-offer`, `accept-claim`, `send-message` | The core of the app |
| **Add Tracking API**: `POST /v2/checkout/orders/{id}/track` | Risk Radar → **Ship** / **Ship + signature** | The tracking number goes onto the PayPal transaction and the buyer is notified. Seller Protection asks for valid tracking on "item not received" claims, so many of those disputes never start. |
| **Payments API v2**: `POST /v2/payments/captures/{id}/refund` | Risk Radar → **💸 Cancel & refund** | A refund before shipping costs only the sale. A chargeback later also costs a fee, the goods and a mark on your dispute rate. Works on held orders too, after verification fails. |
| **Transaction Search API**: `GET /v1/reporting/transactions` | Agent tool `get_paypal_payment_history` | The agent checks the buyer's real PayPal history with your store (payments, refunds, reversals, chargebacks) instead of relying only on the store's records. Turn on **Transaction search** in your app's features. Data can lag a few hours, and one query covers at most 31 days. |
| **Webhooks** | `CUSTOMER.DISPUTE.CREATED` → Autopilot · `CUSTOMER.DISPUTE.UPDATED` → instant refresh · `CUSTOMER.DISPUTE.RESOLVED` → Track Record · `PAYMENT.CAPTURE.COMPLETED` → Risk Radar | Every PayPal checkout on the account is scored before it ships, not only demo-shop orders. The app fetches the order (`GET /v2/checkout/orders/{id}`) for payer and shipping details. |
| **Orders API v2 + JS SDK** | Demo shop | Real sandbox purchases to dispute |

Webhook URL: `https://<your-host>/api/webhooks/paypal`. Signatures are verified with `/v1/notifications/verify-webhook-signature`.

### Evidence and fraud signals

**Shippo carrier tracking** (`SHIPPO_API_KEY`)
- `GET https://api.goshippo.com/tracks/{carrier}/{number}`. One API covers USPS, UPS, FedEx, DHL and many more carriers.
- The agent's `track_shipment` tool uses it. Results are cached into the store so the evidence dossier and Track Record use the same facts.
- If the lookup fails, or the carrier has never seen the number (like the demo's sample numbers), the agent falls back to the store's record and is told the live check failed.
- **Test key:** a `shippo_test_…` key only knows test numbers. Demo-shop orders then ship with `SHIPPO_DELIVERED`, so the full path can be tried end to end.

**Google Address Validation** (`GOOGLE_MAPS_API_KEY`, with the Address Validation API enabled)
- `POST https://addressvalidation.googleapis.com/v1:validateAddress` with USPS CASS for US addresses.
- Risk Radar checks each shipping address before scoring and adds signals: **mail-drop (USPS CMRA)** +22, **undeliverable** +14, **unconfirmed parts** +6, **business address** +5. Claude sees the same facts when it scores.

### NFC Tap-to-Confirm

Shipping an order in Risk Radar creates a tag for it. Each tag holds a link like `https://<host>/t/tg-1a2b3c4d5e.<signature>`, signed with HMAC-SHA256 so nobody can guess another order's link.

1. **Write it.** In Chrome on Android, open the dashboard over HTTPS (your Render URL) and tap **✍️ Write NFC tag**, then hold a blank NTAG213/215/216 sticker to the phone. This uses the Web NFC API (`NDEFReader.write`). On other devices, **🔗 Copy link** and write it with any NFC writer app.
2. **Stick it inside the box.**
3. **The buyer taps the box.** iPhones (XS and later) and Android phones open NFC links natively, so no app is needed. `public/tap.html` records an `OPEN` tap (time and device type, never the full user agent). The buyer can then confirm arrival (with optional GPS) or report a problem with a note and photo.
4. **The seller is told at once.** You get a dashboard toast, plus Slack, Discord and Zapier alerts for confirmations and problems.
5. **The agent uses it.** `check_package_tag` returns the taps, with hours since the carrier's delivery scan. The evidence PDF lists them.

In demo mode, **👆 Simulate buyer tap** opens the same buyer page.

**Limits:** a plain NTAG213 stores a fixed link, so a copied link could be replayed, and the agent is told to treat a tap as strong but not cryptographic proof. For production, **NTAG 424 DNA** tags with SUN messages add a fresh AES-CMAC signature and counter to every tap. Verifying those server-side is the next step.

### Alerts and automation

| Channel | Key | Notes |
|---|---|---|
| **Slack** | `SLACK_WEBHOOK_URL` (an incoming webhook) | Plain-text alerts with a link that opens the case |
| **Discord** | `DISCORD_WEBHOOK_URL` (channel → Integrations → Webhooks) | Same alerts |
| **Zapier / Make / n8n** | `OUTBOUND_WEBHOOK_URL`, `OUTBOUND_WEBHOOK_SECRET` | JSON `{ event, text, data, sent_at }`. Header `X-Defender-Signature: sha256=<hex HMAC-SHA256 of the raw body>`. Also receives `action`, `dispute_update` and `order_decision`, which are too noisy for chat. |

Alerts sent: new dispute · needs your approval · Autopilot action · PayPal ruling · high-risk order · deadline reminder (`DEADLINE_ALERT_HOURS`, default 48). Each channel has a **▶ Send test** button on the Integrations tab.

To check a signature on the receiving side:

```js
const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-defender-signature"]));
```

### Deadline calendar

`GET /api/calendar.ics` returns an iCalendar feed with one event per open dispute, timed at the response deadline, with a reminder a day before. In Google Calendar choose **Other calendars → From URL** (this needs a public URL such as your Render deploy). Locally, use **⬇ .ics** on the Integrations tab and import the file.

Set `PUBLIC_URL` so links in alerts and calendar events point to your deployed app. On Render, `RENDER_EXTERNAL_URL` is used automatically.

## Roadmap: more integrations worth building

Ordered roughly by value for a small seller.

| Idea | API | What it would add |
|---|---|---|
| **Store platform sync** | Shopify Admin GraphQL (`orders`, `fulfillments`), WooCommerce REST `/wp-json/wc/v3/orders` | Replace the demo back office with the seller's real orders, fulfillments and customer history. This is the biggest step from demo to product. |
| **Dispute appeals and returns** | PayPal Disputes `appeal`, `acknowledge-return-item`, `provide-supporting-info` | Appeal a lost case with new evidence. Confirm returned items so "not as described" cases close in your favor. |
| **IP and device risk** | MaxMind minFraud, IPQualityScore, or PayPal's own risk signals (STC / `PayPal-Client-Metadata-Id`) | Replace the self-reported IP country with VPN, proxy and device-reputation checks in Risk Radar |
| **Buyer email and SMS** | Resend / SendGrid, Twilio | Send the buyer tracking and delivery updates before they open a dispute. Ask unhappy buyers to reply instead of filing a claim. |
| **Doorbell and warehouse evidence** | Packing-station camera uploads, signed-delivery images from carriers (Shippo / EasyPost) | More proof-of-delivery and packing photos for the vision step and the dossier |
| **Helpdesk sync** | Zendesk, Gorgias, Freshdesk | Pull the buyer's support tickets into the investigation. Post the AI's recommendation back as an internal note. |
| **Finance view** | PayPal Balances / Reporting APIs, QuickBooks / Xero | Show disputes' real cost (fees, reserves, held funds) and book refunds and recovered funds automatically |
| **Multi-seller SaaS** | PayPal Partner Referrals + third-party permissions | Let any PayPal seller connect their account in one click instead of pasting API keys |
| **Two-way chat ops** | Slack interactive messages / Discord buttons | Approve or reject a recommendation straight from the alert, with the same human-approval rule |
