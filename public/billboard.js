// Live billboard: stays hidden, and slides in only when something happens at the shop
// (new orders, disputes, AI decisions, rulings, package taps), then tucks away again.
while (!window.DD) await new Promise((r) => setTimeout(r, 50));
const DD = window.DD;
const el = document.getElementById("billboard");
const esc = DD.esc;
const usd = (n) => `$${Number(n ?? 0).toFixed(2)}`;
const first = (s = "") => s.split(" ")[0];
const VERB = { FIGHT: "evidence sent", OFFER_PARTIAL_REFUND: "partial refund offered", ACCEPT_CLAIM: "claim accepted", SEND_MESSAGE: "reply sent" };
const LABEL = { FIGHT: "FIGHT", OFFER_PARTIAL_REFUND: "SETTLE", ACCEPT_CLAIM: "ACCEPT", SEND_MESSAGE: "REPLY" };
const SHOW_MS = 8000;

el.innerHTML = `<div class="bb-tag"><span class="bb-dot"></span>LIVE</div>
  <div class="bb-track"><div class="bb-flash" id="bb-flash"></div></div>
  <button class="bb-close" title="Hide">✕</button>`;
const flashEl = el.querySelector("#bb-flash");

const caseName = (id) => {
  const d = DD.state.disputes.find((x) => x.id === id);
  return d ? `${first(d.buyerName)}'s ${String(d.item ?? "").replace(/\s*\(.*\)/, "")}` : id;
};

let hideTimer = null;
function hide() { el.classList.remove("show"); }
el.querySelector(".bb-close").onclick = hide;
// Hovering keeps it open so it can be read.
el.onmouseenter = () => clearTimeout(hideTimer);
el.onmouseleave = () => { if (el.classList.contains("show")) hideTimer = setTimeout(hide, 2500); };

function push(icon, html, kind = "") {
  flashEl.innerHTML = `<span class="bb-breaking">${kind === "alert" ? "BREAKING" : "NEW"}</span><i>${icon}</i><span class="bb-text">${html}</span>`;
  el.classList.remove("flashing", "k-good", "k-alert", "k-warn", "k-none");
  void el.offsetWidth; // restart the slide-in
  el.classList.add("show", "flashing", kind ? `k-${kind}` : "k-none");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, SHOW_MS);
}

window.addEventListener("dd-event", ({ detail: ev }) => {
  switch (ev.type) {
    case "dispute_new":
      return push("🚨", `New dispute: <b>${esc(ev.dispute.buyerName)}</b> · ${esc(ev.dispute.item)} · <b>${esc(DD.money(ev.dispute.amount))}</b>`, "alert");
    case "order_new":
      return push("🛒", `New order: <b>${esc(ev.order.buyerName)}</b> bought ${esc(ev.order.item ?? "an item")} · <b>${usd(ev.order.total)}</b>`, "good");
    case "order_scored":
      if (ev.order.level === "HIGH") return push("🛑", `Risk Radar held <b>${esc(ev.order.buyerName)}</b>'s ${usd(ev.order.total)} order · risk ${ev.order.score}`, "alert");
      if (ev.order.level === "MEDIUM") return push("✍️", `<b>${esc(ev.order.buyerName)}</b>'s order: ship with signature · risk ${ev.order.score}`, "warn");
      return push("✅", `<b>${esc(ev.order.buyerName)}</b>'s order looks safe · ship it`, "good");
    case "autopilot_decision":
      return push("🤖", `Agent decided: <b>${esc(caseName(ev.disputeId))}</b> → <b>${LABEL[ev.verdict] ?? ev.verdict}</b>${ev.verdict === "FIGHT" ? ` · ${ev.odds}%` : ""}${ev.auto ? "" : " · waiting for you"}`, ev.auto ? "good" : "warn");
    case "action":
      return push("📤", `Sent to PayPal: <b>${esc(caseName(ev.entry.disputeId))}</b> · ${VERB[ev.entry.verdict] ?? "response sent"}${Number(ev.entry.saved) ? ` · <b class="g">+${usd(ev.entry.saved)}</b>` : ""}`, "good");
    case "outcome": {
      const o = ev.entry;
      if (o.outcome === "LOST") return push("⚖️", `PayPal ruled for the buyer on <b>${esc(caseName(o.disputeId))}</b>`, "warn");
      return push(o.outcome === "WON" ? "🏆" : "🤝", `${o.outcome === "WON" ? "WON" : "Settled"}: <b>${esc(caseName(o.disputeId))}</b> · kept <b class="g">${usd(o.kept)}</b>`, "good");
    }
    case "package_tap": {
      const m = { OPEN: ["📲", "tapped the box"], CONFIRM_OK: ["📦", "confirmed it arrived OK"], PROBLEM: ["⚠️", "reported a problem"] }[ev.kind];
      if (m) push(m[0], `<b>${esc(ev.buyerName)}</b> ${m[1]} · ${esc(ev.item)}`, ev.kind === "PROBLEM" ? "warn" : "good");
      return;
    }
    case "dispute_update":
      if (ev.message?.by === "BUYER") push("💬", `<b>${esc(caseName(ev.disputeId))}</b>: “${esc(ev.message.content.slice(0, 80))}${ev.message.content.length > 80 ? "…" : ""}”`);
      return;
    case "deadline":
      return push("⏰", `<b>${esc(first(ev.buyerName))}'s ${esc(ev.item)}</b>: ${ev.hoursLeft}h left to respond`, "alert");
    case "triage_done":
      return push("🧭", `AI triaged <b>${ev.n}</b> disputes · every case has a plan`, "good");
  }
});
