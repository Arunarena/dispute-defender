# Demo video script (target 2:45, hard limit 3:00)

**Setup before recording**
- Restart the server (`npm start`) so the demo data is fresh.
- Browser at 1440×900 or larger, zoom 100%, bookmarks bar hidden.
- Autopilot switch **off** at the start.
- Use no music, or only royalty-free music (the rules ban copyrighted music).
- Record the screen in one take per scene. Cut between scenes.

Narration is about 400 words, which runs about 2:45 at a calm pace.

---

### 0:00–0:15 · Hook
**Screen:** Dashboard. Slowly hover over the dispute cards.

> "When a buyer opens a PayPal dispute, a small seller has days to respond, and the evidence is scattered across their store, the carrier and their inbox. Most just refund and lose the sale. Dispute Defender is an AI agent that fights back for them."

### 0:15–0:55 · The agent investigates
**Screen:** Click the **headphones** dispute ($129, "never arrived"). Scroll past the buyer's message and the carrier photo. Click **⚡ DEPLOY AI AGENT**. Let the processing screen play. Don't skip it.

> "This buyer says the headphones never arrived. I deploy the agent. Claude pulls the order, checks the carrier's tracking, reviews this buyer's history, reads our store policy, and inspects the delivery photo with vision. It reads the house number, 418, and the GPS stamp, and checks them against the shipping address."

### 0:55–1:20 · The verdict
**Screen:** Verdict appears. Pause on the FIGHT stamp and gauge, then scroll slowly over the journey map, address check and buyer intel tiles. Click **✓ APPROVE · SUBMIT EVIDENCE**. Let the transmission animation finish.

> "Verdict: fight, with high win odds. The carrier confirms delivery, the addresses match, and this buyer has made the same claim twice before. It drafts the evidence notes, and I approve. Nothing reaches PayPal without me. It goes out through the Disputes API with the tracking number and the delivery photo attached."

### 1:20–1:55 · Agent vs. agent negotiation
**Screen:** Click the **mug set** dispute ($64, one mug chipped). Click **Scan with AI vision** on the buyer's photo and let it finish. Click **🤝 NEGOTIATION ARENA**. Let it run to the deal.

> "Not every case is worth fighting. Here, vision confirms one of four mugs really is chipped, so we negotiate. Our seller agent rehearses against a simulated buyer agent built from the buyer's own words. Watch the offers converge: sixteen, thirty-two, and a deal at twenty-four. That keeps forty dollars instead of refunding sixty-four, and one click sends it to the real buyer as a PayPal offer."

**Screen:** Click **✓ SEND OFFER VIA PAYPAL**.

### 1:55–2:35 · Autopilot
**Screen:** Point at the Autopilot panel. Flip the switch **on**. Show the sliders. Click **📡 Simulate incoming dispute** three times, about a second apart. Let the alerts and card updates play.

> "Now, Autopilot. PayPal sends a webhook the moment a dispute opens, and the agent handles it at once, but only within rules I set. Fight automatically above eighty percent odds and under two hundred dollars. Settle small refunds under twenty-five. Here come three disputes. It fights the speaker claim and settles the napkins on its own. But this two-hundred-nineteen-dollar fraud case is over my limit, so it waits for my approval. Every action is logged with the rule that allowed it."

### 2:35–2:50 · Close
**Screen:** Zoom out to the full dashboard, showing the "Revenue protected" number and the action log.

> "Dispute Defender: Claude for reasoning and vision, PayPal's Disputes, Orders and Webhooks APIs to act. It protects revenue, saves sellers hours, and keeps a human in charge."

---

**If you run with real keys:** Claude's wording and numbers will differ from the demo data. Do a dry run first and adjust the spoken numbers to match.
