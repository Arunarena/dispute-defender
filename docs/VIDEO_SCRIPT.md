# Demo video script (target 2:50, hard limit 3:00)

The video has two recordings, edited together:
- **Demo recording** (scenes 1–5 and 7): the sample disputes. Use the GitHub Page, or run locally **without** PayPal keys.
- **Sandbox recording** (scene 6): a real PayPal sandbox dispute. Run locally **with** your PayPal sandbox keys.

**Setup before recording**
- Demo recording: restart the server (`npm start`) or reload the GitHub Page so the demo data is fresh. Autopilot switch **off** at the start.
- Browser at 1440×900 or larger, zoom 100%, bookmarks bar hidden.
- Use no music, or only royalty-free music (the rules ban copyrighted music).
- Record one take per scene. Cut between scenes.

**Sandbox recording, prepare first (not on camera)**
1. In the demo shop (`http://localhost:3000/shop.html`), buy an item with the PayPal button, logged in as your sandbox **personal** (buyer) account.
2. Have a private window open at **sandbox.paypal.com**, logged in as that buyer, on the payment you just made.
3. Don't escalate the dispute. PayPal's sandbox can't issue a ruling, so the scene ends when the evidence reaches the buyer.

Narration is about 400 words, which runs about 2:50 at a calm pace.

---

### 1 · 0:00–0:12 · Hook
**Screen:** Dashboard. Press **Ctrl+K**, click the mic and say "Brief me". Let Copilot answer out loud.

> "When a buyer opens a PayPal dispute, a small seller has days to respond, and the evidence is scattered everywhere. Most just refund. Dispute Defender is an AI that fights back."

### 2 · 0:12–0:35 · The agent investigates
**Screen:** Click the **headphones** dispute ($129, "never arrived"). Scroll past the buyer's message and the carrier photo. Click **⚡ DEPLOY AI AGENT**. The processing screen takes about 4 seconds. Let it play.

> "This buyer says the headphones never arrived. I deploy the agent. It pulls the order, the carrier tracking, the buyer's history and our policy, and reads the delivery photo: house number 418, GPS stamp, matching the shipping address."

### 3 · 0:35–1:00 · The verdict
**Screen:** Verdict appears. Pause on the FIGHT stamp and gauge, then scroll over the journey map, address check and buyer tiles. Scroll to **PACKAGE TAG · NFC** and hover the tap 2.5 hours after delivery. Click **✓ APPROVE · SUBMIT EVIDENCE**.

> "Verdict: fight. The carrier confirms delivery, the addresses match, and this buyer has made the same claim twice. And the NFC tag sealed in the box was tapped two and a half hours after delivery. I approve, and the evidence goes to PayPal's Disputes API. Nothing is sent without me."

### 4 · 1:00–1:30 · Agent vs. agent negotiation
**Screen:** Click the **mug set** dispute ($64, one mug chipped). Click **Scan with AI vision** on the buyer's photo. Click **🤝 NEGOTIATION ARENA** and let it run to the deal. Click **✓ SEND OFFER VIA PAYPAL**.

> "Not every case is worth fighting. Vision confirms one of four mugs is chipped, so our seller agent negotiates against a buyer agent built from the buyer's own words. A deal at twenty-four dollars keeps forty instead of refunding sixty-four, sent to the real buyer as a PayPal offer."

### 5 · 1:30–1:55 · Autopilot
**Screen:** Flip the **Autopilot** switch on. Show the sliders. Click **📡 Simulate dispute** three times, about a second apart. Let the alerts play.

> "Autopilot. PayPal's webhook fires the moment a dispute opens, and the agent acts within my rules: fight above eighty percent odds under two hundred dollars, settle small refunds. The speaker claim is fought and the napkins settled automatically. The two-hundred-nineteen-dollar fraud case is over my limit, so it waits for me."

### 6 · 1:55–2:25 · Real PayPal sandbox *(sandbox recording)*
**Screen:**
1. Buyer window (sandbox.paypal.com): open the payment, click **Report a problem → I didn't receive it**, submit.
2. *Cut* past PayPal's wait (1–4 minutes). The dispute appears in Dispute Defender by itself.
3. Click it → **⚡ DEPLOY AI AGENT** → **✓ APPROVE**. Hold on the green **✓ Delivered to PayPal** line.
4. Buyer window: refresh. Show the seller's response on the buyer's case. Check this in a dry run, since PayPal's sandbox layout varies.

> "And this isn't a mock-up. Here's a real PayPal sandbox account. The buyer files a dispute in PayPal, it lands in Dispute Defender within seconds, the agent investigates, I approve, and our response shows up on the buyer's side in PayPal."

### 7 · 2:25–2:50 · Prevention and close
**Screen:** Click the **🛰️ Risk Radar** tab and let the scan run. Click **HOLD & VERIFY** on Kevin's $579 order. Flash the **📊 Insights** and **🧠 Track Record** tabs.

> "It prevents disputes too. Risk Radar scores every PayPal order before it ships, and this one is fraud. Hold it, and the dispute never happens."

> "Dispute Defender: Claude for reasoning, vision and voice, and PayPal's Disputes, Orders and Webhooks APIs to act. It protects revenue, saves sellers hours, and keeps a human in charge."

---

**Timing tips**
- Rehearse once with a timer. If you run long, trim scene 5 to two simulated disputes.
- **If you run with a Claude key:** Claude's wording and numbers will differ from the demo data, and the processing screen takes longer. Do a dry run and adjust the spoken numbers.
