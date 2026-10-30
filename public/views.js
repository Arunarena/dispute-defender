// Tabs + the Risk Radar and Insights views.
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
  for (const v of ["disputes", "radar", "insights"]) $(`#view-${v}`).classList.toggle("hidden", v !== view);
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  if (view === "radar") openRadar();
  if (view === "insights") openInsights();
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

const ACTION_LABEL = { SHIP: "SHIP", SHIP_WITH_SIGNATURE: "SHIP + SIGNATURE", HOLD_AND_VERIFY: "HOLD & VERIFY" };
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
  const decided = o.status !== "AWAITING_SHIPMENT";
  $("#rr-detail").innerHTML = `<div class="rr-detail">
    <div style="display:flex;gap:16px;align-items:center">
      <div class="score ${r.level}" style="min-width:90px"><b style="font-size:34px">${r.score}</b><span>${r.level} RISK</span></div>
      <div><h3>${esc(r.headline)}</h3><div class="muted" style="font-size:12px">${esc(o.buyerName)} · ${esc(o.email)} · engine: ${esc(r.engine)}</div></div>
    </div>
    <div class="section-title" style="margin-top:16px">&gt; WHAT DROVE THE SCORE <span class="muted">(red adds risk · green lowers it)</span></div>
    ${r.signals.map((sg, i) => `<div class="sig"><span class="sl">${esc(sg.label)}</span><div class="track"><div class="bar ${sg.impact >= 0 ? "up" : "down"}" style="width:${Math.min(50, (Math.abs(sg.impact) / 40) * 50)}%;animation-delay:${i * 0.08}s"></div></div><span class="sv">${sg.impact > 0 ? "+" : ""}${sg.impact}</span><span class="sd">${esc(sg.detail)}</span></div>`).join("")}
    <div class="rr-actions">
      ${["SHIP", "SHIP_WITH_SIGNATURE", "HOLD_AND_VERIFY"].map((a) => `<button class="act-btn ${{ SHIP: "ship", SHIP_WITH_SIGNATURE: "sign", HOLD_AND_VERIFY: "hold" }[a]} ${r.action === a ? "rec" : ""}" data-a="${a}" ${decided ? "disabled" : ""}>${{ SHIP: "📦", SHIP_WITH_SIGNATURE: "✍️", HOLD_AND_VERIFY: "⏸" }[a]} ${ACTION_LABEL[a]}${r.action === a ? " · AI PICK" : ""}</button>`).join("")}
    </div>
    ${decided ? `<div class="muted" style="margin-top:10px;font-family:var(--mono);font-size:12px">Decision recorded: ${STATUS_LABEL[o.status]}</div>` : ""}
  </div>`;
  document.querySelectorAll(".act-btn").forEach((b) => (b.onclick = () => decide(o.id, b.dataset.a)));
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
  const { order, stats } = await DD().api(`/api/orders/${id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
  radar.orders = radar.orders.map((o) => (o.id === id ? order : o));
  radar.stats = stats;
  drawRadarAll();
  if (decision === "HOLD_AND_VERIFY" && order.risk?.level === "HIGH") {
    DD().toast("🛡️ FRAUD PREVENTED", `${order.buyerName}'s ${usd(order.total)} order is on hold. That's a dispute that will never happen.`, "good");
    const b = document.querySelector(".act-btn.hold")?.getBoundingClientRect();
    if (b) DD().burst(b.left + b.width / 2, b.top);
  } else DD().toast("ORDER UPDATED", `${order.id}: ${STATUS_LABEL[order.status]}`, "");
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
