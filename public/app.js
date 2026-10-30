const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REASONS = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: ["NOT RECEIVED", "inr"],
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: ["NOT AS DESCRIBED", "snad"],
  UNAUTHORISED: ["UNAUTHORIZED", "unauth"],
};
const VERDICTS = {
  FIGHT: { label: "FIGHT", action: "SUBMIT EVIDENCE", api: "provide-evidence", color: "#2bffb1" },
  OFFER_PARTIAL_REFUND: { label: "PARTIAL REFUND", action: "SEND OFFER", api: "make-offer", color: "#9b7bff" },
  ACCEPT_CLAIM: { label: "ACCEPT", action: "ACCEPT CLAIM", api: "accept-claim", color: "#ff4d6d" },
  SEND_MESSAGE: { label: "REPLY", action: "SEND MESSAGE", api: "send-message", color: "#00e5ff" },
};
const MODULES = {
  lookup_order: { icon: "🧾", name: "ORDER DB" },
  track_shipment: { icon: "🚚", name: "CARRIER LINK" },
  get_customer_history: { icon: "👤", name: "BUYER INTEL" },
  get_store_policies: { icon: "📜", name: "POLICY VAULT" },
  inspect_photos: { icon: "📸", name: "PHOTO FORENSICS" },
};

const imgFor = (name = "") => {
  const n = name.toLowerCase();
  if (n.includes("headphone")) return "/img/headphones.svg";
  if (n.includes("mug")) return "/img/mug.svg";
  if (n.includes("watch")) return "/img/watch.svg";
  if (n.includes("tote") || n.includes("bag")) return "/img/tote.svg";
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

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ---------------- header ----------------
setInterval(() => ($("#clock").textContent = new Date().toLocaleTimeString([], { hour12: false })), 1000);

async function loadConfig() {
  state.config = await api("/api/config");
  const c = state.config;
  $("#modes").innerHTML = `
    <span class="mode ${c.paypalMode === "sandbox" ? "" : "off"}">● PAYPAL ${c.paypalMode === "sandbox" ? "SANDBOX" : "DEMO DATA"}</span>
    <span class="mode ${c.aiMode === "claude" ? "" : "off"}">● AI ${c.aiMode === "claude" ? esc(c.model).toUpperCase() : "SCRIPTED"}</span>`;
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
}

function spark(seed, color) {
  let y = 14;
  const pts = Array.from({ length: 16 }, (_, i) => {
    y = Math.max(3, Math.min(23, y + Math.sin(seed * 7 + i * 1.7) * 6));
    return `${(i * 100) / 15},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg class="spark" viewBox="0 0 100 26" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" opacity=".8"/></svg>`;
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
    ["open", "NEEDS RESPONSE", "⚠️", "#ffb547", open.length, {}],
    ["stake", "MONEY AT STAKE", "💰", "#ff3df2", atStake, { prefix: "$", decimals: 2 }],
    ["soon", "DUE IN ≤ 5 DAYS", "⏱️", "#ff4d6d", soon, {}],
    ["saved", "REVENUE PROTECTED", "🛡️", "#2bffb1", saved, { prefix: "$", decimals: 2 }],
  ];
  if (!$("#stats").children.length) {
    $("#stats").innerHTML = cards
      .map(([k, label, ico, color], i) => `<div class="stat" style="--accent:${color}"><div class="top"><span class="label">${label}</span><span class="ico">${ico}</span></div><div class="value" id="stat-${k}">0</div>${spark(i + 1, color)}</div>`)
      .join("");
  }
  for (const [k, , , , val, opts] of cards) countUp($(`#stat-${k}`), val, opts);
}

function renderList() {
  if (!state.disputes.length) {
    $("#dispute-list").innerHTML = `<p class="muted">No disputes. 🎉<br/><br/>Sandbox mode: buy something in the <a href="/shop.html">demo shop</a> with a sandbox buyer, then open a dispute from that buyer's account.</p>`;
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
          <div class="due ${done ? "resolved" : days != null && days <= 5 ? "soon" : ""}">${esc(dueTxt)}${d.photos ? ` · 📸 ${d.photos}` : ""}</div>
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
    .map((a) => `<li><b>✓ ${esc(VERDICTS[a.verdict]?.label ?? a.verdict)}</b><span class="src ${esc(a.source)}">${esc(a.source ?? "MANUAL")}</span> · ${esc(a.disputeId)}${a.rule ? `<br/><span class="muted">rule: ${esc(a.rule)}</span>` : ""}${a.photosAttached ? `<br/><span class="muted">📎 ${a.photosAttached} photo(s) attached</span>` : ""}<br/><code>${esc(a.call)}${a.simulated ? " (simulated)" : ` → ${a.paypalStatus}`}</code></li>`)
    .join("");
}

// ---------------- detail ----------------
async function selectDispute(id) {
  state.selected = id;
  renderList();
  $("#detail").innerHTML = `<p class="muted" style="font-family:var(--mono)">&gt; decrypting case file…</p>`;
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
  const color = days == null ? "#7c8db5" : days <= 3 ? "#ff4d6d" : days <= 6 ? "#ffb547" : "#2bffb1";
  return `<div class="ring"><svg width="92" height="92"><circle cx="46" cy="46" r="${r}" stroke="rgba(255,255,255,.08)" stroke-width="7" fill="none"/>
    <circle cx="46" cy="46" r="${r}" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}" style="filter:drop-shadow(0 0 6px ${color})"/></svg>
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
        <div class="sub">${esc(d.buyerName)} · CASE ${esc(d.id)}<br/>TXN ${esc(d.transactionId ?? "n/a")}</div>
        <div class="pills">${reasonPill(d.reason)}<span class="pill stage">${esc(d.stage)}</span><span class="pill ${isDone(d.status) ? "status-done" : "stage"}">${esc(d.status.replaceAll("_", " "))}</span></div>
      </div>
      <div class="countdown"><div class="bigamt">${money(d.amount)}</div>${ring(daysLeft(d.sellerResponseDue))}</div>
    </div>

    <div class="section-title">&gt; INTERCEPTED MESSAGES</div>
    <div class="thread">
      ${d.messages.map((m) => `<div class="msg ${esc(m.by)}"><div class="avatar">${m.by === "BUYER" ? esc(initials(d.buyerName)) : m.by === "SELLER" ? "YOU" : "PP"}</div><div class="bubble"><div class="meta">${m.by === "BUYER" ? esc(d.buyerName) : esc(m.by)} · ${new Date(m.time).toLocaleString()}</div>${esc(m.content)}</div></div>`).join("") || `<p class="muted">No messages.</p>`}
    </div>

    <div class="section-title">&gt; PHOTO EVIDENCE · AI VISION</div>
    <div class="photos" id="photos"></div>

    <div class="analyze-row">
      <button class="cta" id="analyze">${rec ? "⟳ RE-RUN ANALYSIS" : "⚡ DEPLOY AI AGENT"}</button>
      <button class="cta alt" id="negotiate" ${d.stage === "INQUIRY" && !isDone(d.status) ? "" : "disabled"} title="${d.stage === "INQUIRY" ? "" : "PayPal only allows offers in the inquiry stage"}">🤝 NEGOTIATION ARENA</button>
      <span class="hint">${d.stage === "INQUIRY" ? "read-only · nothing is sent to PayPal without your approval" : "negotiation: inquiry stage only (PayPal rule)"}</span>
    </div>
    <div id="rec"></div>`;
  $("#analyze").onclick = () => analyze(d);
  $("#negotiate").onclick = () => openArena(d);
  renderPhotos();
  if (rec && withRec) renderRecommendation(false);
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
  noise(n = 2) {
    for (let i = 0; i < n; i++) {
      const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
      this.line(`  0x${hex()}${hex()}  ${["SYN", "ACK", "PSH", "FIN"][i % 4]}  ${hex()} ${hex()} ${hex()} ${hex()}  ${Math.floor(Math.random() * 40 + 4)}ms`, "dim");
    }
  }

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
      const speed = this.fast ? 400 : item.cls === "dim" ? 6 : 2;
      for (let i = 0; i < item.text.length; i += speed) {
        div.textContent = item.text.slice(0, i + speed);
        div.appendChild(cursor);
        this.term.scrollTop = this.term.scrollHeight;
        await sleep(this.fast ? 0 : 12);
      }
      if (!this.fast) await sleep(item.cls === "dim" ? 30 : 90);
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
    let last = 0;
    const draw = (t) => {
      this.raf = requestAnimationFrame(draw);
      if (t - last < 45) return;
      last = t;
      ctx.fillStyle = "rgba(2,5,10,0.12)";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.font = `${size}px JetBrains Mono, monospace`;
      drops.forEach((y, i) => {
        ctx.fillStyle = Math.random() > 0.97 ? "#e6fff6" : i % 7 === 0 ? "#00e5ff" : "#2bffb1";
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
  return [[`  ✓ ${JSON.stringify(result).slice(0, 120)}`, "ok"]];
}

function analyze(d) {
  const wr = new WarRoom(d);
  wr.open();
  const engine = state.config.aiMode === "claude" ? state.config.model : "scripted-demo";
  [
    ["dispute-defender v1.0 :: establishing secure session…", "cmd"],
    ["handshake ok · tls1.3 · aes-256-gcm", "dim"],
    [`target locked → ${d.id}  [${money(d.amount)} ${d.amount.currency}]`, "big"],
    [`reason=${d.reason}  stage=${d.stage}`, ""],
    [`buyer="${d.buyerName}"  txn=${d.transactionId ?? "?"}`, ""],
    [`deploying agent :: ${engine}`, "cmd"],
  ].forEach(([t, c]) => wr.line(t, c));
  wr.noise(2);

  let result = null;
  const es = new EventSource(`/api/disputes/${encodeURIComponent(d.id)}/analyze`);
  es.onmessage = async (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "status") wr.line(`// ${ev.message}`, "think");
    if (ev.type === "note") wr.line(`// ${ev.message.replace(/\s+/g, " ").slice(0, 220)}`, "think");
    if (ev.type === "tool") {
      const m = MODULES[ev.name];
      wr.run(() => wr.module(ev.name, "scan", "SCANNING…"));
      wr.line(`$ exec ${ev.name} ${Object.entries(ev.input ?? {}).map(([k, v]) => `--${k}=${v}`).join(" ")}`, "cmd");
      wr.line(`  connecting to ${m?.name ?? ev.name}…`, "dim");
      wr.noise(2);
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
      wr.line("cross-referencing evidence against PayPal adjudication patterns…", "cmd");
      wr.noise(3);
      wr.line(`>>> VERDICT: ${v.label}   WIN PROBABILITY ${result.win_likelihood}%`, "big");
      wr.line(`>>> ${result.headline}`, "ok");
      wr.run(() => wr.setProgress(100));
      await wr.drained();
      $("#wr-complete").classList.remove("hidden");
      await sleep(wr.fast ? 300 : 1300);
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
  const color = delivered ? "#2bffb1" : "#ffb547";
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
    ${meter("ACCOUNT AGE", customer.accountAgeDays, 1500, "#00e5ff", `${customer.accountAgeDays}d`)}
    ${meter("ORDERS", customer.orders, 10, "#9b7bff", customer.orders)}
    ${meter("PRIOR DISPUTES", customer.priorDisputes, 3, "#ff4d6d", customer.priorDisputes)}
    ${meter("TRUST SCORE", trust, 100, trust > 60 ? "#2bffb1" : trust > 35 ? "#ffb547" : "#ff4d6d", Math.round(trust))}
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
        <div class="gauge"><svg width="150" height="150"><circle cx="75" cy="75" r="${r}" stroke="rgba(255,255,255,.07)" stroke-width="12" fill="none"/>
          <circle class="arc" cx="75" cy="75" r="${r}" stroke="${v.color}" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${animate ? c : c * (1 - pct / 100)}"/></svg>
          <div class="val"><div><b id="gauge-num">${animate ? 0 : pct}%</b><span>WIN ODDS</span></div></div></div>
        <div>
          <div class="stamp">${v.label}</div>
          <div class="headline">${esc(rec.headline)}</div>
          <div class="saved">💰 KEEPS <b>$${esc(rec.money_saved_estimate)}</b> vs. full refund · engine: ${esc(rec.engine ?? "AI")}</div>
        </div>
      </div>
      <div class="board">
        ${journeyTile(intel?.tracking, intel?.order)}
        ${addressTile(intel?.order)}
        ${buyerTile(intel?.customer, intel?.order, d.buyerName)}
      </div>
      <div class="rec-body">
        <div><h5>&gt; WHY</h5><ul class="reasons">${rec.reasoning.map((x, i) => `<li style="animation-delay:${0.3 + i * 0.12}s">${esc(x)}</li>`).join("")}</ul></div>
        <div>
          ${rec.evidence?.length ? `<h5>&gt; EVIDENCE PACKET</h5><ul class="evidence">${rec.evidence.map((e) => `<li><code>${esc(e.evidence_type)}</code><br/><b>${esc(e.title)}</b><br/><span class="muted">${esc(e.detail)}</span></li>`).join("")}</ul>` : ""}
          ${rec.risk_flags?.length ? `<h5 style="margin-top:14px">&gt; RISK FLAGS</h5><ul class="reasons flags">${rec.risk_flags.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        </div>
        <div class="full">
          <h5>&gt; ${label} (editable)</h5>
          <textarea id="response-text">${esc(rec.response_text)}</textarea>
        </div>
        <div class="full approve-row">
          ${rec.verdict === "OFFER_PARTIAL_REFUND" ? `<label style="font-family:var(--mono);font-size:12px">REFUND $ <input class="offer-input" id="offer-amount" value="${esc(rec.offer_amount ?? "")}" /></label>` : ""}
          <button class="cta go" id="approve" ${done ? "disabled" : ""}>${done ? "✓ SENT" : `✓ APPROVE · ${v.action}`}</button>
          <span class="api-note">→ <code>POST /v1/customer/disputes/{id}/${v.api}</code>${rec.verdict === "FIGHT" && sellerPhotoCount() ? ` · 📎 ${sellerPhotoCount()} photo(s) attached` : ""}</span>
        </div>
      </div>
    </div>
    <div id="sent"></div>`;
  $("#approve").onclick = () => approve(d, rec);
  if (animate) {
    requestAnimationFrame(() => requestAnimationFrame(() => ($(".gauge .arc").style.strokeDashoffset = c * (1 - pct / 100))));
    countUp($("#gauge-num"), pct, { suffix: "%" });
  }
}

// ---------------- approve + transmit ----------------
function burst(x, y) {
  const colors = ["#2bffb1", "#00e5ff", "#ff3df2", "#ffb547", "#9b7bff"];
  for (let i = 0; i < 46; i++) {
    const p = document.createElement("div");
    p.className = "burst";
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
  await loadList();
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
           <div class="muted" style="margin-top:4px">${esc(a.summary)}</div>
           <ul>${a.findings.map((f, i) => `<li style="animation-delay:${i * 0.1}s">${esc(f)}</li>`).join("")}</ul>
           <div class="conf" style="--cc:${a.favors === "SELLER" ? "var(--green)" : a.favors === "BUYER" ? "var(--red)" : "var(--amber)"}"><div style="width:${a.confidence}%"></div></div>
           <div class="muted" style="font-family:var(--mono);font-size:10px;margin-top:4px">CONFIDENCE ${a.confidence}% · ${esc(a.engine ?? "")}</div>`
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
       <div><div class="big-ico">📤</div><b>Add photo evidence</b><br/>Packing photo, delivery proof, damage photo…<br/><span style="font-size:11px">drop or click · PNG/JPG under 5 MB</span></div></label>`;
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
  $("#ap-enabled").checked = r.enabled;
  $("#autopilot").classList.toggle("on", r.enabled);
  $("#ap-sub").textContent = r.enabled ? "ON: new disputes are handled the moment they arrive, within your limits." : "Off: every dispute waits for you.";
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
        feed(`◆ ${ev.disputeId}: ${VERDICTS[ev.verdict]?.label} (${ev.odds}%) → ${ev.auto ? "AUTO" : "HOLD"}`, ev.auto ? "good" : "warn");
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

$("#refresh").onclick = loadList;
await loadConfig();
await loadAutopilot();
connectEvents();
await loadList();
