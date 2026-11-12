const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REASONS = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: ["NOT RECEIVED", "inr"],
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: ["NOT AS DESCRIBED", "snad"],
  UNAUTHORISED: ["UNAUTHORIZED", "unauth"],
  CREDIT_NOT_PROCESSED: ["REFUND NOT RECEIVED", "cnp"],
  DUPLICATE_TRANSACTION: ["DUPLICATE CHARGE", "dup"],
  INCORRECT_AMOUNT: ["WRONG AMOUNT", "dup"],
  CANCELED_RECURRING_BILLING: ["SUBSCRIPTION CANCELLED", "cnp"],
};
const VERDICTS = {
  FIGHT: { label: "FIGHT", action: "SUBMIT EVIDENCE", api: "provide-evidence", color: "var(--green)" },
  OFFER_PARTIAL_REFUND: { label: "PARTIAL REFUND", action: "SEND OFFER", api: "make-offer", color: "var(--violet)" },
  ACCEPT_CLAIM: { label: "ACCEPT", action: "ACCEPT CLAIM", api: "accept-claim", color: "var(--red)" },
  SEND_MESSAGE: { label: "REPLY", action: "SEND MESSAGE", api: "send-message", color: "var(--cyan)" },
};
const MODULES = {
  lookup_order: { icon: "🧾", name: "ORDER DB" },
  track_shipment: { icon: "🚚", name: "CARRIER LINK" },
  get_customer_history: { icon: "👤", name: "BUYER INTEL" },
  get_store_policies: { icon: "📜", name: "POLICY VAULT" },
  inspect_photos: { icon: "📸", name: "PHOTO FORENSICS" },
  track_record: { icon: "🧠", name: "TRACK RECORD" },
};
const OUTCOMES = {
  WON: { label: "WON", text: "PayPal ruled for you", color: "var(--green)" },
  SETTLED: { label: "SETTLED", text: "Buyer accepted your offer", color: "var(--violet)" },
  LOST: { label: "LOST", text: "PayPal ruled for the buyer", color: "var(--red)" },
};

const imgFor = (name = "") => {
  const n = name.toLowerCase();
  if (n.includes("plush") || n.includes("mochi")) return "/img/plush.svg";
  if (n.includes("strawberry")) return "/img/strawberry-mug.svg";
  if (n.includes("bow headphone")) return "/img/bow-headphones.svg";
  if (n.includes("heart") && n.includes("backpack")) return "/img/heart-backpack.svg";
  if (n.includes("headphone") || n.includes("headset")) return "/img/headphones.svg";
  if (n.includes("mug")) return "/img/mug.svg";
  if (n.includes("watch")) return "/img/watch.svg";
  if (n.includes("backpack")) return "/img/backpack.svg";
  if (n.includes("tote") || n.includes("bag")) return "/img/tote.svg";
  if (n.includes("blanket") || n.includes("throw")) return "/img/blanket.svg";
  if (n.includes("coffee") || n.includes("brew")) return "/img/coffee.svg";
  if (n.includes("speaker") || n.includes("boombox")) return "/img/speaker.svg";
  if (n.includes("cutting board") || n.includes("bamboo")) return "/img/board.svg";
  return "/img/box.svg";
};
const initials = (name = "?") => name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const money = (a) => `$${Number(a.value).toFixed(2)}`;
const reasonPill = (r) => {
  const [label, cls] = REASONS[r] ?? [String(r ?? "OTHER").replaceAll("_", " "), ""];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
};
const daysLeft = (iso) => (iso ? Math.ceil((new Date(iso) - Date.now()) / 86400000) : null);
const isDone = (s) => ["RESOLVED", "UNDER_REVIEW", "WAITING_FOR_BUYER_RESPONSE"].includes(s);

let state = { disputes: [], activity: [], selected: null, config: {}, current: null, stats: {}, apStatus: {}, fresh: new Set() };

async function api(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}), ...(window.Passkey?.headers() ?? {}) };
  let res = await fetch(path, { ...opts, headers });
  let data = await res.json();
  // Money moves only after a passkey check: ask for it, then send the same request once more.
  if (res.status === 401 && data.passkey === "required" && window.Passkey) {
    const label = data.label ?? "Approve this action";
    toast("🔐 CONFIRM WITH YOUR PASSKEY", label, "");
    let token;
    try {
      token = await window.Passkey.approve(data.action);
    } catch (err) {
      throw new Error(err.name === "NotAllowedError" ? "Passkey check cancelled. Nothing was sent." : err.message);
    }
    res = await fetch(path, { ...opts, headers: { ...headers, "X-Approval-Token": token } });
    data = await res.json();
    if (res.ok) toast("🔐 PASSKEY VERIFIED", label, "good");
  }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ---------------- header ----------------

async function loadConfig() {
  state.config = await api("/api/config");
  const c = state.config;
  $("#modes").innerHTML = `
    <span class="mode ${c.paypalMode === "sandbox" ? "" : "off"}">● ${c.paypalMode === "sandbox" ? "PAYPAL SANDBOX" : "DEMO DATA"}</span>
    <span class="mode ${c.aiMode === "claude" ? "" : "off"}" title="${c.aiMode === "claude" ? "Claude runs every investigation, vision check, negotiation and Copilot answer." : "Demo mode: a built-in stand-in plays the agent so anyone can try the app without an API key. Set ANTHROPIC_API_KEY to run Claude."}">● ${c.aiMode === "claude" ? esc(c.model).toUpperCase() : "DEMO AGENT"}</span>`;
}

// ---------------- list + stats ----------------
async function loadList() {
  try {
    const data = await api("/api/disputes");
    state.disputes = data.disputes;
    state.activity = data.activity;
  } catch (e) {
    $("#dispute-list").innerHTML = `<div class="error">${esc(e.message)}</div>`;
    return;
  }
  renderList();
  renderStats();
  renderActivity();
  renderBriefing();
}

function spark(seed, color) {
  let y = 14;
  const pts = Array.from({ length: 16 }, (_, i) => {
    y = Math.max(3, Math.min(23, y + Math.sin(seed * 7 + i * 1.7) * 6));
    return `${(i * 100) / 15},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg class="spark" viewBox="0 0 100 26" preserveAspectRatio="none"><polyline points="${pts}" fill="none" style="stroke:${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" opacity=".8"/></svg>`;
}

function countUp(el, to, { prefix = "", suffix = "", decimals = 0 } = {}) {
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = to;
  const start = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - start) / 900);
    const v = from + (to - from) * (1 - Math.pow(1 - p, 3));
    el.textContent = prefix + v.toFixed(decimals) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderStats() {
  const open = state.disputes.filter((d) => !isDone(d.status));
  const atStake = open.reduce((s, d) => s + Number(d.amount.value), 0);
  const saved = state.activity.reduce((s, a) => s + Number(a.saved || 0), 0);
  const soon = open.filter((d) => (daysLeft(d.sellerResponseDue) ?? 99) <= 5).length;
  const cards = [
    ["open", "NEEDS RESPONSE", "⚠️", "var(--amber)", open.length, {}],
    ["stake", "MONEY AT STAKE", "💰", "var(--magenta)", atStake, { prefix: "$", decimals: 2 }],
    ["soon", "DUE IN ≤ 5 DAYS", "⏱️", "var(--red)", soon, {}],
    ["saved", "REVENUE PROTECTED", "🛡️", "var(--green)", saved, { prefix: "$", decimals: 2 }],
  ];
  if (!$("#stats").children.length) {
    $("#stats").innerHTML = cards
      .map(([k, label, ico, color], i) => `<div class="stat" style="--accent:${color}"><div class="top"><span class="label">${label}</span><span class="ico">${ico}</span></div><div class="value" id="stat-${k}">0</div>${spark(i + 1, color)}</div>`)
      .join("");
  }
  for (const [k, , , , val, opts] of cards) countUp($(`#stat-${k}`), val, opts);
  updateKept(saved);
}

function renderList() {
  if (!state.disputes.length) {
    $("#dispute-list").innerHTML = `<p class="muted">No disputes.</p>`;
    return;
  }
  $("#dispute-list").innerHTML = state.disputes
    .map((d) => {
      const days = daysLeft(d.sellerResponseDue);
      const done = isDone(d.status);
      const dueTxt = done ? `✓ ${d.status.replaceAll("_", " ")}` : days == null ? "" : days <= 0 ? "OVERDUE" : `⏱ ${days}d LEFT`;
      const ap = state.apStatus[d.id];
      return `<button class="dcard ${state.selected === d.id ? "active" : ""} ${state.fresh.has(d.id) ? "new" : ""}" data-id="${esc(d.id)}">
        <img src="${imgFor(d.item)}" alt="" />
        <div>
          <div class="row">${reasonPill(d.reason)}<span class="amt">${money(d.amount)}</span></div>
          <div class="item">${esc(d.item ?? d.id)}</div>
          <div class="who">${esc(d.buyerName ?? "")}</div>
          <div class="due ${done ? "resolved" : days != null && days <= 5 ? "soon" : ""}">${esc(dueTxt)}${d.photos ? ` · 📸 ${d.photos}` : ""}${!done && d.ai ? " " + verdictChip(d.ai) : ""}</div>
          ${ap ? `<div class="ap-status">${ap.busy ? '<span class="spinner-s"></span>' : ""}🤖 ${esc(ap.text)}</div>` : ""}
        </div>
      </button>`;
    })
    .join("");
  document.querySelectorAll(".dcard").forEach((b) => (b.onclick = () => selectDispute(b.dataset.id)));
}

function renderActivity() {
  if (!state.activity.length) return;
  $("#activity").innerHTML = state.activity
    .map((a) => `<li><b>✓ ${esc(VERDICTS[a.verdict]?.label ?? a.verdict)}</b><span class="src ${esc(a.source)}">${esc(a.source ?? "MANUAL")}</span> · ${esc(a.disputeId)}${a.rule ? `<br/><span class="muted">rule: ${esc(a.rule)}</span>` : ""}${a.photosAttached ? `<br/><span class="muted">📎 ${a.photosAttached} file(s) attached (dossier + photos)</span>` : ""}<br/><code>${esc(a.call)}${a.simulated ? " (simulated)" : ` → ${a.paypalStatus}`}</code></li>`)
    .join("");
}

// ---------------- morning briefing (shown until a dispute is picked) ----------------
const verdictChip = (ai) =>
  ai?.verdict ? `<span class="vchip" style="--vc:${VERDICTS[ai.verdict]?.color}">${esc(VERDICTS[ai.verdict]?.label ?? ai.verdict)}${ai.verdict === "FIGHT" && ai.win != null ? ` · ${ai.win}%` : ""}</span>` : "";

// What the plan is likely worth: a fight keeps the money only as often as it wins.
const expectedKeep = (ai) => (Number(ai.saved) || 0) * (ai.verdict === "FIGHT" ? (ai.win ?? 0) / 100 : 1);

function renderBriefing() {
  if (state.selected || state.triaging) return;
  const open = state.disputes.filter((d) => !isDone(d.status)).sort((a, b) => (daysLeft(a.sellerResponseDue) ?? 99) - (daysLeft(b.sellerResponseDue) ?? 99));
  if (!open.length) return;
  const atStake = open.reduce((s, d) => s + Number(d.amount.value), 0);
  const next = open[0];
  const nextDays = daysLeft(next.sellerResponseDue);
  const triaged = open.filter((d) => d.ai);
  const all = triaged.length === open.length;
  const count = (v) => triaged.filter((d) => d.ai.verdict === v).length;
  const keepMax = triaged.reduce((s, d) => s + (Number(d.ai.saved) || 0), 0);
  const keepExp = triaged.reduce((s, d) => s + expectedKeep(d.ai), 0);
  const quick = triaged.filter((d) => d.ai.verdict === "FIGHT" && d.ai.win >= 85).length;

  $("#detail").innerHTML = `
    <div class="brief">
      <div class="brief-head">
        <div>
          <div class="brief-kicker">☀️ MORNING BRIEFING</div>
          <h2>${open.length} disputes need you · ${money({ value: atStake })} at stake</h2>
          <p class="muted">Next deadline: <b>${esc(next.buyerName ?? "")}</b>'s ${esc(next.item ?? "case")} in <b>${nextDays ?? "?"} day${nextDays === 1 ? "" : "s"}</b>.</p>
        </div>
        <button class="cta" id="triage">${all ? "⟳ RE-CHECK ALL" : `⚡ TRIAGE ALL ${open.length} WITH AI`}</button>
      </div>
      ${triaged.length ? `
      <div class="brief-sum">
        ${[["FIGHT", "fight"], ["OFFER_PARTIAL_REFUND", "settle"], ["SEND_MESSAGE", "reply"], ["ACCEPT_CLAIM", "accept"]]
          .map(([v, word]) => `<div class="bs" style="--vc:${VERDICTS[v].color}"><b>${count(v)}</b><span>${word}</span></div>`).join("")}
        <div class="bs keep"><b>${money({ value: keepExp })}</b><span>expected to keep${keepMax > keepExp + 0.5 ? ` · up to ${money({ value: keepMax })}` : ""}</span></div>
      </div>
      ${quick ? `<p class="brief-tip">💡 ${quick} case${quick === 1 ? " has" : "s have"} 85%+ win odds. Approving ${quick === 1 ? "it" : "them"} takes about a minute.</p>` : ""}` : ""}
      <div class="brief-list">
        ${open.map((d) => {
          const days = daysLeft(d.sellerResponseDue);
          return `<button class="brow" data-id="${esc(d.id)}">
            <img src="${imgFor(d.item)}" alt="" />
            <span class="bi"><b>${esc(d.item ?? d.id)}</b><small>${esc(d.buyerName ?? "")} · ${reasonPill(d.reason)}</small></span>
            <span class="bd ${days != null && days <= 5 ? "soon" : ""}">${days == null ? "" : `${days}d`}</span>
            <span class="ba">${money(d.amount)}</span>
            <span class="bv" id="bv-${esc(d.id)}">${d.ai ? verdictChip(d.ai) : '<span class="dash"></span>'}</span>
            <span class="bk ${d.ai && !Number(d.ai.saved) ? "muted" : ""}">${!d.ai ? "" : Number(d.ai.saved) ? `keeps ${money({ value: Number(d.ai.saved) })}` : "full refund"}</span>
          </button>`;
        }).join("")}
      </div>
    </div>`;
  $("#triage").onclick = triageAll;
  // Count the expected-keep figure up when it changes.
  const kb = $(".bs.keep b");
  if (kb && state.lastKeep !== keepExp) { state.lastKeep = keepExp; countUp(kb, keepExp, { prefix: "$", decimals: 2 }); }
  document.querySelectorAll(".brow").forEach((b) => (b.onclick = () => selectDispute(b.dataset.id)));
}

async function triageAll() {
  if (state.triaging) return;
  state.triaging = true;
  const btn = $("#triage");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-s"></span> INVESTIGATING…';
  document.querySelectorAll(".brow .bv").forEach((el) => (el.innerHTML = '<span class="spinner-s"></span>'));
  const think = thinkPanel();
  let n = 0, total = 0;
  await new Promise((resolve) => {
    const es = new EventSource("/api/triage");
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === "start") { total = ev.total; think.start(total); }
      if (ev.type === "step") think.step(ev);
      if (ev.type === "item") {
        n++;
        btn.innerHTML = `<span class="spinner-s"></span> ${n} / ${total} DONE`;
        think.item(ev, n, total);
        const el = document.getElementById(`bv-${ev.id}`);
        if (el) el.innerHTML = ev.error ? `<span class="muted">⚠ ${esc(ev.error)}</span>` : verdictChip(ev);
        el?.closest(".brow")?.classList.add("flash");
      }
      if (ev.type === "done" || ev.type === "error") { es.close(); resolve(); }
    };
    es.onerror = () => { es.close(); resolve(); };
  });
  think.finish(n);
  window.dispatchEvent(new CustomEvent("dd-event", { detail: { type: "triage_done", n } }));
  await sleep(1400); // let the last lines land before the briefing redraws
  state.triaging = false;
  await loadList();
  toast("🧭 TRIAGE COMPLETE", `${n} disputes have a plan. Open any case to review and approve it.`, "good");
}

// Live feed under the briefing header: one line per thing the agent checks.
const STEP_ICON = { lookup_order: "🧾", track_shipment: "🚚", get_customer_history: "👤", get_store_policies: "📜", check_package_tag: "🏷️", inspect_photos: "📸", track_record: "🧠" };
function thinkPanel() {
  const box = document.createElement("div");
  box.className = "think";
  box.innerHTML = `<div class="think-head"><span class="think-dot"></span><b>Agent is investigating</b><span class="think-n"></span></div>
    <div class="think-bar"><i></i></div><ul class="think-feed"></ul>`;
  $(".brief-head")?.after(box);
  const feed = box.querySelector(".think-feed");
  const itemName = (id) => state.disputes.find((d) => d.id === id)?.item ?? id;
  const add = (html, cls = "") => {
    feed.insertAdjacentHTML("afterbegin", `<li class="${cls}">${html}</li>`);
    while (feed.children.length > 5) feed.lastElementChild.remove();
  };
  return {
    start(total) { box.querySelector(".think-n").textContent = `0 / ${total}`; },
    step(ev) { add(`<span class="ti">${STEP_ICON[ev.name] ?? "•"}</span><b>${esc(itemName(ev.id))}</b><span class="tt">${esc(ev.text)}</span>`); },
    item(ev, n, total) {
      box.querySelector(".think-n").textContent = `${n} / ${total}`;
      box.querySelector(".think-bar i").style.width = `${(n / total) * 100}%`;
      if (ev.error) return add(`<span class="ti">⚠️</span><b>${esc(itemName(ev.id))}</b><span class="tt">${esc(ev.error)}</span>`, "bad");
      const v = VERDICTS[ev.verdict];
      add(`<span class="ti">✅</span><b>${esc(itemName(ev.id))}</b><span class="tv" style="--vc:${v?.color}">${esc(v?.label ?? ev.verdict)}${ev.verdict === "FIGHT" && ev.win != null ? ` · ${ev.win}%` : ""}</span>`, "fin");
    },
    finish(n) {
      box.classList.add("finished");
      box.querySelector(".think-head b").textContent = `Done: ${n} plan${n === 1 ? "" : "s"} ready`;
    },
  };
}

// ---------------- money ticker + celebrations ----------------
let keptShown = null;
async function updateKept(total) {
  const el = $("#kept-v");
  if (!el) return;
  // Wait for the "transmitting" overlay to close so the bump is visible.
  for (let i = 0; i < 40 && keptShown !== null && !$("#transmit")?.classList.contains("hidden"); i++) await sleep(200);
  if (keptShown === null) { keptShown = total; el.dataset.v = total; el.textContent = money({ value: total }); return; }
  if (total === keptShown) return;
  const gain = total - keptShown;
  keptShown = total;
  countUp(el, total, { prefix: "$", decimals: 2 });
  if (gain <= 0) return;
  const pill = $("#kept");
  pill.classList.remove("bump"); void pill.offsetWidth; pill.classList.add("bump");
  const logo = $(".shield");
  if (logo) { logo.classList.remove("zap"); void logo.offsetWidth; logo.classList.add("zap"); }
  const f = document.createElement("span");
  f.className = "kept-float";
  f.textContent = `+${money({ value: gain })}`;
  pill.appendChild(f);
  setTimeout(() => f.remove(), 1600);
  chime();
}

// Two soft notes, like a register. Quiet on purpose.
let audioCtx;
function chime() {
  try {
    audioCtx ??= new AudioContext();
    const t = audioCtx.currentTime;
    // Kawaii gets a three-note sparkle instead of the register sound.
    const notes = window.DDTheme?.isKawaii() ? [[1567.98, 0], [2093, 0.07], [2637, 0.14]] : [[1318.5, 0], [1975.5, 0.09]];
    notes.forEach(([hz, at]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.06, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.35);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + at); o.stop(t + at + 0.4);
    });
  } catch {}
}

// Full-screen moment when PayPal rules for us.
function celebrate(entry) {
  const won = entry.outcome === "WON";
  const m = OUTCOMES[entry.outcome];
  const cute = window.DDTheme?.isKawaii();
  const el = document.createElement("div");
  el.className = `celebrate ${won ? "won" : "settled"}`;
  const icon = cute ? `<img src="${document.querySelector("link[rel=icon]").getAttribute("href").replace(/shield\.svg$/, "mochi.svg")}" alt="" />` : won ? "🏆" : "🤝";
  const title = cute ? (won ? "YAY! WE WON 💖" : "SWEET DEAL 🎀") : won ? "DISPUTE WON" : "SETTLED";
  if (cute) setTimeout(() => window.DDTheme.peek(won ? "We did it! 🎀💖" : "Fair and sweet 🍓"), 900);
  el.innerHTML = `<div class="cel-rays"></div><div class="cel-card">
      <div class="cel-trophy">${icon}</div>
      <div class="cel-title">${title}</div>
      <div class="cel-amt">+${money({ value: Number(entry.kept) })}</div>
      <div class="cel-sub">${esc(m.text)}</div></div>`;
  document.body.appendChild(el);
  const fire = (x, y) => burst(x, y);
  fire(innerWidth / 2, innerHeight / 2);
  setTimeout(() => fire(innerWidth * 0.3, innerHeight * 0.4), 180);
  setTimeout(() => fire(innerWidth * 0.7, innerHeight * 0.4), 320);
  chime(); setTimeout(chime, 260);
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 400); };
  el.onclick = close;
  setTimeout(close, 2600);
}

// ---------------- detail ----------------
async function selectDispute(id) {
  state.selected = id;
  renderList();
  $("#detail").innerHTML = `<p class="muted" style="font-family:var(--mono)">Loading…</p>`;
  // On narrow screens the case sits below the list, so bring it into view.
  if (matchMedia("(max-width: 1000px)").matches) $("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const data = await api(`/api/disputes/${encodeURIComponent(id)}`);
    state.current = data;
    renderDetail();
  } catch (e) {
    $("#detail").innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}

function ring(days, total = 10) {
  const r = 38, c = 2 * Math.PI * r;
  const frac = days == null ? 0 : Math.max(0, Math.min(1, days / total));
  const color = days == null ? "var(--muted)" : days <= 3 ? "var(--red)" : days <= 6 ? "var(--amber)" : "var(--green)";
  return `<div class="ring"><svg width="92" height="92"><circle cx="46" cy="46" r="${r}" style="stroke:rgba(var(--glass-rgb),.08)" stroke-width="7" fill="none"/>
    <circle cx="46" cy="46" r="${r}" stroke-width="7" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}" style="stroke:${color};filter:drop-shadow(0 0 6px ${color})"/></svg>
    <div class="lbl"><div><b>${days == null ? "–" : Math.max(0, days)}</b>days left</div></div></div>`;
}

function renderDetail({ withRec = true } = {}) {
  const { dispute: d, recommendation: rec } = state.current;
  const name = d.items.map((i) => i.name).join(", ") || "Disputed transaction";
  $("#detail").innerHTML = `
    <div class="hero">
      <img class="pic" src="${imgFor(name)}" alt="" />
      <div>
        <h2>${esc(name)}</h2>
        <div class="sub">${esc(d.buyerName)} · <span class="case-id">${esc(d.id)}</span></div>
        <div class="pills">${reasonPill(d.reason)}<span class="pill stage">${esc(d.stage)}</span><span class="pill ${isDone(d.status) ? "status-done" : "stage"}">${esc(d.status.replaceAll("_", " "))}</span></div>
      </div>
      <div class="countdown"><div class="bigamt">${money(d.amount)}</div>${ring(daysLeft(d.sellerResponseDue))}</div>
    </div>

    <div id="ruling"></div>

    <div class="section-title">💬 BUYER SAYS</div>
    <div class="thread">
      ${d.messages.map((m) => `<div class="msg ${esc(m.by)}"><div class="avatar">${m.by === "BUYER" ? esc(initials(d.buyerName)) : m.by === "SELLER" ? "YOU" : "PP"}</div><div class="bubble"><div class="meta">${m.by === "BUYER" ? esc(d.buyerName) : esc(m.by)} · ${new Date(m.time).toLocaleString()}</div>${esc(m.content)}</div></div>`).join("") || `<p class="muted">No messages.</p>`}
    </div>

    <div class="section-title">📷 PHOTO EVIDENCE</div>
    <div class="photos" id="photos"></div>

    <div id="nfc-tag"></div>

    <div class="analyze-row">
      <button class="cta" id="analyze">${rec ? "⟳ RE-RUN ANALYSIS" : "⚡ DEPLOY AI AGENT"}</button>
      <button class="cta alt" id="negotiate" ${d.stage === "INQUIRY" && !isDone(d.status) ? "" : "disabled"} title="${d.stage === "INQUIRY" ? "" : "PayPal only allows offers in the inquiry stage"}">🤝 NEGOTIATION ARENA</button>
    </div>
    <div id="rec"></div>`;
  $("#analyze").onclick = () => analyze(d);
  $("#negotiate").onclick = () => openArena(d);
  renderPhotos();
  renderTag();
  renderRuling();
  if (rec && withRec) renderRecommendation(false);
}

// ---------------- NFC package tag (Tap-to-Confirm) ----------------
function renderTag() {
  const el = $("#nfc-tag");
  if (!el || !window.NFC) return;
  const { dispute: d, intel, packageTagUrl, packageTagLocal } = state.current;
  const tag = intel?.packageTag;
  if (!tag) {
    // No tag yet (for example, the order shipped before tags existed): offer to make one.
    if (!d.transactionId) return (el.innerHTML = "");
    el.innerHTML = `<div class="section-title">🏷️ PACKAGE TAG</div>
      <div class="nfc-card"><button class="mini-btn" id="nfc-create">🏷️ CREATE NFC TAG FOR THIS ORDER</button></div>`;
    $("#nfc-create").onclick = async () => {
      $("#nfc-create").disabled = true;
      try {
        await api("/api/nfc/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disputeId: d.id }) });
        const fresh = await api(`/api/disputes/${encodeURIComponent(d.id)}`);
        if (state.current?.dispute?.id === d.id) {
          state.current = { ...fresh, recommendation: state.current.recommendation ?? fresh.recommendation };
          renderTag();
        }
        toast("🏷️ TAG CREATED", "Write it to a sticker, or simulate a buyer tap.", "good");
      } catch (err) {
        toast("COULDN'T CREATE TAG", err.message, "warn");
        $("#nfc-create").disabled = false;
      }
    };
    return;
  }
  const afterDelivery = tag.taps.some((t) => t.hoursAfterDelivery != null && t.hoursAfterDelivery >= 0);
  const flag =
    d.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" && afterDelivery ? `<div class="nfc-flag">⚡ A phone tapped the tag inside the box after delivery. That contradicts "never arrived".</div>`
    : tag.buyerReportedProblem ? `<div class="nfc-flag warn">⚠ The buyer reported a problem when they tapped the package.</div>`
    : tag.buyerConfirmedOk ? `<div class="nfc-flag">✅ The buyer confirmed the order arrived OK.</div>`
    : "";
  el.innerHTML = `<div class="section-title">🏷️ PACKAGE TAG</div>
    <div class="nfc-card ${flag ? "strong" : ""}">${flag}${window.NFC.timeline(tag)}${packageTagUrl ? window.NFC.actions({ id: tag.tagId }, packageTagUrl, { localOnly: packageTagLocal }) : ""}</div>`;
  window.NFC.bind(el, toast);
}

// ---------------- outcome: PayPal's ruling vs. the agent's prediction ----------------
function renderRuling() {
  const el = $("#ruling");
  if (!el) return;
  const { outcome: o, pending: p, canSimulateRuling, sandboxTools } = state.current;
  if (o) {
    const m = OUTCOMES[o.outcome];
    const verdict = VERDICTS[o.verdict]?.label ?? o.verdict;
    const check = o.correct === null ? "no win to check" : o.correct ? "✓ the plan worked" : "✗ the plan didn't work";
    el.innerHTML = `<div class="ruling done" style="--oc:${m.color}">
      <div class="r-stamp">⚖️ ${m.label}</div>
      <div><b>${m.text}.</b> You kept <b>$${Number(o.kept).toFixed(2)}</b> of $${Number(o.amount).toFixed(2)}.<br/>
      <span class="muted">${esc(verdict)}${o.verdict === "FIGHT" && o.odds ? ` · predicted ${o.odds}%` : ""} · ${check}</span></div>
      <button class="mini-btn" id="see-track">🧠 TRACK RECORD</button>
    </div>`;
    $("#see-track").onclick = () => window.DD.showView("track");
    return;
  }
  if (!p) {
    el.innerHTML = sandboxTools ? sandboxPanel() : "";
    if (sandboxTools) bindSandboxPanel();
    return;
  }
  el.innerHTML = `<div class="ruling">
    <div class="r-stamp wait">⏳ AWAITING RULING</div>
    <div>Response sent · ${esc(VERDICTS[p.verdict]?.label ?? p.verdict)}${p.verdict === "FIGHT" && p.odds ? ` · predicted ${p.odds}%` : ""}</div>
    ${canSimulateRuling ? `<button class="cta alt" id="sim-ruling">⚖️ SIMULATE PAYPAL RULING</button>` : ""}
  </div>`;
  if (canSimulateRuling) $("#sim-ruling").onclick = () => simulateRuling(state.current.dispute.id);
}

// Sandbox-only control: hand a case that PayPal is still holding to the seller (doesn't exist on live PayPal).
function sandboxPanel() {
  const d = state.current.dispute;
  if (d.status !== "UNDER_REVIEW") return "";
  return `<div class="ruling sandbox">
    <div class="r-stamp wait">🧪 SANDBOX</div>
    <div>With PayPal · response locked</div>
    <div class="sb-actions"><button class="mini-btn" id="sb-evidence">⏩ HAND CASE TO SELLER</button></div>
  </div>`;
}

function bindSandboxPanel() {
  const id = state.current.dispute.id;
  const btn = $("#sb-evidence");
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "⏩ ASKING PAYPAL…";
    try {
      await api(`/api/disputes/${encodeURIComponent(id)}/require-evidence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      toast("✓ CASE HANDED TO YOU", "PayPal now waits for your response. Run the agent and approve.", "good");
      state.current = await api(`/api/disputes/${encodeURIComponent(id)}`);
      if (state.selected === id) renderDetail();
      await loadList();
    } catch (e) {
      toast("SANDBOX CALL FAILED", e.message, "warn");
      if (state.selected === id) renderRuling();
    }
  };
}

async function simulateRuling(id) {
  const btn = $("#sim-ruling");
  btn.disabled = true;
  btn.textContent = "⚖️ PAYPAL IS REVIEWING…";
  try {
    await sleep(900);
    const { entry, outcome } = await api(`/api/disputes/${encodeURIComponent(id)}/ruling`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (state.current?.dispute.id === id) {
      state.current = await api(`/api/disputes/${encodeURIComponent(id)}`);
      renderDetail();
    }
    const result = entry ?? (typeof outcome === "object" ? outcome : null);
    if (result && result.outcome !== "LOST") celebrate(result);
    await loadList();
  } catch (e) {
    toast("RULING FAILED", e.message, "warn");
    btn.disabled = false;
  }
}

// ---------------- war room (AI processing screen) ----------------
class WarRoom {
  constructor(d) {
    this.d = d;
    this.queue = [];
    this.fast = false;
    this.closed = false;
    this.toolsDone = 0;
    this.el = $("#warroom");
    this.term = $("#terminal");
  }

  open() {
    this.el.classList.remove("hidden");
    $("#wr-complete").classList.add("hidden");
    this.term.innerHTML = "";
    $("#wr-target").textContent = `TARGET ${this.d.id} · ${money(this.d.amount)}`;
    $("#modules").innerHTML = Object.entries(MODULES)
      .map(([k, m]) => `<div class="module" id="mod-${k}"><div class="mi">${m.icon}</div><div class="mn">${m.name}</div><div class="ms">STANDBY</div></div>`)
      .join("");
    this.setProgress(0);
    $("#wr-skip").textContent = "skip ▸";
    $("#wr-skip").onclick = () => {
      this.fast = true;
      if (this.failed) this.close();
    };
    this.startMatrix();
    this.startHex();
    this.pump();
  }

  close() {
    this.closed = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.hexTimer);
    this.el.classList.add("hidden");
  }

  setProgress(p) {
    $("#wr-bar").style.width = `${p}%`;
    $("#wr-pct").textContent = `${Math.round(p)}%`;
  }

  module(name, cls, status) {
    const m = $(`#mod-${name}`);
    if (!m) return;
    m.className = `module ${cls}`;
    m.querySelector(".ms").textContent = status;
  }

  line(text, cls = "") { this.queue.push({ text, cls }); }
  run(fn) { this.queue.push({ fn }); }
  async pump() {
    while (!this.closed) {
      const item = this.queue.shift();
      if (!item) { await sleep(40); continue; }
      if (item.fn) { await item.fn(); continue; }
      const div = document.createElement("div");
      div.className = `ln ${item.cls}`;
      this.term.querySelector(".cursor")?.remove();
      this.term.appendChild(div);
      const cursor = document.createElement("span");
      cursor.className = "cursor";
      const speed = this.fast ? 400 : 8;
      for (let i = 0; i < item.text.length; i += speed) {
        div.textContent = item.text.slice(0, i + speed);
        div.appendChild(cursor);
        this.term.scrollTop = this.term.scrollHeight;
        await sleep(this.fast ? 0 : 8);
      }
      if (!this.fast) await sleep(25);
    }
  }

  drained() {
    return new Promise((resolve) => this.run(async () => resolve()));
  }

  startMatrix() {
    const c = $("#matrix");
    const ctx = c.getContext("2d");
    const resize = () => { c.width = innerWidth; c.height = innerHeight; };
    resize();
    const size = 16;
    const cols = Math.ceil(c.width / size);
    const drops = Array.from({ length: cols }, () => Math.random() * -50);
    const chars = "アイウエオカキクケコサシスセソ0123456789ABCDEF$€¥₿<>/{}";
    const cs = getComputedStyle(document.documentElement);
    const cyan = cs.getPropertyValue("--cyan").trim(), green = cs.getPropertyValue("--green").trim();
    const fade = `rgba(${cs.getPropertyValue("--deep-rgb").trim()},0.12)`;
    let last = 0;
    const draw = (t) => {
      this.raf = requestAnimationFrame(draw);
      if (t - last < 45) return;
      last = t;
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.font = `${size}px JetBrains Mono, monospace`;
      drops.forEach((y, i) => {
        ctx.fillStyle = Math.random() > 0.97 ? "#ffffff" : i % 7 === 0 ? cyan : green;
        ctx.fillText(chars[Math.floor(Math.random() * chars.length)], i * size, y * size);
        drops[i] = y * size > c.height && Math.random() > 0.975 ? 0 : y + 1;
      });
    };
    this.raf = requestAnimationFrame(draw);
  }

  startHex() {
    const box = $("#hexdump");
    const rows = [];
    this.hexTimer = setInterval(() => {
      const addr = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
      const bytes = Array.from({ length: 8 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join(" ");
      rows.push(`${addr}  ${bytes}`);
      if (rows.length > 22) rows.shift();
      box.textContent = rows.join("\n");
    }, 110);
  }
}

function detailLines(name, result) {
  if (!result || typeof result !== "object") return [[String(result), "ok"]];
  if (result.error) return [[`  ✗ ${result.error}`, "warn"]];
  if (name === "lookup_order")
    return [
      [`  ✓ order ${result.orderId} · ${result.items?.map((i) => i.name).join(", ")}`, "ok"],
      [`    ship-to : ${result.shippingAddress}`, ""],
      [`    bill-to : ${result.billingAddress}`, result.billingAddress === result.shippingAddress ? "" : "warn"],
      [`    carrier : ${result.shipping?.carrier} ${result.shipping?.trackingNumber}  ip:${result.ipCountry}`, ""],
    ];
  if (name === "track_shipment")
    return [
      ...result.events.map((e) => [`    [${new Date(e.time).toLocaleDateString()}] ${e.location} :: ${e.detail}`, ""]),
      [`  ✓ status: ${result.status}`, result.status === "DELIVERED" ? "ok" : "warn"],
    ];
  if (name === "get_customer_history")
    return [
      [`  ✓ account age ${result.accountAgeDays}d · ${result.orders} orders · $${result.totalSpent} lifetime`, "ok"],
      [`    prior disputes: ${result.priorDisputes}`, result.priorDisputes ? "warn" : ""],
      [`    note: ${result.notes}`, ""],
    ];
  if (name === "get_store_policies") return [["  ✓ policy document loaded (6 clauses)", "ok"]];
  if (name === "inspect_photos")
    return result.photos.length
      ? result.photos.flatMap((p) => [
          [`  ▣ [${p.source}] ${p.caption ?? p.label}`, ""],
          ...(p.findings ?? []).slice(0, 3).map((f) => [`      · ${f}`, "dim"]),
          [`    ⇒ supports ${p.favors} (${p.confidence}% confidence)`, p.favors === "SELLER" ? "ok" : p.favors === "BUYER" ? "warn" : ""],
        ])
      : [["  ✓ no photos attached", "dim"]];
  if (name === "track_record") {
    if (!result.fought.n) return [[`  ✓ pattern: ${result.label}`, "ok"], ["    no fought cases like this yet · odds unchanged", "dim"]];
    return [
      [`  ✓ pattern: ${result.label}`, "ok"],
      [`    ${result.fought.won}/${result.fought.n} similar fought cases won (${result.fought.rate}%)`, ""],
      [`    agent estimate ${result.raw}% → calibrated ${result.calibrated}%`, Math.abs(result.shift) >= 10 ? "warn" : "ok"],
    ];
  }
  return [[`  ✓ ${JSON.stringify(result).slice(0, 120)}`, "ok"]];
}

function analyze(d) {
  const wr = new WarRoom(d);
  wr.open();
  const engine = state.config.aiMode === "claude" ? state.config.model : "scripted-demo";
  wr.line(`${d.id} · ${money(d.amount)} · agent: ${engine}`, "big");

  let result = null;
  const es = new EventSource(`/api/disputes/${encodeURIComponent(d.id)}/analyze`);
  es.onmessage = async (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "status") wr.line(`// ${ev.message}`, "think");
    if (ev.type === "note") wr.line(`// ${ev.message.replace(/\s+/g, " ").slice(0, 220)}`, "think");
    if (ev.type === "tool") {
      wr.run(() => wr.module(ev.name, "scan", "SCANNING…"));
      wr.line(`$ exec ${ev.name} ${Object.entries(ev.input ?? {}).map(([k, v]) => `--${k}=${v}`).join(" ")}`, "cmd");
    }
    if (ev.type === "tool_result") {
      for (const [t, c] of detailLines(ev.name, ev.result)) wr.line(t, c);
      wr.run(() => {
        wr.module(ev.name, "done", ev.result?.error ? "NO DATA" : "EXTRACTED ✓");
        wr.toolsDone++;
        wr.setProgress(Math.min(90, wr.toolsDone * 18));
      });
    }
    if (ev.type === "result") {
      es.close();
      result = ev.recommendation;
      const v = VERDICTS[result.verdict];
      wr.line(`>>> VERDICT: ${v.label}   WIN PROBABILITY ${result.win_likelihood}%`, "big");
      wr.line(`>>> ${result.headline}`, "ok");
      wr.run(() => wr.setProgress(100));
      await wr.drained();
      $("#wr-complete").classList.remove("hidden");
      await sleep(wr.fast ? 150 : 450);
      wr.close();
      state.current = await api(`/api/disputes/${encodeURIComponent(d.id)}`);
      renderDetail({ withRec: false });
      renderRecommendation(true);
      $("#rec").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (ev.type === "error") {
      es.close();
      wr.failed = true;
      wr.line(`✗ ERROR: ${ev.message}`, "err");
      $("#wr-skip").textContent = "close ✕";
    }
  };
  es.onerror = () => {
    es.close();
    if (!result) {
      wr.failed = true;
      wr.line("✗ connection lost", "err");
      $("#wr-skip").textContent = "close ✕";
    }
  };
}

// ---------------- recommendation + evidence board ----------------
function journeyTile(tracking, order) {
  if (!tracking) return `<div class="tile"><h5>📦 SHIPMENT</h5><p class="muted">No tracking on file.</p></div>`;
  const evs = tracking.events.length > 3 ? [tracking.events[0], tracking.events.at(-2), tracking.events.at(-1)] : tracking.events;
  const delivered = tracking.status === "DELIVERED";
  const color = delivered ? "var(--green)" : "var(--amber)";
  const pct = delivered ? 100 : 72;
  return `<div class="tile" style="--jc:${color}"><h5>🚚 PACKAGE JOURNEY · ${esc(order?.shipping?.carrier ?? "")}</h5>
    <div class="journey">
      <div class="fill" style="width:calc(${pct}% - 20px)"></div>
      <div class="truck" style="left:calc(${pct}% * .94 + 6px)">🚚</div>
      ${evs.map((e, i) => `<div class="stop ${i === evs.length - 1 ? "last" : ""}" style="width:${100 / evs.length}%"><div class="node"></div><div class="t">${new Date(e.time).toLocaleDateString([], { month: "short", day: "numeric" })}</div><div class="d">${esc(e.location)}</div></div>`).join("")}
    </div>
    <div class="tstatus">${delivered ? "📍 DELIVERED" : "⏳ " + esc(tracking.status.replace("_", " "))}</div>
    <div class="muted" style="font-size:11px;margin-top:4px">${esc(tracking.events.at(-1).detail)}</div>
  </div>`;
}

function addressTile(order) {
  if (!order) return `<div class="tile"><h5>🗺️ ADDRESS CHECK</h5><p class="muted">No store order found for this transaction.</p></div>`;
  const same = order.shippingAddress === order.billingAddress;
  const fwd = /forward/i.test(order.shippingAddress);
  return `<div class="tile"><h5>🗺️ ADDRESS CHECK</h5>
    <div class="addr">
      <div class="box"><span>SHIP TO</span>${esc(order.shippingAddress)}</div>
      <div class="match ${same ? "ok" : "bad"}">${same ? "✓ ADDRESSES MATCH" : "✗ MISMATCH DETECTED"}</div>
      <div class="box"><span>BILL TO</span>${esc(order.billingAddress)}</div>
      <div class="match ${order.ipCountry === "US" && !fwd ? "ok" : "bad"}">🌐 ORDER IP: ${esc(order.ipCountry)}${fwd ? " · FREIGHT FORWARDER" : ""}</div>
    </div></div>`;
}

function buyerTile(customer, order, buyerName) {
  if (!customer) return `<div class="tile"><h5>👤 BUYER INTEL</h5><p class="muted">No history for this buyer.</p></div>`;
  const trust = Math.max(5, Math.min(98, 60 + Math.min(30, customer.accountAgeDays / 40) + customer.orders * 2 - customer.priorDisputes * 25 - (customer.accountAgeDays < 7 ? 50 : 0)));
  const meter = (label, val, max, color, text) => `<div class="meter" style="--mc:${color}"><div class="ml"><span>${label}</span><span>${text}</span></div><div class="mt"><div class="mf" style="width:${Math.max(4, Math.min(100, (val / max) * 100))}%"></div></div></div>`;
  return `<div class="tile"><h5>👤 BUYER INTEL</h5>
    <div class="buyer-id"><div class="av">${esc(initials(buyerName))}</div><div><div class="nm">${esc(buyerName)}</div><div class="em">${esc(order?.customerEmail ?? "")}</div></div></div>
    ${meter("ACCOUNT AGE", customer.accountAgeDays, 1500, "var(--cyan)", `${customer.accountAgeDays}d`)}
    ${meter("ORDERS", customer.orders, 10, "var(--violet)", customer.orders)}
    ${meter("PRIOR DISPUTES", customer.priorDisputes, 3, "var(--red)", customer.priorDisputes)}
    ${meter("TRUST SCORE", trust, 100, trust > 60 ? "var(--green)" : trust > 35 ? "var(--amber)" : "var(--red)", Math.round(trust))}
  </div>`;
}

function renderRecommendation(animate) {
  const { dispute: d, recommendation: rec, intel } = state.current;
  const v = VERDICTS[rec.verdict] ?? VERDICTS.FIGHT;
  const done = isDone(d.status);
  const r = 64, c = 2 * Math.PI * r;
  const pct = Number(rec.win_likelihood) || 0;
  const label = rec.verdict === "FIGHT" ? "EVIDENCE NOTES → PAYPAL" : rec.verdict === "ACCEPT_CLAIM" ? "NOTE → PAYPAL" : "MESSAGE → BUYER";
  $("#rec").innerHTML = `
    <div class="rec" style="--vc:${v.color}">
      <div class="rec-head">
        <div class="gauge"><svg width="150" height="150"><circle cx="75" cy="75" r="${r}" style="stroke:rgba(var(--glass-rgb),.07)" stroke-width="12" fill="none"/>
          <circle class="arc" cx="75" cy="75" r="${r}" style="stroke:${v.color}" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${animate ? c : c * (1 - pct / 100)}"/></svg>
          <div class="val"><div><b id="gauge-num">${animate ? 0 : pct}%</b><span>WIN ODDS</span></div></div></div>
        <div>
          <div class="stamp">${v.label}</div>
          <div class="headline">${esc(rec.headline)}</div>
          <div class="saved">💰 KEEPS <b>$${esc(rec.money_saved_estimate)}</b> vs. full refund</div>
          ${calibrationStrip(rec.calibration)}
        </div>
      </div>
      <div class="board">
        ${journeyTile(intel?.tracking, intel?.order)}
        ${addressTile(intel?.order)}
        ${buyerTile(intel?.customer, intel?.order, d.buyerName)}
      </div>
      <div class="rec-body">
        <div><h5>WHY</h5><ul class="reasons">${rec.reasoning.slice(0, 3).map((x, i) => `<li style="animation-delay:${0.3 + i * 0.12}s">${esc(x)}</li>`).join("")}</ul>
          ${rec.reasoning.length > 3 ? `<details class="more"><summary>${rec.reasoning.length - 3} more reasons</summary><ul class="reasons">${rec.reasoning.slice(3).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}</div>
        <div>
          ${rec.evidence?.length ? `<h5>EVIDENCE PACKET</h5><ul class="ev-chips">${rec.evidence.map((e) => `<li title="${esc(e.detail)}"><span>✓</span>${esc(e.title)}</li>`).join("")}</ul>` : ""}
          ${rec.risk_flags?.length ? `<h5 style="margin-top:14px">WATCH OUT</h5><ul class="reasons flags">${rec.risk_flags.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        </div>
        <div class="full">
          <details class="more note-edit"><summary>✎ Review ${label === "MESSAGE → BUYER" ? "the message to the buyer" : "what we send to PayPal"}</summary>
          <textarea id="response-text">${esc(rec.response_text)}</textarea></details>
        </div>
        <div class="full approve-row">
          ${rec.verdict === "OFFER_PARTIAL_REFUND" ? `<label style="font-family:var(--mono);font-size:12px">REFUND $ <input class="offer-input" id="offer-amount" value="${esc(rec.offer_amount ?? "")}" /></label>` : ""}
          <button class="cta go" id="approve" ${done ? "disabled" : ""}>${done ? "✓ SENT" : `✓ APPROVE · ${v.action}`}</button>
          <button class="cta ghost" id="open-dossier">📄 EVIDENCE DOSSIER</button>
          ${rec.verdict === "FIGHT" ? `<span class="api-note">📎 Dossier PDF${sellerPhotoCount() ? ` + ${sellerPhotoCount()} photo${sellerPhotoCount() === 1 ? "" : "s"}` : ""} attached</span>` : ""}
        </div>
      </div>
    </div>
    <div id="sent"></div>`;
  $("#approve").onclick = () => approve(d, rec);
  $("#open-dossier").onclick = () => openDossier(d.id);
  if (animate) {
    requestAnimationFrame(() => requestAnimationFrame(() => ($(".gauge .arc").style.strokeDashoffset = c * (1 - pct / 100))));
    countUp($("#gauge-num"), pct, { suffix: "%" });
  }
}

function calibrationStrip(cal) {
  if (!cal) return "";
  const body = cal.fought.n
    ? `${cal.fought.won} of ${cal.fought.n} similar cases won (${cal.fought.rate}%). Agent estimate <b>${cal.raw}%</b> → <b>${cal.calibrated}%</b>`
    : "No resolved cases like this yet, so the agent's estimate stands";
  const plan = cal.plan.n && cal.plan.verdict !== "FIGHT" ? ` · this plan worked ${cal.plan.worked}/${cal.plan.n} times` : "";
  const cls = cal.shift <= -10 ? "down" : cal.shift >= 10 ? "up" : "";
  return `<div class="calib ${cls}" title="Win odds are blended with the results of similar past disputes">🧠 <span class="cl">TRACK RECORD · ${esc(cal.label)}</span><br/>${body}${plan}</div>`;
}

// ---------------- approve + transmit ----------------
function burst(x, y) {
  const colors = ["var(--green)", "var(--cyan)", "var(--magenta)", "var(--amber)", "var(--violet)"];
  const cute = window.DDTheme?.isKawaii();
  const sweets = ["🎀", "💖", "🌸", "⭐", "🍓", "💗", "✨"];
  for (let i = 0; i < (cute ? 30 : 46); i++) {
    const p = document.createElement("div");
    p.className = cute ? "burst emoji" : "burst";
    if (cute) p.textContent = sweets[i % sweets.length];
    const a = Math.random() * Math.PI * 2, dist = 80 + Math.random() * 200;
    p.style.cssText = `left:${x}px;top:${y}px;background:${colors[i % colors.length]};--dx:${Math.cos(a) * dist}px;--dy:${Math.sin(a) * dist}px`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }
}

async function approve(d, rec) {
  const btn = $("#approve");
  btn.disabled = true;
  const v = VERDICTS[rec.verdict];
  const log = $("#tx-log");
  const tx = $("#transmit");
  log.innerHTML = "";
  $("#tx-title").textContent = "TRANSMITTING TO PAYPAL";
  tx.classList.remove("hidden");
  const say = async (t, cls = "") => {
    log.insertAdjacentHTML("beforeend", `<div class="${cls}">${esc(t)}</div>`);
    await sleep(420);
  };

  const body = { ...rec, response_text: $("#response-text").value };
  if ($("#offer-amount")) body.offer_amount = $("#offer-amount").value;
  const request = api(`/api/disputes/${encodeURIComponent(d.id)}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((out) => ({ out }), (err) => ({ err }));

  await say("> sealing payload · sha256 " + Math.random().toString(16).slice(2, 14));
  await say("> oauth2 bearer token ✓");
  await say(`> POST /v1/customer/disputes/${d.id}/${v.api}`);
  const { out, err } = await request;
  await sleep(500);

  if (err) {
    await say(`< ERROR ${err.message}`, "err");
    $("#tx-title").textContent = "TRANSMISSION FAILED";
    await sleep(1600);
    tx.classList.add("hidden");
    btn.disabled = false;
    $("#sent").innerHTML = `<div class="error">${esc(err.message)}</div>`;
    return;
  }
  await say(out.entry.simulated ? "< 200 OK (demo mode · simulated)" : `< ${out.entry.paypalStatus} OK · debug-id ${out.entry.debugId ?? "n/a"}`);
  $("#tx-title").textContent = "✓ ACKNOWLEDGED";
  await sleep(700);
  tx.classList.add("hidden");
  const r = btn.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2);
  btn.textContent = "✓ SENT";
  $("#sent").innerHTML = `<div class="done">✓ ${out.entry.simulated ? "Done (demo mode, PayPal call simulated)" : "Delivered to PayPal"} · ${esc(out.entry.call)}<pre>${esc(JSON.stringify(out.paypalResponse, null, 2))}</pre></div>`;
  await refreshRuling(d.id);
  await loadList();
}

async function refreshRuling(id) {
  if (state.current?.dispute.id !== id) return;
  const fresh = await api(`/api/disputes/${encodeURIComponent(id)}`);
  Object.assign(state.current, { pending: fresh.pending, outcome: fresh.outcome, canSimulateRuling: fresh.canSimulateRuling, sandboxTools: fresh.sandboxTools });
  renderRuling();
}

// ---------------- photo evidence (AI vision) ----------------
const SOURCE_LABEL = { CARRIER: "📦 CARRIER", BUYER: "👤 BUYER", SELLER: "🏪 YOU" };
const sellerPhotoCount = () => (state.current?.photos ?? []).filter((p) => p.analysis?.favors === "SELLER").length;

function photoCard(p) {
  const a = p.analysis;
  return `<div class="photo-card" data-pid="${esc(p.id)}">
    <div class="photo-frame ${a ? "scanned" : ""}">
      <img src="${esc(p.url)}" alt="${esc(p.label)}" />
      <span class="src-badge">${SOURCE_LABEL[p.source] ?? esc(p.source)}</span>
      ${a ? `<span class="verdict-badge ${esc(a.favors)}">${a.favors === "SELLER" ? "✓ SUPPORTS YOU" : a.favors === "BUYER" ? "✗ SUPPORTS BUYER" : "~ NEUTRAL"}</span>` : ""}
      <i class="bracket tl"></i><i class="bracket tr"></i><i class="bracket bl"></i><i class="bracket br"></i>
    </div>
    <div class="photo-body">
      ${a
        ? `<div class="cap">${esc(a.caption)}</div>
           <details class="more"><summary>${a.findings.length} findings</summary><ul>${a.findings.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></details>
           <div class="conf" style="--cc:${a.favors === "SELLER" ? "var(--green)" : a.favors === "BUYER" ? "var(--red)" : "var(--amber)"}"><div style="width:${a.confidence}%"></div></div>
           <div class="muted" style="font-family:var(--mono);font-size:10px;margin-top:4px">CONFIDENCE ${a.confidence}%</div>`
        : `<div class="cap">${esc(p.label)}</div>
           <div class="photo-actions"><button class="mini-btn scan-btn">🔍 SCAN WITH AI VISION</button></div>`}
    </div>
  </div>`;
}

function renderPhotos() {
  const box = $("#photos");
  if (!box) return;
  const photos = state.current.photos ?? [];
  box.innerHTML =
    photos.map(photoCard).join("") +
    `<label class="upload-card" id="upload-card"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden id="upload-input" />
       <div><div class="big-ico">＋</div><b>Add photo</b></div></label>`;
  box.querySelectorAll(".scan-btn").forEach((b) => (b.onclick = () => scanPhoto(b.closest(".photo-card").dataset.pid)));
  const input = $("#upload-input");
  input.onchange = () => input.files[0] && uploadPhoto(input.files[0]);
  const card = $("#upload-card");
  card.ondragover = (e) => { e.preventDefault(); card.classList.add("drag"); };
  card.ondragleave = () => card.classList.remove("drag");
  card.ondrop = (e) => { e.preventDefault(); card.classList.remove("drag"); e.dataTransfer.files[0] && uploadPhoto(e.dataTransfer.files[0]); };
}

async function scanPhoto(pid) {
  const d = state.current.dispute;
  const card = document.querySelector(`.photo-card[data-pid="${pid}"]`);
  const frame = card.querySelector(".photo-frame");
  frame.classList.add("scanning");
  frame.insertAdjacentHTML("beforeend", `<div class="scan-label" id="scan-label">▶ VISION MODEL ANALYZING…</div>`);
  card.querySelector(".scan-btn").disabled = true;
  const msgs = ["▶ DETECTING OBJECTS…", "▶ READING TEXT & LABELS…", "▶ CROSS-CHECKING ORDER DATA…", "▶ WEIGHING EVIDENCE…"];
  let i = 0;
  const t = setInterval(() => { const l = $("#scan-label"); if (l) l.textContent = msgs[i++ % msgs.length]; }, 700);
  try {
    const { photo } = await api(`/api/disputes/${encodeURIComponent(d.id)}/photos/${pid}/analyze`, { method: "POST" });
    state.current.photos = state.current.photos.map((p) => (p.id === pid ? photo : p));
  } catch (e) {
    toast("VISION ERROR", e.message, "warn");
  }
  clearInterval(t);
  renderPhotos();
}

function uploadPhoto(file) {
  if (file.size > 5 * 1024 * 1024) return toast("TOO LARGE", "Images must be under 5 MB.", "warn");
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const { photo } = await api(`/api/disputes/${encodeURIComponent(state.current.dispute.id)}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: reader.result, label: file.name, source: "SELLER" }),
      });
      state.current.photos = [...(state.current.photos ?? []), photo];
      renderPhotos();
      scanPhoto(photo.id);
    } catch (e) {
      toast("UPLOAD FAILED", e.message, "warn");
    }
  };
  reader.readAsDataURL(file);
}

// ---------------- negotiation arena ----------------
function openArena(d) {
  const arena = $("#arena");
  const chat = $("#ar-chat");
  const max = Number(d.amount.value);
  arena.classList.remove("hidden");
  chat.innerHTML = "";
  $("#ar-result").classList.add("hidden");
  $("#ar-max").textContent = money(d.amount);
  $("#ar-buyer-av").textContent = initials(d.buyerName);
  $("#ar-buyer-name").textContent = `${d.buyerName.split(" ")[0].toUpperCase()} (SIM)`;
  ["seller", "buyer"].forEach((s) => $(`#ar-${s}`).classList.remove("show"));
  $("#ar-zone").style.cssText = "left:0;width:0";
  const last = { seller: null, buyer: null };
  const pos = (v) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const updateTrack = () => {
    for (const s of ["seller", "buyer"]) {
      if (last[s] == null) continue;
      const m = $(`#ar-${s}`);
      m.classList.add("show");
      m.style.left = pos(last[s]);
      m.querySelector("span").textContent = `${s.toUpperCase()} $${last[s].toFixed(2)}`;
    }
    if (last.seller != null && last.buyer != null) {
      const lo = Math.min(last.seller, last.buyer), hi = Math.max(last.seller, last.buyer);
      $("#ar-zone").style.cssText = `left:${pos(lo)};width:calc(${pos(hi)} - ${pos(lo)})`;
    }
  };

  const es = new EventSource(`/api/disputes/${encodeURIComponent(d.id)}/negotiate`);
  const close = () => { es.close(); arena.classList.add("hidden"); };
  $("#ar-close").onclick = close;

  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "typing") {
      chat.querySelector(".typing")?.remove();
      chat.insertAdjacentHTML("beforeend", `<div class="typing ${ev.side}"><i></i><i></i><i></i></div>`);
      document.querySelectorAll(".ar-agent").forEach((a) => a.classList.toggle("active", a.classList.contains(ev.side)));
      $(`#think-${ev.side}`).textContent = "thinking…";
      $(`#think-${ev.side === "seller" ? "buyer" : "seller"}`).textContent = "";
      chat.scrollTop = chat.scrollHeight;
    }
    if (ev.type === "turn") {
      chat.querySelector(".typing")?.remove();
      $(`#think-${ev.side}`).textContent = ev.decision === "ACCEPT" ? "✓ accepted" : `offers $${ev.proposed_refund}`;
      last[ev.side] = Number(ev.proposed_refund);
      if (ev.decision === "ACCEPT") last[ev.side === "seller" ? "buyer" : "seller"] = Number(ev.proposed_refund);
      updateTrack();
      chat.insertAdjacentHTML("beforeend", `<div class="bub ${ev.side} ${ev.decision === "ACCEPT" ? "accept" : ""}">
        <div class="who"><span>${ev.side === "seller" ? "🛡️ SELLER AGENT" : "👤 " + esc(d.buyerName.toUpperCase()) + " (SIM)"}</span>
        <span class="offer">${ev.decision === "ACCEPT" ? "✓ ACCEPTS" : ev.decision === "WALK_AWAY" ? "✗ WALKS AWAY" : "$" + esc(ev.proposed_refund)}</span></div>${esc(ev.message)}</div>`);
      chat.scrollTop = chat.scrollHeight;
    }
    if (ev.type === "deal") {
      es.close();
      document.querySelectorAll(".ar-agent").forEach((a) => a.classList.remove("active"));
      const r = $("#ar-result");
      r.className = "ar-result";
      r.innerHTML = `<div style="font-size:40px">🤝</div>
        <div class="grow"><div class="deal">DEAL @ $${esc(ev.amount)}</div>
        <div class="deal-sub">Keeps <b style="color:var(--green)">$${esc(ev.saved)}</b> vs. a full refund · ${ev.rounds} messages. Send this offer to the real buyer?</div></div>
        <button class="cta go" id="ar-send">✓ SEND OFFER VIA PAYPAL</button>`;
      $("#ar-send").onclick = () => settle(d, ev, close);
      const rr = r.getBoundingClientRect();
      burst(rr.left + 40, rr.top + 30);
    }
    if (ev.type === "no_deal" || ev.type === "error") {
      es.close();
      const r = $("#ar-result");
      r.className = "ar-result fail";
      r.innerHTML = `<div style="font-size:40px">⚠️</div><div class="grow"><div class="deal">NO DEAL</div><div class="deal-sub">${esc(ev.message ?? "The buyer agent walked away. Consider fighting with evidence instead.")}</div></div>`;
    }
  };
}

async function settle(d, deal, closeArena) {
  const btn = $("#ar-send");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-s"></span> SENDING…';
  try {
    const out = await api(`/api/disputes/${encodeURIComponent(d.id)}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: deal.amount, note: deal.note }),
    });
    closeArena();
    toast("✓ OFFER SENT", `${out.entry.call.replace("{id}", d.id)}${out.entry.simulated ? " (simulated)" : ""}`, "good");
    await loadList();
    await selectDispute(d.id);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "RETRY";
    toast("SEND FAILED", e.message, "warn");
  }
}

// ---------------- autopilot + live events ----------------
function toast(title, body, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<b>${esc(title)}</b>${esc(body)}`;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, 5200);
}

function feed(text, kind = "") {
  const li = document.createElement("li");
  li.className = kind;
  li.innerHTML = `<span class="t">${new Date().toLocaleTimeString([], { hour12: false })}</span> ${esc(text)}`;
  $("#ap-feed").prepend(li);
}

const RULE_KEYS = ["fightMinOdds", "fightMaxAmount", "settleMaxAmount"];
function showRules(r) {
  state.rules = r;
  $("#ap-enabled").checked = r.enabled;
  $("#autopilot").classList.toggle("on", r.enabled);
  $("#ap-sub").textContent = r.enabled ? "On" : "Off";
  for (const k of RULE_KEYS) { $(`#r-${k}`).value = r[k]; $(`#v-${k}`).textContent = r[k]; }
  $("#r-autoReply").checked = r.autoReply;
}

async function saveRules(patch) {
  const { rules } = await api("/api/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  showRules(rules);
}

async function loadAutopilot() {
  const { rules } = await api("/api/autopilot");
  showRules(rules);
  $("#ap-enabled").onchange = (e) => {
    saveRules({ enabled: e.target.checked });
    feed(e.target.checked ? "Autopilot engaged" : "Autopilot disengaged", e.target.checked ? "good" : "");
  };
  for (const k of RULE_KEYS) {
    $(`#r-${k}`).oninput = (e) => ($(`#v-${k}`).textContent = e.target.value);
    $(`#r-${k}`).onchange = (e) => saveRules({ [k]: e.target.value });
  }
  $("#r-autoReply").onchange = (e) => saveRules({ autoReply: e.target.checked });
}

function setAp(id, text, busy = false) {
  state.apStatus[id] = { text, busy };
  renderList();
}

function connectEvents() {
  const es = new EventSource("/api/events");
  es.onmessage = async (e) => {
    const ev = JSON.parse(e.data);
    window.dispatchEvent(new CustomEvent("dd-event", { detail: ev }));
    switch (ev.type) {
      case "dispute_new":
        state.fresh.add(ev.dispute.id);
        setTimeout(() => state.fresh.delete(ev.dispute.id), 4000);
        toast(`🚨 NEW DISPUTE · ${ev.via}`, `${ev.dispute.buyerName}: ${ev.dispute.item} · ${money(ev.dispute.amount)}`, "alert");
        feed(`⚠ ${ev.dispute.id} arrived (${ev.via})`, "warn");
        await loadList();
        break;
      case "autopilot_start":
        setAp(ev.disputeId, "analyzing…", true);
        feed(`▶ agent deployed on ${ev.disputeId}`);
        break;
      case "autopilot_step":
        setAp(ev.disputeId, ev.label.toLowerCase() + "…", true);
        break;
      case "autopilot_decision":
        feed(`◆ ${ev.disputeId}: ${VERDICTS[ev.verdict]?.label} (${ev.rawOdds != null && ev.rawOdds !== ev.odds ? `${ev.rawOdds}→` : ""}${ev.odds}%) → ${ev.auto ? "AUTO" : "HOLD"}`, ev.auto ? "good" : "warn");
        if (ev.verdict === "FIGHT" && !ev.auto && ev.rawOdds >= state.rules?.fightMinOdds && ev.odds < state.rules?.fightMinOdds)
          toast("🧠 TRACK RECORD STEPPED IN", `${ev.disputeId}: the agent said ${ev.rawOdds}%, but similar past cases put it at ${ev.odds}%. Held for your approval.`, "warn");
        break;
      case "action":
        if (ev.entry.source === "AUTOPILOT") {
          setAp(ev.entry.disputeId, `${VERDICTS[ev.entry.verdict]?.label} sent automatically`);
          toast(`🤖 AUTOPILOT · ${VERDICTS[ev.entry.verdict]?.label}`, `${ev.entry.disputeId}: ${ev.entry.rule}`, "good");
          feed(`✓ ${ev.entry.disputeId}: ${ev.entry.call.split("/").pop()} sent`, "good");
        }
        await loadList();
        break;
      case "needs_approval":
        setAp(ev.disputeId, `needs your approval: ${ev.reason}`);
        if (ev.verdict) toast("✋ NEEDS YOUR APPROVAL", `${ev.disputeId}: ${ev.reason}`, "warn");
        break;
      case "outcome": {
        const m = OUTCOMES[ev.entry.outcome];
        toast(`⚖️ PAYPAL RULED · ${m.label}`, `${ev.entry.disputeId}: kept $${Number(ev.entry.kept).toFixed(2)} (predicted ${ev.entry.odds}%). Track Record updated.`, ev.entry.outcome === "LOST" ? "warn" : "good");
        feed(`⚖ ${ev.entry.disputeId}: ${m.label} · learned`, ev.entry.outcome === "LOST" ? "bad" : "good");
        if (state.current?.dispute.id === ev.entry.disputeId && !state.current.outcome) await refreshRuling(ev.entry.disputeId);
        break;
      }
      case "package_tap": {
        const msg = {
          OPEN: ["📲 PACKAGE TAPPED", `${ev.buyerName}'s phone just tapped the ${ev.item} box (${ev.device}).`, ""],
          CONFIRM_OK: ["✅ DELIVERY CONFIRMED", `${ev.buyerName} confirmed the ${ev.item} arrived OK${ev.located ? ", with GPS" : ""}.`, "good"],
          PROBLEM: ["⚠️ PROBLEM REPORTED AT DELIVERY", `${ev.buyerName}: "${ev.note ?? ""}". Fix it before it becomes a PayPal dispute.`, "warn"],
        }[ev.kind];
        if (msg) toast(...msg);
        feed(`📲 ${ev.tagId}: ${ev.kind.toLowerCase().replace("_", " ")}`, ev.kind === "PROBLEM" ? "warn" : "good");
        if (state.current?.dispute?.transactionId === ev.transactionId) {
          const fresh = await api(`/api/disputes/${encodeURIComponent(state.current.dispute.id)}`).catch(() => null);
          if (fresh && state.current?.dispute?.id === fresh.dispute.id) {
            state.current = { ...fresh, recommendation: state.current.recommendation ?? fresh.recommendation };
            renderTag();
          }
        }
        break;
      }
      case "dispute_update": {
        // The PayPal watcher saw a change: a buyer message, a status change, an accepted offer.
        const who = { BUYER: "Buyer", SELLER: "You" }[ev.message?.by] ?? "PayPal";
        const what = ev.message ? `${who}: ${ev.message.content}` : `Status: ${ev.status.replaceAll("_", " ")}`;
        if (ev.message?.by !== "SELLER") toast(`📬 CASE UPDATED · ${ev.disputeId}`, what.slice(0, 160), "");
        feed(`↻ ${ev.disputeId}: ${what.slice(0, 60)}`);
        await loadList();
        if (state.selected === ev.disputeId) {
          const fresh = await api(`/api/disputes/${encodeURIComponent(ev.disputeId)}`).catch(() => null);
          if (fresh && state.selected === ev.disputeId) {
            state.current = fresh;
            renderDetail();
          }
        }
        break;
      }
      case "autopilot_error":
        setAp(ev.disputeId, `error: ${ev.message}`);
        feed(`✗ ${ev.disputeId}: ${ev.message}`, "bad");
        break;
    }
  };
}

$("#simulate").onclick = async () => {
  const btn = $("#simulate");
  btn.disabled = true;
  try {
    await api("/api/simulate/dispute", { method: "POST" });
  } catch (e) {
    toast("SIMULATION FAILED", e.message, "warn");
  }
  setTimeout(() => (btn.disabled = false), 800);
};

// ---------------- evidence dossier ----------------
async function openDossier(id) {
  const url = `/api/disputes/${encodeURIComponent(id)}/dossier.pdf`;
  $("#dossier").classList.remove("hidden");
  $("#ds-download").href = url;
  $("#ds-download").setAttribute("download", `evidence-dossier-${id}.pdf`);
  $("#ds-body").innerHTML = `<div class="ds-compile"><div>▶ COMPILING EVIDENCE DOSSIER…<div class="bar"><div></div></div></div></div>`;
  await sleep(1300);
  $("#ds-body").innerHTML = `<iframe src="${url}#view=FitH" title="Evidence dossier"></iframe>`;
}
$("#ds-close").onclick = () => $("#dossier").classList.add("hidden");

// ---------------- bridge for views.js and copilot.js ----------------
window.DD = {
  state, api, toast, loadList, saveRules, money, esc, imgFor, initials, burst,
  async open(id) { window.DD.showView?.("disputes"); await selectDispute(id); },
  async investigate(id) { await window.DD.open(id); analyze(state.current.dispute); },
  async negotiate(id) { await window.DD.open(id); openArena(state.current.dispute); },
  async simulate() { await api("/api/simulate/dispute", { method: "POST" }); },
  triage() {
    window.DD.showView?.("disputes");
    state.selected = null;
    state.current = null;
    renderList();
    renderBriefing();
    return triageAll();
  },
};

// Refresh button: show that it ran, and what it found.
$("#refresh").onclick = async () => {
  const btn = $("#refresh");
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add("spinning");
  const before = new Set(state.disputes.map((d) => d.id));
  await loadList();
  btn.classList.remove("spinning");
  btn.disabled = false;
  const added = state.disputes.filter((d) => !before.has(d.id)).length;
  const sandbox = state.config?.paypalMode === "sandbox";
  toast(
    added ? `✓ ${added} NEW DISPUTE${added > 1 ? "S" : ""}` : "✓ UP TO DATE",
    `${state.disputes.length} dispute(s).${sandbox && !added ? " New sandbox cases can take 15+ minutes to reach PayPal's list. Paste the case ID above to open one now." : ""}`,
    added ? "good" : "",
  );
};

// Open a case by ID (sandbox cases show up here long before they reach PayPal's list).
$("#case-open").onsubmit = async (e) => {
  e.preventDefault();
  const id = $("#case-id").value.trim().toUpperCase();
  if (!/^PP-[\w-]+$/.test(id)) return toast("CHECK THE CASE ID", "It looks like PP-R-ABC-12345678 (shown on PayPal's case page).", "warn");
  $("#case-id").value = "";
  await selectDispute(id);
  if (state.current?.dispute?.id === id) await loadList();
};
await loadConfig();
await loadAutopilot();
// Sandbox: show the case-ID box, and check PayPal for new disputes every 30 seconds.
if (state.config.paypalMode === "sandbox") {
  $("#case-open").classList.remove("hidden");
  setInterval(() => { if (document.visibilityState === "visible") loadList(); }, 30000);
}
connectEvents();
$("#briefing").onclick = () => {
  state.selected = null;
  state.current = null;
  renderList();
  renderBriefing();
};
await loadList();

// Open a case straight from its ID: http://localhost:3000/#PP-R-ABC-12345678
// (useful while a new sandbox dispute hasn't reached PayPal's list yet).
async function openFromHash() {
  const id = decodeURIComponent(location.hash.slice(1)).trim();
  if (!/^PP-[\w-]+$/.test(id)) return;
  await selectDispute(id);
  await loadList();
}
// Staggered entrance on first load only (lists re-render often after that).
document.body.classList.add("intro");
setTimeout(() => document.body.classList.remove("intro"), 2600);
window.addEventListener("hashchange", openFromHash);
await openFromHash();
