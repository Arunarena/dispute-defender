// Dispute Defender companion app.
// Talks to your Dispute Defender server over its HTTP API, or runs the offline demo
// (the server's demo engine inside the app, see offline/server.js). Nothing goes to
// PayPal until you tap Approve, exactly like the desktop dashboard.
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const usd = (v) => `$${Number(v).toFixed(2)}`;
  const daysLeft = (iso) => (iso ? Math.ceil((new Date(iso) - Date.now()) / 86400000) : null);
  const isDone = (s) => ["RESOLVED", "UNDER_REVIEW", "WAITING_FOR_BUYER_RESPONSE"].includes(s);

  // Native plugins (present inside the Android app, absent in a desktop browser).
  const Plugins = window.Capacitor?.Plugins ?? {};
  const native = Boolean(window.Capacitor?.isNativePlatform?.());

  const REASONS = {
    MERCHANDISE_OR_SERVICE_NOT_RECEIVED: ["NOT RECEIVED", "inr"],
    MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: ["NOT AS DESCRIBED", "snad"],
    UNAUTHORISED: ["UNAUTHORIZED", "unauth"],
    CREDIT_NOT_PROCESSED: ["REFUND NOT RECEIVED", "cnp"],
    DUPLICATE_TRANSACTION: ["DUPLICATE CHARGE", "dup"],
  };
  const VERDICTS = {
    FIGHT: { label: "FIGHT", action: "Submit evidence", color: "#2bffb1" },
    OFFER_PARTIAL_REFUND: { label: "PARTIAL REFUND", action: "Send offer", color: "#9b7bff" },
    ACCEPT_CLAIM: { label: "ACCEPT", action: "Accept claim", color: "#ff4d6d" },
    SEND_MESSAGE: { label: "REPLY", action: "Send message", color: "#00e5ff" },
  };
  const OUTCOMES = {
    WON: { label: "WON", text: "PayPal ruled for you", color: "#2bffb1" },
    SETTLED: { label: "SETTLED", text: "The buyer accepted your offer", color: "#9b7bff" },
    LOST: { label: "LOST", text: "PayPal ruled for the buyer", color: "#ff4d6d" },
  };
  const STEP_ICON = { lookup_order: "🧾", track_shipment: "🚚", get_customer_history: "👤", get_store_policies: "📜", inspect_photos: "📸", track_record: "🧠" };
  const pill = (r) => { const [l, c] = REASONS[r] ?? [String(r ?? "OTHER").replaceAll("_", " "), "stage"]; return `<span class="pill ${c}">${esc(l)}</span>`; };

  const state = { server: localStorage.getItem("dd.server") || "", config: null, disputes: [], activity: [], rules: null, tab: "home", detailId: null, current: null, fresh: new Set(), events: null, analyzing: false };

  // ---------------- API ----------------
  // state.server is either a server address or OFFLINE (the demo engine runs in the app).
  const OFFLINE = "offline";
  const isOffline = () => state.server === OFFLINE;
  let engine = null;
  const loadEngine = async () => (engine ??= await import("./offline/server.js"));

  async function api(path, opts = {}) {
    if (!state.server) throw new Error("Set your server address in Settings.");
    if (isOffline()) return (await loadEngine()).request(path, opts);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 20000);
    try {
      const res = await fetch(state.server + path, { ...opts, signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
      return data;
    } catch (e) {
      throw new Error(e.name === "AbortError" ? "The server didn't answer in time." : e.message === "Failed to fetch" ? "Can't reach the server. Check the address in Settings." : e.message);
    } finally {
      clearTimeout(timer);
    }
  }
  // EventSource, or the offline engine's stand-in (loadEngine() has run by then).
  const openStream = (path) => (isOffline() ? engine.stream(path) : new EventSource(state.server + path));
  const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

  // ---------------- feedback ----------------
  function toast(title, body, kind = "") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.innerHTML = `<b>${esc(title)}</b>${esc(body)}`;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }
  let notifyId = 1;
  async function notify(title, body, disputeId) {
    toast(title, body, "");
    if (!native || !Plugins.LocalNotifications || document.visibilityState === "visible") return;
    try {
      await Plugins.LocalNotifications.schedule({ notifications: [{ id: notifyId++, title, body, extra: { disputeId } }] });
    } catch {}
  }
  const buzz = (style = "MEDIUM") => Plugins.Haptics?.impact?.({ style }).catch(() => {});

  // ---------------- navigation ----------------
  function setTab(tab) {
    state.tab = tab;
    state.detailId = null;
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    render();
  }
  document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  $("#back").onclick = () => goBack();
  function goBack() {
    if (!$("#sheet").classList.contains("hidden")) return closeSheet();
    if (state.detailId) {
      state.detailId = null;
      render();
      return true;
    }
    if (state.tab !== "home") {
      setTab("home");
      return true;
    }
    return false;
  }
  Plugins.App?.addListener?.("backButton", () => { if (!goBack()) Plugins.App.exitApp(); });

  function render() {
    const inDetail = Boolean(state.detailId);
    $("#back").classList.toggle("hidden", !inDetail);
    $("#title").innerHTML = inDetail ? esc(state.detailId) : `<span class="shield">🛡️</span> Dispute Defender`;
    $("#main").scrollTop = 0;
    if (!state.server && state.tab !== "settings") return renderSetup();
    if (inDetail) return renderDetail();
    if (state.tab === "home") return renderHome();
    if (state.tab === "track") return renderTrack();
    return renderSettings();
  }

  // ---------------- first run ----------------
  function renderSetup() {
    $("#main").innerHTML = `<div class="empty"><div class="big">🛡️</div><h2 style="color:var(--ink)">Connect to your server</h2>
      <p>Try the offline demo with no internet or server, or connect to your Dispute Defender server.</p></div>
      ${offlineCard()}
      ${serverForm()}`;
    bindOffline();
    bindServerForm();
  }

  function offlineCard() {
    return `<div class="card">
      <b>📴 Offline demo</b>
      <p class="muted" style="font-size:12px;line-height:1.5;margin:6px 0 10px">Runs on this phone with no internet. Sample disputes, the scripted AI agent, Autopilot and simulated PayPal rulings. Nothing is sent anywhere. Resets when the app restarts.</p>
      <button class="btn ${isOffline() ? "alt" : ""}" id="offline-go" ${isOffline() ? "disabled" : ""}>${isOffline() ? "✓ Using offline demo" : "Use offline demo"}</button>
    </div>`;
  }
  function bindOffline() {
    $("#offline-go").onclick = async () => {
      $("#offline-go").disabled = true;
      try {
        await loadEngine();
      } catch (e) {
        $("#offline-go").disabled = false;
        return toast("OFFLINE DEMO FAILED", e.message, "bad");
      }
      state.server = OFFLINE;
      localStorage.setItem("dd.server", OFFLINE);
      state.config = await api("/api/config");
      state.disputes = [];
      connectEvents();
      toast("📴 OFFLINE DEMO", "Sample data and the scripted agent, all on this phone.", "good");
      await refresh();
      setTab("home");
    };
  }

  function serverForm() {
    return `<div class="card">
      <label class="f" for="srv">Server address</label>
      <input id="srv" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://your-app.onrender.com" value="${isOffline() ? "" : esc(state.server)}" />
      <p class="muted" style="font-size:12px;line-height:1.5">Hosted on Render: use its https address.<br/>Running on your PC: use <span class="mono">http://&lt;PC's Wi-Fi IP&gt;:3000</span> (same Wi-Fi), or <span class="mono">http://10.0.2.2:3000</span> in the Android emulator.</p>
      <button class="btn" id="srv-save">Connect</button>
      <div id="srv-msg"></div>
    </div>`;
  }
  function bindServerForm() {
    $("#srv-save").onclick = async () => {
      const url = $("#srv").value.trim().replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(url)) return ($("#srv-msg").innerHTML = `<div class="error">Start the address with http:// or https://</div>`);
      $("#srv-save").disabled = true;
      $("#srv-save").textContent = "Connecting…";
      const prev = state.server;
      state.server = url;
      try {
        state.config = await api("/api/config", { timeout: 8000 });
        localStorage.setItem("dd.server", url);
        state.disputes = [];
        connectEvents();
        toast("✓ CONNECTED", `${state.config.paypalMode === "sandbox" ? "PayPal sandbox" : "Demo data"} · AI ${state.config.aiMode === "claude" ? state.config.model : "scripted"}`, "good");
        await refresh();
        setTab("home");
      } catch (e) {
        state.server = prev;
        $("#srv-msg").innerHTML = `<div class="error">${esc(e.message)}</div>`;
        $("#srv-save").disabled = false;
        $("#srv-save").textContent = "Connect";
      }
    };
  }

  // ---------------- home: disputes ----------------
  async function refresh() {
    try {
      const [list, ap] = await Promise.all([api("/api/disputes"), api("/api/autopilot")]);
      state.disputes = list.disputes;
      state.activity = list.activity;
      state.rules = ap.rules;
      setConn(true);
    } catch (e) {
      setConn(false);
      throw e;
    }
  }
  const setConn = (ok) => $("#conn").classList.toggle("ok", ok);

  async function renderHome() {
    const main = $("#main");
    if (!state.disputes.length) main.innerHTML = `<div class="empty"><div class="spin"></div><p>Loading disputes…</p></div>`;
    try {
      await refresh();
    } catch (e) {
      main.innerHTML = `<div class="empty"><div class="big">📡</div><p>${esc(e.message)}</p><button class="btn alt" id="retry">Try again</button></div>`;
      $("#retry").onclick = renderHome;
      return;
    }
    if (state.tab !== "home" || state.detailId) return;
    const open = state.disputes.filter((d) => !isDone(d.status));
    const atStake = open.reduce((s, d) => s + Number(d.amount.value), 0);
    const saved = state.activity.reduce((s, a) => s + Number(a.saved || 0), 0);
    const r = state.rules;
    const sorted = [...state.disputes].sort((a, b) => (isDone(a.status) - isDone(b.status)) || ((daysLeft(a.sellerResponseDue) ?? 99) - (daysLeft(b.sellerResponseDue) ?? 99)));
    main.innerHTML = `
      <div class="stats">
        <div class="stat" style="--accent:var(--amber)"><b>${open.length}</b><span>NEED RESPONSE</span></div>
        <div class="stat" style="--accent:#ff3df2"><b>$${Math.round(atStake)}</b><span>AT STAKE</span></div>
        <div class="stat" style="--accent:var(--green)"><b>$${Math.round(saved)}</b><span>PROTECTED</span></div>
      </div>
      <div class="card ap ${r?.enabled ? "on" : ""}" style="margin-top:12px">
        <div class="grow"><b>🤖 Autopilot</b><div class="muted" style="font-size:12px;margin-top:2px">${r?.enabled ? `Auto-fights at ≥${r.fightMinOdds}% odds up to $${r.fightMaxAmount}. Settles up to $${r.settleMaxAmount}.` : "Off: every dispute waits for you."}</div></div>
        <label class="switch"><input type="checkbox" id="ap" ${r?.enabled ? "checked" : ""}/><span></span></label>
      </div>
      <div class="row" style="margin:18px 2px 8px"><div class="h grow" style="margin:0">Disputes</div>
        ${state.config?.paypalMode !== "sandbox" ? `<button class="pill stage" id="sim" style="background:none;padding:6px 9px">📡 SIMULATE</button>` : ""}
        <button class="pill stage" id="reload" style="background:none;padding:6px 9px">⟳</button></div>
      ${sorted.map(cardHtml).join("") || `<div class="empty"><div class="big">🎉</div>No disputes right now.</div>`}`;
    document.querySelectorAll(".dcard").forEach((b) => (b.onclick = () => openDispute(b.dataset.id)));
    $("#ap").onchange = async (e) => {
      buzz("LIGHT");
      try {
        state.rules = (await post("/api/autopilot", { enabled: e.target.checked })).rules;
        toast(state.rules.enabled ? "🤖 AUTOPILOT ON" : "AUTOPILOT OFF", state.rules.enabled ? "New disputes are handled within your rules." : "Every dispute will wait for you.", state.rules.enabled ? "good" : "");
      } catch (err) {
        toast("COULDN'T CHANGE AUTOPILOT", err.message, "bad");
      }
      renderHome();
    };
    $("#reload").onclick = renderHome;
    if ($("#sim")) $("#sim").onclick = async () => {
      try { await post("/api/simulate/dispute"); } catch (e) { toast("SIMULATION FAILED", e.message, "bad"); }
    };
  }

  function cardHtml(d) {
    const days = daysLeft(d.sellerResponseDue);
    const done = isDone(d.status);
    const due = done ? ["✓ " + (d.status === "RESOLVED" ? "CLOSED" : "SENT"), "done"] : days == null ? ["", ""] : days <= 0 ? ["OVERDUE", "late"] : [`${days}d left`, days <= 5 ? "soon" : ""];
    return `<button class="dcard ${state.fresh.has(d.id) ? "new" : ""}" data-id="${esc(d.id)}">
      <div class="grow">
        <div class="row">${pill(d.reason)}<span class="grow"></span><span class="amt">${usd(d.amount.value)}</span></div>
        <div class="item">${esc(d.item ?? d.id)}</div>
        <div class="row"><span class="sub grow">${esc(d.buyerName ?? "")}${d.photos ? ` · 📸 ${d.photos}` : ""}</span>${due[0] ? `<span class="due ${due[1]}">${esc(due[0])}</span>` : ""}</div>
      </div><span class="chev">›</span></button>`;
  }

  // ---------------- detail ----------------
  async function openDispute(id) {
    state.detailId = id;
    state.current = null;
    render();
  }

  async function renderDetail() {
    const id = state.detailId;
    const main = $("#main");
    if (!state.current || state.current.dispute.id !== id) {
      main.innerHTML = `<div class="empty"><div class="spin"></div></div>`;
      try {
        state.current = await api(`/api/disputes/${encodeURIComponent(id)}`);
      } catch (e) {
        main.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`;
        return;
      }
      if (state.detailId !== id) return;
    }
    const { dispute: d, recommendation: rec } = state.current;
    const days = daysLeft(d.sellerResponseDue);
    main.innerHTML = `
      <div class="card hero">
        <div class="row">${pill(d.reason)}<span class="pill stage">${esc(d.stage)}</span><span class="grow"></span>${!isDone(d.status) && days != null ? `<span class="due ${days <= 0 ? "late" : days <= 5 ? "soon" : ""}">${days <= 0 ? "OVERDUE" : `${days}d left`}</span>` : `<span class="due done">${esc(d.status.replaceAll("_", " "))}</span>`}</div>
        <h2>${esc(d.items.map((i) => i.name).join(", ") || "Disputed transaction")}</h2>
        <div class="row"><div class="grow muted" style="font-size:13px">${esc(d.buyerName)}<br/><span class="mono" style="font-size:11px">TXN ${esc(d.transactionId ?? "n/a")}</span></div><div class="amt">${usd(d.amount.value)}</div></div>
      </div>
      <div id="ruling"></div>
      <div class="h">Messages</div>
      ${d.messages.map((m) => `<div class="msg ${esc(m.by)}"><div class="who">${m.by === "BUYER" ? esc(d.buyerName) : m.by === "SELLER" ? "You" : esc(m.by)} · ${new Date(m.time).toLocaleDateString()}</div>${esc(m.content)}</div>`).join("") || `<p class="muted">No messages.</p>`}
      <div id="analysis"></div>
      <div id="rec"></div>`;
    renderRuling();
    if (rec) renderRec();
    else if (!isDone(d.status)) renderAnalyzeButton();
  }

  function renderAnalyzeButton(label = "⚡ Run AI investigation") {
    $("#analysis").innerHTML = `<div style="margin-top:16px"><button class="btn" id="analyze">${label}</button>
      <p class="muted" style="font-size:12px;text-align:center">The agent reads the order, tracking, buyer history, photos and policies. Nothing is sent until you approve.</p></div>`;
    $("#analyze").onclick = () => analyze(state.current.dispute.id);
  }

  function analyze(id) {
    if (state.analyzing) return;
    state.analyzing = true;
    $("#rec").innerHTML = "";
    $("#analysis").innerHTML = `<div class="h">AI investigation</div><div class="card"><ul class="steps" id="steps"><li><span class="s"><span class="spin"></span></span>Starting the agent…</li></ul></div>`;
    const steps = $("#steps");
    const es = openStream(`/api/disputes/${encodeURIComponent(id)}/analyze`);
    let finished = false;
    const done = () => { finished = true; state.analyzing = false; es.close(); };
    const settleLast = (ok = true) => {
      const s = steps.querySelector("li:last-child .s");
      if (s && s.querySelector(".spin")) s.textContent = ok ? "✓" : "✗";
    };
    es.onmessage = async (e) => {
      const ev = JSON.parse(e.data);
      if (state.detailId !== id) return done();
      if (ev.type === "status") { settleLast(); steps.insertAdjacentHTML("beforeend", `<li class="muted"><span class="s">·</span>${esc(ev.message)}</li>`); }
      if (ev.type === "tool") { settleLast(); steps.insertAdjacentHTML("beforeend", `<li><span class="s"><span class="spin"></span></span>${STEP_ICON[ev.name] ?? "🔎"} ${esc(ev.label)}</li>`); }
      if (ev.type === "tool_result") settleLast(!ev.result?.error);
      if (ev.type === "result") {
        done();
        settleLast();
        buzz("MEDIUM");
        state.current = await api(`/api/disputes/${encodeURIComponent(id)}`);
        $("#analysis").innerHTML = "";
        renderRec();
        $("#rec").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (ev.type === "error") {
        done();
        settleLast(false);
        $("#analysis").insertAdjacentHTML("beforeend", `<div class="error">${esc(ev.message)}</div>`);
        renderAnalyzeButton("Try again");
      }
    };
    es.onerror = () => {
      if (finished) return;
      done();
      toast("CONNECTION LOST", "The investigation stream was interrupted.", "bad");
      renderAnalyzeButton("Try again");
    };
  }

  function renderRec() {
    const { dispute: d, recommendation: rec } = state.current;
    const v = VERDICTS[rec.verdict] ?? VERDICTS.FIGHT;
    const done = isDone(d.status);
    const cal = rec.calibration;
    const calHtml = cal ? `<div class="calib ${cal.shift <= -10 ? "down" : ""}"><small>🧠 TRACK RECORD · ${esc(cal.label)}</small>${cal.fought.n ? `${cal.fought.won} of ${cal.fought.n} similar cases won. Agent said <b>${cal.raw}%</b> → <b>${cal.calibrated}%</b>.` : "No similar cases yet, so the agent's estimate stands."}</div>` : "";
    $("#rec").innerHTML = `
      <div class="h">AI recommendation</div>
      <div class="card rec" style="--vc:${v.color}">
        <div class="rec-top">
          <div class="ring" style="--p:${Number(rec.win_likelihood) || 0}"><div><div><b>${rec.win_likelihood}%</b><span>WIN ODDS</span></div></div></div>
          <div class="grow"><div class="stamp">${v.label}</div><div class="headline">${esc(rec.headline)}</div></div>
        </div>
        <div class="keeps">💰 Keeps <b>$${esc(rec.money_saved_estimate)}</b> vs. a full refund · ${esc(rec.engine ?? "AI")}</div>
        ${calHtml}
        <div class="h" style="margin-top:14px">Why</div>
        <ul class="list">${(rec.reasoning ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        ${rec.risk_flags?.length ? `<div class="h">Risks</div><ul class="list flags">${rec.risk_flags.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        <div class="h">${rec.verdict === "FIGHT" ? "Evidence note to PayPal" : rec.verdict === "ACCEPT_CLAIM" ? "Note to PayPal" : "Message to the buyer"} (editable)</div>
        <textarea id="text" ${done ? "disabled" : ""}>${esc(rec.response_text)}</textarea>
        ${rec.verdict === "OFFER_PARTIAL_REFUND" ? `<label class="f" for="offer">Refund amount ($)</label><input id="offer" inputmode="decimal" value="${esc(rec.offer_amount ?? "")}" ${done ? "disabled" : ""}/>` : ""}
        <div style="margin-top:14px">
          ${done ? `<button class="btn go" disabled>✓ Sent</button>` : `<button class="btn go" id="approve">✓ Approve · ${v.action}</button><button class="btn alt" id="rerun">⟳ Re-run investigation</button>`}
        </div>
      </div>`;
    if (!done) {
      $("#approve").onclick = confirmApprove;
      $("#rerun").onclick = () => analyze(d.id);
    }
  }

  // ---------------- approve ----------------
  function openSheet(html) {
    $("#sheet-box").innerHTML = html;
    $("#sheet").classList.remove("hidden");
  }
  function closeSheet() {
    $("#sheet").classList.add("hidden");
    return true;
  }
  $("#sheet").onclick = (e) => { if (e.target.id === "sheet") closeSheet(); };

  function confirmApprove() {
    const { dispute: d, recommendation: rec } = state.current;
    const v = VERDICTS[rec.verdict];
    const offer = $("#offer")?.value;
    const what = {
      FIGHT: `Submit evidence to PayPal to fight this ${usd(d.amount.value)} claim.`,
      OFFER_PARTIAL_REFUND: `Offer the buyer a ${usd(offer || 0)} refund.`,
      ACCEPT_CLAIM: `Accept the claim. The buyer gets a full ${usd(d.amount.value)} refund.`,
      SEND_MESSAGE: "Send your message to the buyer. No money moves.",
    }[rec.verdict];
    openSheet(`<div class="stamp" style="--vc:${v.color};color:${v.color}">${v.label}</div>
      <h3 style="margin:6px 0 8px">${esc(v.action)}?</h3>
      <p class="muted" style="margin-top:0">${esc(what)}</p>
      <button class="btn go" id="yes">Yes, send it</button>
      <button class="btn alt" id="no">Cancel</button>`);
    $("#no").onclick = closeSheet;
    $("#yes").onclick = async () => {
      $("#yes").disabled = true;
      $("#yes").textContent = "Sending to PayPal…";
      const body = { response_text: $("#text").value };
      if (offer != null) body.offer_amount = offer;
      try {
        const out = await post(`/api/disputes/${encodeURIComponent(d.id)}/respond`, body);
        closeSheet();
        buzz("HEAVY");
        toast("✓ SENT", out.entry.simulated ? "Done (demo mode, PayPal call simulated)." : `Delivered to PayPal · ${out.entry.call}`, "good");
        state.current = await api(`/api/disputes/${encodeURIComponent(d.id)}`);
        renderDetail();
      } catch (e) {
        $("#yes").disabled = false;
        $("#yes").textContent = "Yes, send it";
        toast("NOT SENT", e.message, "bad");
      }
    };
  }

  // ---------------- PayPal ruling ----------------
  function renderRuling() {
    const el = $("#ruling");
    if (!el) return;
    const { outcome: o, pending: p, canSimulateRuling } = state.current;
    if (o) {
      const m = OUTCOMES[o.outcome];
      el.innerHTML = `<div class="card ruling done" style="--oc:${m.color}"><div class="st">⚖️ ${m.label}</div>
        <div style="margin-top:4px"><b>${m.text}.</b> You kept <b>${usd(o.kept)}</b> of ${usd(o.amount)}.</div>
        <div class="muted" style="font-size:12px;margin-top:4px">Predicted ${o.odds}% win odds · ${o.correct === null ? "nothing to check" : o.correct ? "✓ the plan worked" : "✗ the plan didn't work"} · added to the Track Record</div></div>`;
      return;
    }
    if (!p) return (el.innerHTML = "");
    el.innerHTML = `<div class="card ruling"><div class="st">⏳ AWAITING PAYPAL'S RULING</div>
      <div style="font-size:14px;margin-top:4px">Response sent (${esc(VERDICTS[p.verdict]?.label ?? p.verdict)}, predicted ${p.odds}%). The ruling is recorded to make future odds more accurate.</div>
      ${canSimulateRuling ? `<button class="btn alt" id="rule" style="margin-top:10px">⚖️ Simulate PayPal ruling</button>` : `<div class="muted" style="font-size:12px;margin-top:4px">Arrives by PayPal webhook.</div>`}</div>`;
    if (canSimulateRuling) $("#rule").onclick = async () => {
      $("#rule").disabled = true;
      $("#rule").textContent = "PayPal is reviewing…";
      try {
        await sleep(800);
        await post(`/api/disputes/${encodeURIComponent(state.current.dispute.id)}/ruling`);
        state.current = await api(`/api/disputes/${encodeURIComponent(state.current.dispute.id)}`);
        buzz("HEAVY");
        renderDetail();
      } catch (e) {
        toast("RULING FAILED", e.message, "bad");
        $("#rule").disabled = false;
      }
    };
  }

  // ---------------- track record ----------------
  async function renderTrack() {
    const main = $("#main");
    main.innerHTML = `<div class="empty"><div class="spin"></div></div>`;
    let t;
    try {
      t = await api("/api/track-record");
    } catch (e) {
      main.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`;
      return;
    }
    if (state.tab !== "track" || state.detailId) return;
    const LC = { OVERCONFIDENT: "var(--red)", UNDERCONFIDENT: "var(--amber)", STRATEGY: "var(--violet)", CALIBRATED: "var(--green)" };
    const ICON = { OVERCONFIDENT: "📉", UNDERCONFIDENT: "📈", STRATEGY: "♟️", CALIBRATED: "🎯" };
    main.innerHTML = `
      <p class="muted" style="font-size:13px;margin-top:0">Each plan is checked against PayPal's final ruling. Past results then adjust the win odds on new disputes, and Autopilot uses those odds.</p>
      <div class="tiles">
        <div class="stat" style="--accent:var(--cyan)"><b>${t.resolved}</b><span>RESOLVED CASES</span></div>
        <div class="stat" style="--accent:var(--green)"><b>${t.planSuccess}%</b><span>PLANS THAT WORKED</span></div>
        <div class="stat" style="--accent:var(--amber)"><b>${t.fightWinRate}%</b><span>FIGHT WIN RATE</span></div>
        <div class="stat" style="--accent:var(--violet)"><b>−${Math.max(0, t.brier.improvement)}%</b><span>PREDICTION ERROR</span></div>
      </div>
      <div class="h">What the agent learned</div>
      ${t.lessons.map((l) => `<div class="lesson" style="--lc:${LC[l.kind]}"><span>${ICON[l.kind]}</span><div>${esc(l.text)}</div></div>`).join("") || `<p class="muted">Not enough resolved cases yet.</p>`}
      <div class="h">Predicted vs. actually won</div>
      <div class="card"><div class="legend"><span><i style="background:#d95926"></i>Agent predicted</span><span><i style="background:var(--ink)"></i>Actually won</span></div>
        <div class="bars">${t.patterns.filter((p) => p.fought).map((p) => `<div class="b"><div class="row"><span class="grow">${esc(p.label)}</span><span class="mono muted">${p.avgPredicted}% → ${p.actual}%</span></div>
          <div class="t"><span class="p" style="left:${p.avgPredicted}%"></span><span class="a" style="left:${p.actual}%"></span></div></div>`).join("")}</div></div>
      ${t.pending.length ? `<div class="h">Awaiting ruling</div>${t.pending.map((p) => `<button class="dcard" data-id="${esc(p.disputeId)}"><div class="grow"><div class="item" style="margin-top:0">${esc(p.item ?? p.disputeId)}</div><div class="sub">${esc(VERDICTS[p.verdict]?.label ?? p.verdict)} · predicted ${p.odds}% · ${usd(p.amount)}</div></div><span class="chev">›</span></button>`).join("")}` : ""}`;
    main.querySelectorAll(".dcard").forEach((b) => (b.onclick = () => { setTab("home"); openDispute(b.dataset.id); }));
  }

  // ---------------- settings ----------------
  function renderSettings() {
    const c = state.config;
    $("#main").innerHTML = `
      <div class="h" style="margin-top:4px">Mode</div>
      ${offlineCard()}
      ${serverForm()}
      ${c ? `<div class="card" style="font-size:14px;line-height:1.7">
        <div class="row"><span class="grow muted">Running</span><b>${isOffline() ? "Offline, on this phone" : "Your server"}</b></div>
        <div class="row"><span class="grow muted">PayPal</span><b>${c.paypalMode === "sandbox" ? "Sandbox (live API)" : "Demo data"}</b></div>
        <div class="row"><span class="grow muted">AI engine</span><b>${esc(c.aiMode === "claude" ? c.model : "Scripted demo")}</b></div>
        <div class="row"><span class="grow muted">Webhooks</span><b>${c.webhooks ? "On" : "Off"}</b></div>
      </div>` : ""}
      <div class="h">Alerts</div>
      <div class="card" style="font-size:14px;line-height:1.5">
        You get an alert when a dispute arrives, when Autopilot needs your approval, and when PayPal rules. Alerts arrive while the app is open or in the background. They stop when Android closes the app.
        ${native ? `<button class="btn alt" id="perm" style="margin-top:10px">Allow notifications</button>` : ""}
      </div>
      <p class="muted" style="text-align:center;font-size:12px">Dispute Defender companion v1.0 · nothing is sent to PayPal without your approval</p>`;
    bindOffline();
    bindServerForm();
    $("#srv-save").textContent = state.server && !isOffline() ? "Save & reconnect" : "Connect";
    if ($("#perm")) $("#perm").onclick = async () => {
      const r = await Plugins.LocalNotifications.requestPermissions().catch(() => ({ display: "denied" }));
      toast(r.display === "granted" ? "✓ ALERTS ON" : "ALERTS BLOCKED", r.display === "granted" ? "You'll be alerted about new disputes and rulings." : "Turn them on in Android Settings → Apps → Dispute Defender.", r.display === "granted" ? "good" : "warn");
    };
  }

  // ---------------- live events ----------------
  function connectEvents() {
    state.events?.close();
    if (!state.server) return;
    const es = openStream("/api/events");
    state.events = es;
    es.onopen = () => setConn(true);
    es.onerror = () => setConn(false); // EventSource reconnects by itself
    es.onmessage = async (e) => {
      const ev = JSON.parse(e.data);
      const id = ev.disputeId ?? ev.entry?.disputeId ?? ev.dispute?.id;
      switch (ev.type) {
        case "dispute_new":
          state.fresh.add(ev.dispute.id);
          setTimeout(() => state.fresh.delete(ev.dispute.id), 5000);
          notify("🚨 New dispute", `${ev.dispute.buyerName}: ${ev.dispute.item} · ${usd(ev.dispute.amount.value)}`, id);
          break;
        case "needs_approval":
          if (ev.verdict) notify("✋ Needs your approval", `${id}: ${ev.reason}`, id);
          break;
        case "action":
          if (ev.entry.source === "AUTOPILOT") notify(`🤖 Autopilot · ${VERDICTS[ev.entry.verdict]?.label}`, `${id}: ${ev.entry.rule}`, id);
          break;
        case "dispute_update": {
          const who = { BUYER: "Buyer", SELLER: "You" }[ev.message?.by] ?? "PayPal";
          if (ev.message?.by !== "SELLER") notify(`📬 Case updated · ${id}`, ev.message ? `${who}: ${ev.message.content}` : `Status: ${ev.status.replaceAll("_", " ")}`, id);
          break;
        }
        case "outcome":
          notify(`⚖️ PayPal ruled · ${OUTCOMES[ev.entry.outcome].label}`, `${ev.entry.item ?? id}: kept ${usd(ev.entry.kept)} (predicted ${ev.entry.odds}%)`, id);
          break;
        default:
          return;
      }
      if (state.tab === "home" && !state.detailId) renderHome();
      if (state.detailId && state.detailId === id && !state.analyzing) {
        state.current = await api(`/api/disputes/${encodeURIComponent(id)}`).catch(() => state.current);
        renderDetail();
      }
    };
  }

  // Tapping a notification opens that dispute.
  Plugins.LocalNotifications?.addListener?.("localNotificationActionPerformed", (a) => {
    const id = a.notification?.extra?.disputeId;
    if (id) { setTab("home"); openDispute(id); }
  });
  // Coming back to the app: refresh what's on screen.
  Plugins.App?.addListener?.("resume", () => { if (state.server && !state.detailId && state.tab !== "settings") render(); });

  // ---------------- start ----------------
  (async () => {
    if (native) Plugins.LocalNotifications?.requestPermissions?.().catch(() => {});
    // Hosted on GitHub Pages there is no server to connect to: open the in-browser demo straight away.
    if (!state.server && !native && location.hostname.endsWith("github.io")) state.server = OFFLINE;
    if (isOffline()) await loadEngine().catch(() => { state.server = ""; });
    if (state.server) {
      api("/api/config", { timeout: 8000 }).then((c) => { state.config = c; setConn(true); }).catch(() => setConn(false));
      connectEvents();
    }
    render();
  })();
})();
