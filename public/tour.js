// Guided tour: the best moments of the app, one click each. Opens on the first visit, from the
// 🎬 Tour button, or with ?tour=1 in the address. Each step drives the real app through window.DD.
const STEPS = [
  {
    title: "AI investigates a dispute",
    note: "Headphones \"never arrived\". Watch the agent pull the order, carrier tracking, the delivery photo and the NFC tag, then recommend FIGHT at 93%.",
    go: (DD) => DD.investigate("PP-D-DEMO-1001"),
  },
  {
    title: "It refunds when the buyer is right",
    note: "A real double charge: two payments 41 seconds apart, one box shipped. The agent says refund it instead of fighting a case you'd lose.",
    go: (DD) => DD.investigate("PP-D-DEMO-1006"),
  },
  {
    title: "It catches friendly fraud",
    note: "\"I don't recognize this charge\", yet the delivery was signed by the account holder and they tapped the box's NFC tag to say it arrived OK.",
    go: (DD) => DD.investigate("PP-D-DEMO-1007"),
  },
  {
    title: "Refund already sent",
    note: "The buyer says they were never refunded. The store's records show refund REF-6K2208 went out 9 days ago, so the agent fights with proof of refund.",
    go: (DD) => DD.investigate("PP-D-DEMO-1005"),
  },
  {
    title: "Negotiation arena",
    note: "One chipped mug in a set of four. Two AI agents negotiate a fair partial refund, round by round.",
    go: (DD) => DD.negotiate("PP-D-DEMO-1002"),
  },
  {
    title: "Autopilot on a live dispute",
    note: "Turns Autopilot on and simulates PayPal's webhook. A new dispute arrives and is investigated and answered by your rules, hands-free.",
    go: async (DD) => {
      DD.showView("disputes");
      await DD.saveRules({ enabled: true });
      await DD.simulate();
    },
  },
  {
    title: "Stop fraud before it ships",
    note: "Risk Radar scores every new order. Try SCORE on the 4 backpacks going to a parcel locker, then Ship or Cancel & refund.",
    go: (DD) => DD.showView("radar"),
  },
  {
    title: "NFC Tap-to-Confirm",
    note: "Each box gets an NFC sticker. Scroll to the package tag on the headphones case and press SIMULATE BUYER TAP to open the buyer's page.",
    go: async (DD) => {
      await DD.open("PP-D-DEMO-1001");
      setTimeout(() => document.querySelector(".nfc-card")?.scrollIntoView({ behavior: "smooth", block: "center" }), 600);
    },
  },
  {
    title: "It learns from PayPal's rulings",
    note: "The Track Record compares predicted odds with real outcomes and adjusts future odds per case pattern.",
    go: (DD) => DD.showView("track"),
  },
  {
    title: "Ask Defender by voice or text",
    note: "The copilot can brief you, find urgent cases and run actions. Try \"brief me\" or press Ctrl+K.",
    go: () => document.querySelector("#copilot-orb")?.click(),
  },
  {
    title: "Integrations",
    note: "PayPal Disputes, Tracking, Refunds, Transactions and Webhooks, plus Shippo, Google Address Validation, Slack, Discord, calendar feed, passkeys and NFC, each with a live call log.",
    go: (DD) => DD.showView("integrations"),
  },
];

const KEY = "dd-tour-done";
const done = new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const box = document.createElement("aside");
box.className = "tour hidden";
box.id = "tour";
document.body.appendChild(box);

function render() {
  box.innerHTML = `<div class="tour-head"><b>🎬 GUIDED TOUR</b><span>${done.size}/${STEPS.length}</span><button class="cp-icon" id="tour-close" title="Close">✕</button></div>
    <p class="tour-intro">Demo mode: sample store data, scripted AI, simulated PayPal calls. Click a step to see it live.</p>
    <ol class="tour-steps">${STEPS.map((s, i) => `<li class="${done.has(i) ? "done" : ""}"><button data-step="${i}"><span class="tour-n">${done.has(i) ? "✓" : i + 1}</span><span><b>${esc(s.title)}</b><small>${esc(s.note)}</small></span></button></li>`).join("")}</ol>
    <div class="tour-foot"><button class="mini-btn" id="tour-reset">Reset progress</button><a class="mini-btn" href="https://github.com/Arunarena/dispute-defender" target="_blank" rel="noopener">Source on GitHub ↗</a></div>`;
  box.querySelector("#tour-close").onclick = () => toggle(false);
  box.querySelector("#tour-reset").onclick = () => {
    done.clear();
    localStorage.setItem(KEY, "[]");
    render();
  };
  box.querySelectorAll("[data-step]").forEach((b) => {
    b.onclick = async () => {
      const i = Number(b.dataset.step);
      done.add(i);
      localStorage.setItem(KEY, JSON.stringify([...done]));
      render();
      try {
        await STEPS[i].go(window.DD);
      } catch (err) {
        window.DD?.toast?.("TOUR STEP FAILED", err.message, "warn");
      }
    };
  });
}

function toggle(show = box.classList.contains("hidden")) {
  box.classList.toggle("hidden", !show);
  if (show) render();
  localStorage.setItem("dd-tour-seen", "1");
}

// A header button, next to Simulate.
const btn = document.createElement("button");
btn.className = "sim-btn tour-btn";
btn.id = "tour-btn";
btn.textContent = "🎬 Tour";
btn.title = "Guided tour of the best features";
btn.onclick = () => toggle();
document.querySelector("#simulate")?.before(btn);

// Open on the first visit or with ?tour=1, once the app is ready.
const wanted = new URLSearchParams(location.search).has("tour") || !localStorage.getItem("dd-tour-seen");
if (wanted) {
  const wait = setInterval(() => {
    if (window.DD?.showView) {
      clearInterval(wait);
      toggle(true);
    }
  }, 100);
}
