// Tabs + the Risk Radar, Insights, Track Record and Integrations views.
const $ = (s) => document.querySelector(s);
const DD = () => window.DD;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usd = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usd0 = (n) => `$${Math.round(Number(n)).toLocaleString("en-US")}`;
const imgFor = (name = "") => {
  const n = name.toLowerCase();
  if (n.includes("headphone") || n.includes("headset")) return "/img/headphones.svg";
  if (n.includes("mug")) return "/img/mug.svg";
  if (n.includes("watch")) return "/img/watch.svg";
  if (n.includes("tote") || n.includes("bag")) return "/img/tote.svg";
  return "/img/box.svg";
};

// ---------------- tabs ----------------
let current = "disputes";
function showView(view) {
  current = view;
  for (const v of ["disputes", "radar", "insights", "track", "integrations"]) $(`#view-${v}`).classList.toggle("hidden", v !== view);
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  if (view === "radar") openRadar();
  if (view === "insights") openInsights();
  if (view === "track") openTrack();
  if (view === "integrations") openIntegrations();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showView(t.dataset.view)));
const waitForDD = setInterval(() => { if (window.DD) { window.DD.showView = showView; clearInterval(waitForDD); } }, 50);

// ---------------- shared tooltip ----------------
const tip = document.createElement("div");
tip.className = "viz-tip hidden";
document.body.appendChild(tip);
const showTip = (e, html) => { tip.innerHTML = html; tip.classList.remove("hidden"); tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY + 14}px`; };
const hideTip = () => tip.classList.add("hidden");

// ================= RISK RADAR =================
const radar = { orders: [], stats: {}, selected: null, scanning: false, fresh: new Set(), built: false };

function buildRadarShell() {
  $("#view-radar").innerHTML = `<div class="view-pad">
    <div class="view-head">
      <div class="grow"><h2>🛰️ RISK RADAR</h2><p>AI scores every new PayPal order for fraud and dispute risk <b>before you ship</b>. Hold the bad ones and the dispute never happens.</p></div>
      <button class="sim-btn" id="rr-sim">📦 Simulate new order</button>
      <button class="cta" id="rr-scan">⚡ SCAN ALL ORDERS</button>
    </div>
    <div class="rr-stats" id="rr-stats"></div>
    <div class="rr-grid">
      <div class="panel rr-scope">
        <svg class="rr-svg" viewBox="0 0 420 420" id="rr-svg" role="img" aria-label="Risk radar of orders awaiting shipment"></svg>
        <div class="rr-legend"><span><i style="background:var(--green)"></i>LOW · ship</span><span><i style="background:var(--amber)"></i>MEDIUM · signature</span><span><i style="background:var(--red)"></i>HIGH · hold</span></div>
        <div class="muted" id="rr-status" style="font-family:var(--mono);font-size:11px;text-align:center;margin-top:8px">&nbsp;</div>
      </div>
      <div>
        <div class="rr-orders" id="rr-orders"></div>
        <div id="rr-detail"></div>
      </div>
    </div>
  </div>`;
  $("#rr-scan").onclick = scanAll;
  $("#rr-sim").onclick = async () => {
    $("#rr-sim").disabled = true;
    await DD().api("/api/simulate/order", { method: "POST" });
    setTimeout(() => ($("#rr-sim").disabled = false), 800);
  };
  radar.built = true;
}

const R = (score) => 30 + (score / 100) * 170;
const GOLDEN = 137.508 * (Math.PI / 180);

function drawRadar() {
  const svg = $("#rr-svg");
  if (!svg) return;
  const blips = radar.orders.map((o, i) => {
    const a = i * GOLDEN - Math.PI / 2;
    const r = o.risk ? R(o.risk.score) : 100;
    return { o, x: 210 + Math.cos(a) * r, y: 210 + Math.sin(a) * r };
  });
  svg.innerHTML = `
    <defs><linearGradient id="sweepg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgba(0,229,255,0)"/><stop offset="1" stop-color="rgba(0,229,255,.35)"/></linearGradient></defs>
    <circle cx="210" cy="210" r="200" class="zone-high"/><circle cx="210" cy="210" r="132" class="zone-med"/><circle cx="210" cy="210" r="81" class="zone-low"/>
    ${[81, 132, 200].map((r) => `<circle cx="210" cy="210" r="${r}" class="ring"/>`).join("")}
    <line x1="10" y1="210" x2="410" y2="210" class="ring"/><line x1="210" y1="10" x2="210" y2="410" class="ring"/>
    <text x="214" y="${210 - 60}" class="zlabel">LOW</text><text x="214" y="${210 - 110}" class="zlabel">MEDIUM</text><text x="214" y="${210 - 180}" class="zlabel">HIGH</text>
    <g class="rr-sweep"><path d="M210 210 L210 10 A200 200 0 0 1 338.6 56.8 Z" fill="url(#sweepg)" opacity=".8"/><line x1="210" y1="210" x2="338.6" y2="56.8" stroke="var(--cyan)" stroke-width="1.5" opacity=".8"/></g>
    <circle cx="210" cy="210" r="5" fill="var(--cyan)"/>
    ${blips.map(({ o, x, y }) => `<circle class="rr-blip ${o.risk ? o.risk.level : "pending"} ${radar.selected === o.id ? "sel" : ""}" data-id="${o.id}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radar.selected === o.id ? 9 : 7}"/>
      ${o.risk?.level === "HIGH" || radar.selected === o.id ? `<text class="rr-blip-label" x="${(x + 11).toFixed(1)}" y="${(y + 3).toFixed(1)}">${esc(o.buyerName.split(" ")[0])} ${o.risk ? o.risk.score : ""}</text>` : ""}`).join("")}`;
  svg.querySelectorAll(".rr-blip").forEach((c) => {
    const o = radar.orders.find((x) => x.id === c.dataset.id);
    c.onmousemove = (e) => showTip(e, `<b>${esc(o.buyerName)}</b> · ${usd(o.total)}<br/>${esc(o.items[0].name)}${o.items[0].qty > 1 ? ` ×${o.items[0].qty}` : ""}<br/>${o.risk ? `Risk <b>${o.risk.score}</b> · ${o.risk.level}` : "not scanned yet"}`);
    c.onmouseleave = hideTip;
    c.onclick = () => selectOrder(o.id);
  });
}

function drawStats() {
  const s = radar.stats;
  $("#rr-stats").innerHTML = `
    <div class="stat" style="--accent:#00e5ff"><div class="top"><span class="label">ORDERS SCANNED</span><span class="ico">🔎</span></div><div class="value">${s.scanned ?? 0}<span style="font-size:14px;color:var(--muted)"> / ${radar.orders.length}</span></div></div>
    <div class="stat" style="--accent:#ff4d6d"><div class="top"><span class="label">HIGH RISK</span><span class="ico">🛑</span></div><div class="value">${s.high ?? 0}</div></div>
    <div class="stat" style="--accent:#2bffb1"><div class="top"><span class="label">FRAUD PREVENTED</span><span class="ico">🛡️</span></div><div class="value">${usd(s.prevented ?? 0)}</div></div>`;
}

const ACTION_LABEL = { SHIP: "SHIP", SHIP_WITH_SIGNATURE: "SHIP + SIGNATURE", HOLD_AND_VERIFY: "HOLD & VERIFY", CANCEL: "CANCEL & REFUND" };
const STATUS_LABEL = { AWAITING_SHIPMENT: "awaiting shipment", SHIPPED: "✓ shipped", ON_HOLD: "⏸ on hold", CANCELLED: "✗ cancelled" };

function drawOrders() {
  $("#rr-orders").innerHTML = radar.orders
    .map((o) => `<button class="order ${radar.selected === o.id ? "sel" : ""} ${radar.fresh.has(o.id) ? "new" : ""}" data-id="${o.id}">
      <img src="${imgFor(o.items[0].name)}" alt="" />
      <div><div class="on">${esc(o.buyerName)} · ${usd(o.total)}</div>
        <div class="om">${esc(o.items[0].name)}${o.items[0].qty > 1 ? ` ×${o.items[0].qty}` : ""} · ${esc(o.shippingSpeed)}</div>
        <div class="ostat">${esc(o.id)} · ${STATUS_LABEL[o.status] ?? o.status}${o.risk ? ` · AI: ${ACTION_LABEL[o.risk.action]}` : ""}</div></div>
      <div class="score ${o.risk ? o.risk.level : "pending"}">${o.risk ? `<b>${o.risk.score}</b><span>${o.risk.level}</span>` : `<b>··</b><span>PENDING</span>`}</div>
    </button>`)
    .join("");
  document.querySelectorAll(".order").forEach((b) => (b.onclick = () => selectOrder(b.dataset.id)));
}

function drawDetail() {
  const o = radar.orders.find((x) => x.id === radar.selected);
  if (!o) { $("#rr-detail").innerHTML = ""; return; }
  if (!o.risk) { $("#rr-detail").innerHTML = `<div class="rr-detail"><h3>${esc(o.buyerName)}</h3><p class="muted">Not scanned yet. <button class="mini-btn" id="rr-one">⚡ SCAN THIS ORDER</button></p></div>`; $("#rr-one").onclick = () => scanOne(o.id); return; }
  const r = o.risk;
  // A held order can still be shipped or cancelled. Shipped and cancelled orders are final.
  const final = ["SHIPPED", "CANCELLED"].includes(o.status);
  const can = (a) => !final && !(a === "HOLD_AND_VERIFY" && o.status === "ON_HOLD");
  const ac = o.addressCheck;
  const addrLine = ac
    ? `<div class="rr-addr">📍 Address check (Google): ${esc(ac.formatted ?? o.shippingAddress)} · ${[ac.deliverable === false ? "<b class=bad>undeliverable</b>" : ac.deliverable ? "deliverable" : null, ac.mailDrop ? "<b class=bad>mail-drop (CMRA)</b>" : null, ac.residential ? "residential" : null, ac.business ? "business" : null, ac.poBox ? "PO box" : null].filter(Boolean).join(" · ") || esc(ac.granularity ?? "checked")}</div>`
    : "";
  const after = o.status === "SHIPPED" && o.shipment
    ? `📦 Shipped ${esc(o.shipment.carrier)} ${esc(o.shipment.trackingNumber)}${o.shipment.signature ? " (signature required)" : ""} · ${o.shipment.pushedToPayPal ? "<b class=good>tracking added to PayPal ✓</b>" : "tracking not on PayPal (demo order)"}`
    : o.status === "CANCELLED" && o.refund
      ? `💸 Cancelled · ${o.refund.status === "SIMULATED" ? "refund simulated (demo order)" : `<b class=good>refunded $${esc(o.refund.amount)} via PayPal (${esc(o.refund.status)})</b>`}`
      : o.status === "ON_HOLD" ? "⏸ On hold. Verify the buyer, then ship or cancel & refund." : "";
  $("#rr-detail").innerHTML = `<div class="rr-detail">
    <div style="display:flex;gap:16px;align-items:center">
      <div class="score ${r.level}" style="min-width:90px"><b style="font-size:34px">${r.score}</b><span>${r.level} RISK</span></div>
      <div><h3>${esc(r.headline)}</h3><div class="muted" style="font-size:12px">${esc(o.buyerName)} · ${esc(o.email)} · engine: ${esc(r.engine)}</div></div>
    </div>
    <div class="section-title" style="margin-top:16px">&gt; WHAT DROVE THE SCORE <span class="muted">(red adds risk · green lowers it)</span></div>
    ${addrLine}
    ${r.signals.map((sg, i) => `<div class="sig"><span class="sl">${esc(sg.label)}</span><div class="track"><div class="bar ${sg.impact >= 0 ? "up" : "down"}" style="width:${Math.min(50, (Math.abs(sg.impact) / 40) * 50)}%;animation-delay:${i * 0.08}s"></div></div><span class="sv">${sg.impact > 0 ? "+" : ""}${sg.impact}</span><span class="sd">${esc(sg.detail)}</span></div>`).join("")}
    <div class="rr-actions">
      ${["SHIP", "SHIP_WITH_SIGNATURE", "HOLD_AND_VERIFY", "CANCEL"].map((a) => `<button class="act-btn ${{ SHIP: "ship", SHIP_WITH_SIGNATURE: "sign", HOLD_AND_VERIFY: "hold", CANCEL: "cancel" }[a]} ${r.action === a ? "rec" : ""}" data-a="${a}" ${can(a) ? "" : "disabled"} title="${{ SHIP: "Adds tracking to the PayPal transaction", SHIP_WITH_SIGNATURE: "Adds tracking to PayPal; require a signature with the carrier", HOLD_AND_VERIFY: "Hold until you've verified the buyer", CANCEL: "Refund the PayPal payment now, before it can become a chargeback" }[a]}">${{ SHIP: "📦", SHIP_WITH_SIGNATURE: "✍️", HOLD_AND_VERIFY: "⏸", CANCEL: "💸" }[a]} ${ACTION_LABEL[a]}${r.action === a ? " · AI PICK" : ""}</button>`).join("")}
    </div>
    ${after ? `<div class="rr-after">${after}</div>` : ""}
    ${o.tagId ? `<div class="section-title" style="margin-top:16px">&gt; NFC TAP-TO-CONFIRM TAG <span class="muted">(stick it inside the box)</span></div><div class="nfc-card" id="rr-tag" data-tag="${esc(o.tagId)}"><span class="muted">loading tag…</span></div>` : ""}
  </div>`;
  document.querySelectorAll(".act-btn").forEach((b) => (b.onclick = () => decide(o.id, b.dataset.a)));
  if (o.tagId) loadRadarTag(o.tagId);
}

async function loadRadarTag(id) {
  const { tag } = await DD().api(`/api/nfc/tags/${encodeURIComponent(id)}`);
  const el = $("#rr-tag");
  if (!el || el.dataset.tag !== id || !window.NFC) return;
  el.innerHTML = window.NFC.timeline(tag) + window.NFC.actions(tag, tag.url, { localOnly: tag.localOnly });
  window.NFC.bind(el, DD().toast);
}

function drawRadarAll() { drawStats(); drawRadar(); drawOrders(); drawDetail(); }

async function loadOrders() {
  const { orders, stats } = await DD().api("/api/orders");
  radar.orders = orders;
  radar.stats = stats;
  drawRadarAll();
}

function selectOrder(id) { radar.selected = id; drawRadarAll(); }

async function scanOne(id) {
  $("#rr-status").textContent = `▶ scanning ${id}: checking addresses, IP, account age, PayPal payer status…`;
  const { order } = await DD().api(`/api/orders/${id}/score`, { method: "POST" });
  const i = radar.orders.findIndex((o) => o.id === id);
  radar.orders[i] = order;
  const { stats } = await DD().api("/api/orders");
  radar.stats = stats;
  drawRadarAll();
  $("#rr-status").textContent = `✓ ${id}: ${order.risk.level} risk (${order.risk.score})`;
}

async function scanAll() {
  if (radar.scanning) return;
  radar.scanning = true;
  $("#rr-scan").disabled = true;
  for (const o of radar.orders.filter((x) => !x.risk)) {
    radar.selected = o.id;
    drawRadarAll();
    await scanOne(o.id);
    await sleep(250);
  }
  const worst = [...radar.orders].sort((a, b) => (b.risk?.score ?? 0) - (a.risk?.score ?? 0))[0];
  if (worst) selectOrder(worst.id);
  $("#rr-status").textContent = `✓ scan complete · ${radar.stats.high} high-risk order(s) need attention`;
  radar.scanning = false;
  $("#rr-scan").disabled = false;
}

async function decide(id, decision) {
  const { order, stats, integration } = await DD().api(`/api/orders/${id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
  radar.orders = radar.orders.map((o) => (o.id === id ? order : o));
  radar.stats = stats;
  drawRadarAll();
  if (decision === "HOLD_AND_VERIFY" && order.risk?.level === "HIGH") {
    DD().toast("🛡️ FRAUD PREVENTED", `${order.buyerName}'s ${usd(order.total)} order is on hold. That's a dispute that will never happen.`, "good");
    const b = document.querySelector(".act-btn.hold")?.getBoundingClientRect();
    if (b) DD().burst(b.left + b.width / 2, b.top);
  } else if (!integration) DD().toast("ORDER UPDATED", `${order.id}: ${STATUS_LABEL[order.status]}`, "");
  if (integration) {
    const title = decision === "CANCEL" ? "💸 CANCELLED & REFUNDED" : "📦 SHIPPED · TRACKING → PAYPAL";
    DD().toast(integration.ok ? title : "⚠ PAYPAL CALL FAILED", `${integration.call}: ${integration.detail}`, integration.ok ? (integration.simulated ? "" : "good") : "warn");
  }
  if (intg.built) loadIntegrations();
}

async function openRadar() {
  if (!radar.built) buildRadarShell();
  await loadOrders();
  if (!radar.orders.some((o) => o.risk) && !radar.scanning) scanAll();
}

window.addEventListener("dd-event", async (e) => {
  const ev = e.detail;
  if (ev.type === "order_new") {
    radar.fresh.add(ev.order.id);
    setTimeout(() => radar.fresh.delete(ev.order.id), 4000);
    DD().toast(`📦 NEW ORDER · ${ev.via}`, `${ev.order.buyerName}: ${ev.order.item} · ${usd(ev.order.total)}. Scanning…`, "alert");
    if (radar.built) await loadOrders();
  }
  if (ev.type === "order_scored") {
    if (ev.order.level === "HIGH") DD().toast("🛑 HIGH-RISK ORDER", `${ev.order.buyerName} (${usd(ev.order.total)}) scored ${ev.order.score}. Hold before shipping.`, "warn");
    else DD().toast(`✓ ORDER SCORED · ${ev.order.level}`, `${ev.order.buyerName}: risk ${ev.order.score}. ${ACTION_LABEL[ev.order.action]}.`, "good");
    if (radar.built) { await loadOrders(); if (current === "radar") selectOrder(ev.order.id); }
  }
});

// ================= INSIGHTS =================
const insights = { loaded: false, loading: false };

async function openInsights() {
  if (insights.loaded || insights.loading) return;
  insights.loading = true;
  const el = $("#view-insights");
  el.innerHTML = `<div class="view-pad"><div class="view-head"><div class="grow"><h2>📊 INSIGHTS</h2><p>Where disputes cost you money, and what to change.</p></div></div>
    <div class="panel in-card"><div class="thinking" id="in-think"></div></div></div>`;
  const lines = ["▶ loading 90 days of dispute history…", "▶ grouping losses by root cause, product and week…", "▶ AI analyst reviewing the numbers…", "▶ estimating savings for each fix…"];
  let i = 0;
  const t = setInterval(() => { if (i < lines.length) $("#in-think").innerHTML += `<div>${lines[i++]}</div>`; }, 450);
  try {
    const { data, report } = await DD().api("/api/insights");
    await sleep(Math.max(0, 1900 - i * 450));
    clearInterval(t);
    renderInsights(data, report);
    insights.loaded = true;
  } catch (err) {
    clearInterval(t);
    $("#in-think").innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
  insights.loading = false;
}

function renderInsights(data, report) {
  const savings = report.findings.reduce((s, f) => s + Number(f.monthly_savings || 0), 0);
  $("#view-insights").innerHTML = `<div class="view-pad">
    <div class="view-head"><div class="grow"><h2>📊 INSIGHTS <span class="sample-tag">SAMPLE HISTORY</span></h2><p>${esc(data.disputes)} disputes over the ${esc(data.period)}. Numbers are computed in code; the AI only interprets them.</p></div></div>
    <div class="in-tiles">
      <div class="stat" style="--accent:#00e5ff"><div class="top"><span class="label">DISPUTES · 90 DAYS</span><span class="ico">📬</span></div><div class="value">${data.disputes}</div></div>
      <div class="stat" style="--accent:#ff4d6d"><div class="top"><span class="label">MONEY LOST</span><span class="ico">💸</span></div><div class="value">${usd0(data.lostAmount)}</div></div>
      <div class="stat" style="--accent:#ffb547"><div class="top"><span class="label">WIN RATE</span><span class="ico">⚖️</span></div><div class="value">${data.winRate}%</div></div>
      <div class="stat" style="--accent:#2bffb1"><div class="top"><span class="label">SAVINGS IF FIXED</span><span class="ico">🚀</span></div><div class="value">${usd0(savings)}<span style="font-size:14px;color:var(--muted)">/mo</span></div></div>
    </div>
    <div class="in-grid">
      <div class="panel in-card">
        <h3>🤖 AI PROFIT-LEAK REPORT</h3>
        <div class="report-head">${esc(report.headline)}</div>
        ${report.findings.map((f, i) => `<div class="finding" style="animation-delay:${0.15 + i * 0.15}s">
          <div class="ft">${i + 1}. ${esc(f.title)}</div>
          <div class="fs"><b>+${usd0(f.monthly_savings)}</b><span>PER MONTH · ${esc(f.effort)} EFFORT</span></div>
          <div class="fd">${esc(f.detail)}</div>
          <div class="ff"><b>FIX</b>${esc(f.fix)}</div>
        </div>`).join("")}
        <div class="muted" style="font-family:var(--mono);font-size:10px">engine: ${esc(report.engine)}</div>
      </div>
      <div>
        <div class="panel in-card chart"><h3>MONEY LOST BY ROOT CAUSE</h3><div class="sub">Last 90 days · settled cases count 40% of the amount</div><div id="ch-cause"></div></div>
        <div class="panel in-card chart"><h3>MONEY LOST PER WEEK</h3><div class="sub">13 weeks, oldest on the left</div><div id="ch-week"></div></div>
        <div class="panel in-card chart"><h3>MONEY LOST BY PRODUCT</h3><div class="sub">Last 90 days</div><div id="ch-product"></div></div>
      </div>
    </div>
  </div>`;
  hbar($("#ch-cause"), data.byCause.map((g) => ({ label: g.key, value: g.lost, tip: `${g.count} disputes · ${g.winRate}% won` })));
  lineChart($("#ch-week"), data.weeks.map((w) => ({ label: `W${w.week}`, value: w.lost, tip: `${w.count} disputes` })));
  hbar($("#ch-product"), data.byProduct.map((g) => ({ label: g.key, value: g.lost, tip: `${g.count} disputes · ${g.winRate}% won` })));
}

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v || 1)));
  return Math.ceil(v / p / (v / p > 5 ? 2 : 1)) * p * (v / p > 5 ? 2 : 1);
}
const compact = (n) => (n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : `$${n}`);

function dataTable(rows, a, b) {
  return `<details class="tbl"><summary>Show data table</summary><table><tr><th>${a}</th><th>${b}</th></tr>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${usd(r.value)}</td></tr>`).join("")}</table></details>`;
}

// Horizontal bars: one series, one hue, value at the tip, hover tooltip.
function hbar(el, rows) {
  const W = el.clientWidth || 480, labelW = 170, valueW = 64, barH = 20, gap = 12, top = 4;
  const H = top + rows.length * (barH + gap);
  const max = niceMax(Math.max(...rows.map((r) => r.value)));
  const x = (v) => ((W - labelW - valueW) * v) / max;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Bar chart">
    ${rows.map((r, i) => {
      const y = top + i * (barH + gap), w = Math.max(2, x(r.value)), rr = Math.min(4, w);
      return `<g class="row" data-i="${i}">
        <rect class="hit" x="0" y="${y - gap / 2}" width="${W}" height="${barH + gap}" fill="transparent"/>
        <text class="cat" x="${labelW - 10}" y="${y + barH / 2 + 4}" text-anchor="end">${esc(r.label)}</text>
        <path class="mark" d="M${labelW} ${y} h${w - rr} a${rr} ${rr} 0 0 1 ${rr} ${rr} v${barH - 2 * rr} a${rr} ${rr} 0 0 1 ${-rr} ${rr} h${-(w - rr)} Z"/>
        <text class="val" x="${labelW + w + 6}" y="${y + barH / 2 + 4}">${usd0(r.value)}</text>
      </g>`;
    }).join("")}
    <line x1="${labelW}" y1="0" x2="${labelW}" y2="${H}" class="grid"/>
  </svg>${dataTable(rows, "Category", "Money lost")}`;
  el.querySelectorAll(".row").forEach((g) => {
    const r = rows[g.dataset.i];
    g.onmousemove = (e) => showTip(e, `<b>${esc(r.label)}</b><br/>${usd(r.value)} lost · ${esc(r.tip)}`);
    g.onmouseleave = hideTip;
  });
}

// Line + light area, crosshair tooltip, labeled endpoint.
function lineChart(el, pts) {
  const W = el.clientWidth || 480, H = 190, L = 44, Rp = 56, T = 12, B = 24;
  const max = niceMax(Math.max(...pts.map((p) => p.value)));
  const x = (i) => L + ((W - L - Rp) * i) / (pts.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const last = pts.length - 1;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Line chart of money lost per week">
    ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - Rp}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 8}" y="${y(t) + 3}" text-anchor="end">${compact(t)}</text>`).join("")}
    ${pts.map((p, i) => (i % 2 === 0 ? `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${p.label}</text>` : "")).join("")}
    <path class="area" d="${line} L${x(last)} ${y(0)} L${x(0)} ${y(0)} Z"/>
    <path class="line" d="${line}"/>
    <circle class="dotm" cx="${x(last)}" cy="${y(pts[last].value)}" r="4"/>
    <text class="val" x="${x(last) + 8}" y="${y(pts[last].value) + 4}">${usd0(pts[last].value)}</text>
    <line class="xhair hidden" id="xh" y1="${T}" y2="${H - B}"/>
    <circle class="dotm hidden" id="xd" r="4"/>
    <rect id="hit" x="${L}" y="0" width="${W - L - Rp}" height="${H}" fill="transparent"/>
  </svg>${dataTable(pts, "Week", "Money lost")}`;
  const svg = el.querySelector("svg"), xh = el.querySelector("#xh"), xd = el.querySelector("#xd");
  el.querySelector("#hit").onmousemove = (e) => {
    const b = svg.getBoundingClientRect();
    const px = ((e.clientX - b.left) / b.width) * W;
    const i = Math.max(0, Math.min(last, Math.round(((px - L) / (W - L - Rp)) * last)));
    xh.setAttribute("x1", x(i)); xh.setAttribute("x2", x(i)); xh.classList.remove("hidden");
    xd.setAttribute("cx", x(i)); xd.setAttribute("cy", y(pts[i].value)); xd.classList.remove("hidden");
    showTip(e, `<b>Week ${i + 1}</b><br/>${usd(pts[i].value)} lost · ${esc(pts[i].tip)}`);
  };
  el.querySelector("#hit").onmouseleave = () => { xh.classList.add("hidden"); xd.classList.add("hidden"); hideTip(); };
}

// ================= TRACK RECORD =================
// Predictions vs. PayPal's rulings, and what the agent learned from them.
const track = { loading: false, stale: true };
const C_RAW = "#d95926"; // agent alone (categorical slot 2, validated on the dark surface)
const C_CAL = "#3987e5"; // with track record (categorical slot 1)
const C_ACTUAL = "#e6f1ff"; // what really happened (ink)
const VERDICT_LABEL = { FIGHT: "Fight", OFFER_PARTIAL_REFUND: "Partial refund", ACCEPT_CLAIM: "Accept", SEND_MESSAGE: "Reply" };
const OUTCOME_COLOR = { WON: "var(--green)", SETTLED: "var(--violet)", LOST: "var(--red)" };
const LESSON_ICON = { OVERCONFIDENT: "📉", UNDERCONFIDENT: "📈", STRATEGY: "♟️", CALIBRATED: "🎯" };

async function openTrack() {
  if (track.loading || !track.stale) return;
  track.loading = true;
  const el = $("#view-track");
  if (!el.innerHTML) el.innerHTML = `<div class="view-pad"><div class="view-head"><div class="grow"><h2>🧠 TRACK RECORD</h2><p>How often the agent was right, and what it learned.</p></div></div><div class="panel in-card"><div class="thinking"><div>▶ loading resolved cases…</div></div></div></div>`;
  try {
    renderTrack(await DD().api("/api/track-record"));
    track.stale = false;
  } catch (err) {
    el.innerHTML = `<div class="view-pad"><div class="error">${esc(err.message)}</div></div>`;
  }
  track.loading = false;
}

function renderTrack(t) {
  const ago = (iso) => { const d = Math.round((Date.now() - new Date(iso)) / 86400000); return d <= 0 ? "today" : `${d}d ago`; };
  $("#view-track").innerHTML = `<div class="view-pad">
    <div class="view-head"><div class="grow"><h2>🧠 TRACK RECORD <span class="sample-tag">SAMPLE HISTORY + LIVE</span></h2>
      <p>Every plan the agent recommends is checked against PayPal's final ruling. Similar past cases then calibrate the win odds for new disputes, and Autopilot uses the calibrated odds. Numbers are computed in code.</p></div></div>
    <div class="in-tiles">
      <div class="stat" style="--accent:#00e5ff"><div class="top"><span class="label">RESOLVED CASES</span><span class="ico">⚖️</span></div><div class="value">${t.resolved}</div><div class="tile-sub">${t.newSinceStart ? `+${t.newSinceStart} new this session` : "past disputes the agent handled"}</div></div>
      <div class="stat" style="--accent:#2bffb1"><div class="top"><span class="label">PLANS THAT WORKED</span><span class="ico">✅</span></div><div class="value">${t.planSuccess}%</div><div class="tile-sub">won, settled or closed as planned</div></div>
      <div class="stat" style="--accent:#ffb547"><div class="top"><span class="label">FIGHT WIN RATE</span><span class="ico">🥊</span></div><div class="value">${t.fightWinRate}%</div><div class="tile-sub">${t.fought} cases fought</div></div>
      <div class="stat" style="--accent:#9b7bff"><div class="top"><span class="label">PREDICTION ERROR</span><span class="ico">🎯</span></div><div class="value">−${Math.max(0, t.brier.improvement)}%</div><div class="tile-sub">Brier ${t.brier.raw} → ${t.brier.calibrated} with learning</div></div>
    </div>
    <div class="in-grid">
      <div>
        <div class="panel in-card">
          <h3>🧠 WHAT THE AGENT LEARNED</h3>
          <div class="sub">Case types with at least 4 fought cases. These lessons change the odds on new disputes.</div>
          ${t.lessons.map((l, i) => `<div class="lesson ${l.kind.toLowerCase()}" style="animation-delay:${0.1 + i * 0.1}s"><span class="li">${LESSON_ICON[l.kind]}</span><div><div class="lk">${l.kind}</div>${esc(l.text)}</div></div>`).join("") || `<p class="muted">Not enough resolved cases yet.</p>`}
        </div>
        <div class="panel in-card" style="margin-top:20px">
          <h3>⏳ AWAITING PAYPAL'S RULING</h3>
          <div class="sub">Responses already sent. Each ruling is added to the record when it arrives.</div>
          ${t.pending.length ? t.pending.map((p) => `<div class="tr-row">
              <div class="grow"><b>${esc(p.item ?? p.disputeId)}</b> <span class="muted">· ${esc(p.disputeId)}</span><br/><span class="muted">${esc(VERDICT_LABEL[p.verdict] ?? p.verdict)} · predicted ${p.odds}% · $${Number(p.amount).toFixed(2)}</span></div>
              ${p.simulated ? `<button class="mini-btn tr-rule" data-id="${esc(p.disputeId)}">⚖️ SIMULATE RULING</button>` : `<span class="muted" style="font-size:11px">via webhook</span>`}
            </div>`).join("") : `<p class="muted">Nothing waiting. Approve a plan on the Disputes tab and it shows up here.</p>`}
        </div>
        <div class="panel in-card" style="margin-top:20px">
          <h3>📜 RECENT RULINGS</h3>
          ${t.recent.map((x) => `<div class="tr-row">
              <span class="tr-out" style="--oc:${OUTCOME_COLOR[x.outcome]}">${x.outcome}</span>
              <div class="grow">${esc(x.label)}<br/><span class="muted">${esc(VERDICT_LABEL[x.verdict] ?? x.verdict)} · predicted ${x.odds}% · kept $${Number(x.kept).toFixed(2)} of $${Number(x.amount).toFixed(2)} · ${ago(x.closed)}${x.source === "history" ? "" : ` · <b class="new-tag">NEW</b>`}</span></div>
              <span class="tr-check" title="${x.correct === null ? "Accepted claim: nothing to check" : x.correct ? "The plan worked" : "The plan didn't work"}">${x.correct === null ? "–" : x.correct ? "✓" : "✗"}</span>
            </div>`).join("")}
        </div>
      </div>
      <div>
        <div class="panel in-card chart"><h3>ARE THE WIN ODDS HONEST?</h3>
          <div class="sub">Fought cases grouped by predicted odds. On the dashed line, "80%" means the seller really wins 8 times in 10.</div>
          <div class="legend"><span><i class="lg-dot" style="background:${C_RAW}"></i>Agent alone</span><span><i class="lg-sq" style="background:${C_CAL}"></i>With track record</span><span><i class="lg-dash"></i>Perfectly honest</span></div>
          <div id="ch-calib"></div></div>
        <div class="panel in-card chart"><h3>PREDICTED vs. ACTUAL, BY CASE TYPE</h3>
          <div class="sub">Average odds the agent gave vs. how often the seller actually won. A long red bar means the agent needed correcting.</div>
          <div class="legend"><span><i class="lg-dot" style="background:${C_RAW}"></i>Agent predicted</span><span><i class="lg-dot" style="background:${C_ACTUAL}"></i>Actually won</span></div>
          <div id="ch-pattern"></div></div>
      </div>
    </div>
  </div>`;
  calibChart($("#ch-calib"), t.buckets);
  dumbbell($("#ch-pattern"), t.patterns.filter((p) => p.fought > 0));
  document.querySelectorAll(".tr-rule").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    b.textContent = "⚖️ REVIEWING…";
    try {
      await sleep(700);
      await DD().api(`/api/disputes/${encodeURIComponent(b.dataset.id)}/ruling`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } catch (err) {
      DD().toast("RULING FAILED", err.message, "warn");
      b.disabled = false;
    }
  }));
}

// Predicted odds (x) vs. actual win rate (y), with the "honest" diagonal.
function calibChart(el, buckets) {
  const W = el.clientWidth || 460, H = 300, L = 44, R = 110, T = 12, B = 34;
  const x = (v) => L + ((W - L - R) * v) / 100;
  const y = (v) => T + (H - T - B) * (1 - v / 100);
  const series = [
    { key: "raw", name: "Agent alone", color: C_RAW, shape: "circle" },
    { key: "calibrated", name: "With track record", color: C_CAL, shape: "square" },
  ];
  const pts = (k) => buckets.map((b) => b[k] && { ...b[k], range: b.range }).filter(Boolean);
  const marker = (p, s, i) => {
    const cx = x(p.predicted), cy = y(p.actual);
    const shape = s.shape === "circle"
      ? `<circle cx="${cx}" cy="${cy}" r="5" fill="${s.color}" class="cm"/>`
      : `<rect x="${cx - 5}" y="${cy - 5}" width="10" height="10" rx="2" fill="${s.color}" class="cm"/>`;
    return `<g class="cpt" data-s="${s.key}" data-i="${i}"><circle cx="${cx}" cy="${cy}" r="13" fill="transparent"/>${shape}</g>`;
  };
  const ticks = [0, 25, 50, 75, 100];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Calibration chart: predicted win odds against actual win rate">
    ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 8}" y="${y(v) + 3}" text-anchor="end">${v}%</text><text class="axis" x="${x(v)}" y="${H - B + 16}" text-anchor="middle">${v}%</text>`).join("")}
    <text class="axis" x="${(L + W - R) / 2}" y="${H - 2}" text-anchor="middle">predicted win odds</text>
    <text class="axis" x="12" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(T + H - B) / 2})">actually won</text>
    <line x1="${x(0)}" y1="${y(0)}" x2="${x(100)}" y2="${y(100)}" class="diag"/>
    ${series.map((s) => {
      const p = pts(s.key);
      const d = p.map((q, i) => `${i ? "L" : "M"}${x(q.predicted).toFixed(1)} ${y(q.actual).toFixed(1)}`).join(" ");
      const last = p.at(-1);
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" opacity=".85"/>
        ${p.map((q, i) => marker(q, s, i)).join("")}
        ${last ? `<text class="val" x="${x(last.predicted) + 10}" y="${y(last.actual) + (s.key === "raw" ? 14 : -6)}">${s.name}</text>` : ""}`;
    }).join("")}
  </svg>
  <details class="tbl"><summary>Show data table</summary><table><tr><th>Predicted</th><th>Agent alone: predicted → won (n)</th><th>With track record: predicted → won (n)</th></tr>
  ${buckets.map((b) => `<tr><td>${b.range}</td><td>${b.raw ? `${b.raw.predicted}% → ${b.raw.actual}% (${b.raw.n})` : "–"}</td><td>${b.calibrated ? `${b.calibrated.predicted}% → ${b.calibrated.actual}% (${b.calibrated.n})` : "–"}</td></tr>`).join("")}</table></details>`;
  el.querySelectorAll(".cpt").forEach((g) => {
    const s = series.find((q) => q.key === g.dataset.s);
    const p = pts(s.key)[g.dataset.i];
    g.onmousemove = (e) => showTip(e, `<b>${s.name}</b><br/>Predicted ${p.predicted}% · actually won ${p.actual}%<br/>${p.n} case${p.n === 1 ? "" : "s"} in the ${p.range} group`);
    g.onmouseleave = hideTip;
  });
}

// One row per case type: predicted odds dot, actual win-rate dot, joined by a bar.
function dumbbell(el, rows) {
  const W = el.clientWidth || 460, labelW = 190, valueW = 70, rowH = 34, top = 8, axisH = 22;
  const H = top + rows.length * rowH + axisH;
  const x = (v) => labelW + ((W - labelW - valueW) * v) / 100;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Predicted versus actual win rate by case type">
    ${[0, 50, 100].map((v) => `<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="${top - 4}" y2="${H - axisH}"/><text class="axis" x="${x(v)}" y="${H - 6}" text-anchor="middle">${v}%</text>`).join("")}
    ${rows.map((r, i) => {
      const cy = top + i * rowH + rowH / 2;
      const short = r.label.replace("Not received · ", "NR · ").replace("Not as described · ", "SNAD · ").replace("Unauthorized · ", "Unauth · ");
      const big = Math.abs(r.bias) >= 10;
      return `<g class="drow" data-i="${i}">
        <rect x="0" y="${cy - rowH / 2}" width="${W}" height="${rowH}" fill="transparent"/>
        <text class="cat" x="${labelW - 12}" y="${cy + 4}" text-anchor="end">${esc(short)}</text>
        <line x1="${x(r.avgPredicted)}" x2="${x(r.actual)}" y1="${cy}" y2="${cy}" stroke="${big ? "rgba(255,77,109,.55)" : "rgba(255,255,255,.25)"}" stroke-width="${big ? 4 : 2}" stroke-linecap="round"/>
        <circle cx="${x(r.avgPredicted)}" cy="${cy}" r="5.5" fill="${C_RAW}" stroke="var(--panel-solid)" stroke-width="2"/>
        <circle cx="${x(r.actual)}" cy="${cy}" r="5.5" fill="${C_ACTUAL}" stroke="var(--panel-solid)" stroke-width="2"/>
        <text class="val" x="${W - valueW + 10}" y="${cy + 4}">${r.actual}% <tspan class="axis">n=${r.fought}</tspan></text>
      </g>`;
    }).join("")}
  </svg>
  <details class="tbl"><summary>Show data table</summary><table><tr><th>Case type</th><th>Predicted</th><th>Actually won</th><th>Fought</th></tr>
  ${rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.avgPredicted}%</td><td>${r.actual}%</td><td>${r.fought}</td></tr>`).join("")}</table></details>`;
  el.querySelectorAll(".drow").forEach((g) => {
    const r = rows[g.dataset.i];
    const gap = r.bias > 0 ? `${r.bias} points too optimistic` : r.bias < 0 ? `${-r.bias} points too cautious` : "spot on";
    g.onmousemove = (e) => showTip(e, `<b>${esc(r.label)}</b><br/>Agent predicted ${r.avgPredicted}% · actually won ${r.actual}%<br/>${r.fought} fought · ${gap}`);
    g.onmouseleave = hideTip;
  });
}

// Keep the Track Record fresh as responses go out and rulings come in.
window.addEventListener("dd-event", (e) => {
  if (!["outcome", "action"].includes(e.detail.type)) return;
  track.stale = true;
  if (current === "track") openTrack();
});

// ================= INTEGRATIONS =================
const intg = { built: false, data: null, flash: new Set() };
const GROUP_ICON = { PayPal: "🏦", "Evidence & fraud signals": "🔎", "Alerts & automation": "📣" };

function buildIntegrationsShell() {
  $("#view-integrations").innerHTML = `<div class="view-pad">
    <div class="view-head"><div class="grow"><h2>🔌 INTEGRATIONS</h2><p>Every outside API Dispute Defender talks to. <b>LIVE</b> ones make real calls. <b>DEMO</b> ones simulate the call and log what would have been sent. Add the keys in <code>.env</code> to switch one on.</p></div></div>
    <div class="ig-stats" id="ig-stats"></div>
    <div class="ig-grid"><div id="ig-cards"></div><div class="panel ig-log-panel"><div class="panel-head"><h2><span class="dot live"></span> CALL LOG</h2></div><ul class="ig-log" id="ig-log"></ul></div></div>
  </div>`;
  intg.built = true;
}

function renderIntegrations() {
  const { integrations, calls, calendarUrl, webhookUrl } = intg.data;
  const live = integrations.filter((i) => i.live).length;
  $("#ig-stats").innerHTML = `
    <div class="stat" style="--accent:#2bffb1"><div class="top"><span class="label">LIVE</span><span class="ico">🟢</span></div><div class="value">${live}<span style="font-size:14px;color:var(--muted)"> / ${integrations.length}</span></div></div>
    <div class="stat" style="--accent:#00e5ff"><div class="top"><span class="label">CALLS THIS SESSION</span><span class="ico">📡</span></div><div class="value">${calls.length}</div></div>
    <div class="stat" style="--accent:#ff4d6d"><div class="top"><span class="label">FAILED</span><span class="ico">⚠</span></div><div class="value">${calls.filter((c) => !c.ok).length}</div></div>`;
  const groups = [...new Set(integrations.map((i) => i.group))];
  $("#ig-cards").innerHTML = groups.map((g) => `<div class="section-title">${GROUP_ICON[g] ?? ""} ${esc(g).toUpperCase()}</div><div class="ig-cards">${integrations.filter((i) => i.group === g).map((i) => `
    <div class="ig-card ${i.live ? "on" : "off"}">
      <div class="ig-top"><b>${esc(i.name)}</b><span class="ig-badge">${i.live ? "LIVE" : "DEMO"}</span></div>
      <p>${esc(i.what)}</p>
      ${i.missing.length ? `<div class="ig-env">Set ${i.missing.map((k) => `<code>${esc(k)}</code>`).join(" ")}</div>` : ""}
      ${i.id === "calendar" ? `<div class="ig-env"><input readonly value="${esc(calendarUrl)}" onclick="this.select()" /> <a class="mini-btn" href="/api/calendar.ics?download=1">⬇ .ics</a></div>` : ""}
      ${i.id === "paypal_webhooks" ? `<div class="ig-env">Webhook URL: <code>${esc(webhookUrl)}</code></div>` : ""}
      <div class="ig-foot"><span class="muted">${i.calls} call${i.calls === 1 ? "" : "s"}</span>${i.testable && i.live ? `<button class="mini-btn" data-test="${i.id}">▶ SEND TEST</button>` : ""}</div>
    </div>`).join("")}</div>`).join("");
  document.querySelectorAll("[data-test]").forEach((b) => (b.onclick = () => testChannel(b)));
  $("#ig-log").innerHTML = calls.length
    ? calls.map((c) => `<li class="${c.ok ? (c.simulated ? "sim" : "ok") : "bad"} ${intg.flash.has(c.seq) ? "new" : ""}"><span class="t">${new Date(c.time).toLocaleTimeString()}</span> <b>${esc(integrations.find((i) => i.id === c.id)?.name ?? c.id)}</b> <span class="tag">${c.ok ? (c.simulated ? "DEMO" : "OK") : "FAIL"}${c.ms != null ? ` · ${c.ms}ms` : ""}</span><div class="a">${esc(c.action)}</div><div class="d">${esc(c.detail)}</div></li>`).join("")
    : `<li class="muted">No outside calls yet. Ship or cancel an order in Risk Radar, investigate a dispute, or download the calendar.</li>`;
}

async function loadIntegrations() {
  intg.data = await DD().api("/api/integrations");
  renderIntegrations();
}

async function testChannel(btn) {
  btn.disabled = true;
  try {
    await DD().api(`/api/integrations/${btn.dataset.test}/test`, { method: "POST" });
    DD().toast("✅ TEST SENT", "Check the channel for the message.", "good");
  } catch (err) {
    DD().toast("⚠ TEST FAILED", err.message, "warn");
  }
  btn.disabled = false;
}

async function openIntegrations() {
  if (!intg.built) buildIntegrationsShell();
  await loadIntegrations();
}

window.addEventListener("dd-event", (e) => {
  const ev = e.detail;
  if (ev.type === "deadline") DD().toast(`⏰ DEADLINE · ${ev.hoursLeft}h LEFT`, `${ev.disputeId}: ${ev.buyerName}, ${usd(ev.amount?.value ?? 0)}. Respond before PayPal rules for the buyer.`, "warn");
  if (ev.type !== "integration_call" || current !== "integrations") return;
  intg.flash.add(ev.entry.seq);
  setTimeout(() => intg.flash.delete(ev.entry.seq), 3000);
  loadIntegrations();
});

window.addEventListener("dd-event", (e) => {
  const ev = e.detail;
  if (ev.type !== "package_tap" && ev.type !== "tag_written") return;
  const el = document.getElementById("rr-tag");
  if (el && el.dataset.tag === ev.tagId) loadRadarTag(ev.tagId);
});
