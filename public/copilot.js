// Defender Copilot UI: chat + voice.
// "Talk" mode is hands-free: it listens, answers out loud, then listens again until you stop it.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const panel = $("#copilot");
const log = $("#cp-log");
const wave = $("#cp-wave");
const history = [];
let speak = localStorage.getItem("dd-cp-speak") !== "off";
let busy = false;
let talkMode = false; // hands-free conversation

const CHIPS = ["Brief me", "What should I do first?", "Triage everything", "Tell me about the headphones", "Negotiate with Priya", "Show me Risk Radar", "What have you learned?"];
$("#cp-chips").innerHTML = CHIPS.map((c) => `<button class="chip">${esc(c)}</button>`).join("");
document.querySelectorAll(".chip").forEach((b) => (b.onclick = () => send(b.textContent)));

function setWave(mode) {
  wave.className = `cp-wave ${mode ?? ""}`;
  panel.dataset.mode = mode ?? "";
  const label = { listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…" }[mode];
  $("#cp-status").textContent = label ?? (talkMode ? "Your turn, just talk" : "");
}

const actionLabel = (a) =>
  ({ open_dispute: "opened the case", analyze: "investigating", negotiate: "opened negotiation", view: `showing ${a.view}`, autopilot: `autopilot ${a.enabled ? "on" : "off"}`, simulate: "simulating a dispute", triage: "triaging every dispute" })[a.type] ?? a.type;

function addMsg(role, text, acts = []) {
  const div = document.createElement("div");
  div.className = `cp-msg ${role}`;
  div.textContent = text;
  if (acts.length) div.insertAdjacentHTML("beforeend", `<div class="acts">⚡ ${acts.map(actionLabel).map(esc).join(" · ")}</div>`);
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

// Assistant replies type out word by word, roughly at speaking pace.
function typeMsg(text, acts = []) {
  const div = addMsg("assistant", "");
  const words = text.split(/(\s+)/);
  let i = 0;
  const step = () => {
    i += 2;
    div.textContent = words.slice(0, i).join("");
    log.scrollTop = log.scrollHeight;
    if (i < words.length) setTimeout(step, speak ? 140 : 25);
    else if (acts.length) div.insertAdjacentHTML("beforeend", `<div class="acts">⚡ ${acts.map(actionLabel).map(esc).join(" · ")}</div>`);
  };
  step();
}

function typing(on) {
  $("#cp-typing")?.remove();
  if (on) { log.insertAdjacentHTML("beforeend", `<div class="cp-msg assistant cp-typing" id="cp-typing"><i></i><i></i><i></i></div>`); log.scrollTop = log.scrollHeight; }
}

function open() {
  panel.classList.remove("hidden");
  $("#copilot-orb").classList.add("hidden");
  if (!log.children.length) addMsg("assistant", "Hi, I'm Defender. Ask me anything about your disputes, or tap Talk and just speak.");
  setTimeout(() => $("#cp-text").focus(), 50);
}
function close() {
  panel.classList.add("hidden");
  $("#copilot-orb").classList.remove("hidden");
  stopTalk();
  speechSynthesis.cancel();
}

// ---- speech out: pick the most natural voice the browser has ----
let voices = [];
let voice = null;
function rank(v) {
  let s = 0;
  if (/natural|neural|online/i.test(v.name)) s += 6; // Edge's neural voices sound close to human
  if (/google/i.test(v.name)) s += 3;
  if (/ava|andrew|emma|brian|jenny|aria|guy|samantha|libby|sonia|natasha/i.test(v.name)) s += 2;
  if (v.lang === "en-US") s += 1;
  if (/espeak|robot|zira|david|mark/i.test(v.name)) s -= 3;
  return s;
}
function loadVoices() {
  voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en")).sort((a, b) => rank(b) - rank(a));
  const saved = localStorage.getItem("dd-cp-voice");
  voice = voices.find((v) => v.name === saved) ?? voices[0] ?? null;
  const sel = $("#cp-voices");
  if (sel) sel.innerHTML = voices.slice(0, 12).map((v) => `<option ${v === voice ? "selected" : ""}>${esc(v.name.replace(/^Microsoft /, "").replace(/ - English.*$/, ""))}</option>`).join("");
}
if ("speechSynthesis" in window) { speechSynthesis.onvoiceschanged = loadVoices; loadVoices(); }
$("#cp-voices").onchange = (e) => {
  voice = voices[e.target.selectedIndex] ?? voice;
  localStorage.setItem("dd-cp-voice", voice?.name ?? "");
  say("Hi! This is how I sound now.");
};

// Speak sentence by sentence: more natural pauses, and long replies don't get cut off.
function say(text) {
  return new Promise((resolve) => {
    if (!speak || !("speechSynthesis" in window)) return resolve();
    speechSynthesis.cancel();
    const clean = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\$(\d+)\.00\b/g, "$$$1");
    const parts = clean.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean];
    let left = parts.length;
    setWave("speaking");
    // Some browsers never fire "end"; don't wait forever.
    const words = clean.split(/s+/).length;
    const guard = setTimeout(() => { left = 0; setWave(""); resolve(); }, 2500 + words * 450);
    for (const p of parts) {
      const u = new SpeechSynthesisUtterance(p);
      if (voice) u.voice = voice;
      u.rate = /natural|neural|online/i.test(voice?.name ?? "") ? 1.02 : 0.97;
      u.pitch = 1;
      u.onend = u.onerror = () => { if (--left === 0) { clearTimeout(guard); setWave(""); resolve(); } };
      speechSynthesis.speak(u);
    }
  });
}
function setSpeak(on) {
  speak = on;
  localStorage.setItem("dd-cp-speak", on ? "on" : "off");
  $("#cp-voice").classList.toggle("off", !on);
  $("#cp-voice").textContent = on ? "🔊" : "🔇";
  if (!on) speechSynthesis.cancel();
}
setSpeak(speak);
$("#cp-voice").onclick = () => setSpeak(!speak);

// ---- speech in ----
// One recognizer at a time. It stays open while you talk, and a short pause means you're done.
// Events from an old recognizer are ignored (that was what kept switching the mic off).
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let session = 0;
let idleTimer = null;
let giveUpTimer = null;

function micOn(on) {
  $("#cp-talk").classList.toggle("hearing", on);
  if (on) setWave("listening");
  else if (panel.dataset.mode === "listening") setWave("");
}
function resetGiveUp() {
  clearTimeout(giveUpTimer);
  // Nobody has spoken for a while: stop listening rather than keep the mic open forever.
  giveUpTimer = setTimeout(() => { if (talkMode && !busy && panel.dataset.mode === "listening") { stopTalk(); addMsg("assistant", "I'll stop listening for now. Tap Talk when you need me."); } }, 45000);
}

function listen() {
  if (!SR) { addMsg("assistant", "Voice input needs Chrome or Edge. You can still type to me."); stopTalk(); return; }
  if (busy || !talkMode) return;
  speechSynthesis.cancel();
  const id = ++session;
  try { rec?.abort(); } catch {}
  const r = new SR();
  rec = r;
  r.lang = "en-US";
  r.continuous = true;
  r.interimResults = true;
  let finalText = "";
  $("#cp-text").value = "";
  const finish = () => {
    if (id !== session) return;
    clearTimeout(idleTimer);
    const text = $("#cp-text").value.trim();
    session++; // retire this recognizer before stopping it
    try { r.stop(); } catch {}
    micOn(false);
    if (text) send(text);
    else if (talkMode) setTimeout(listen, 150);
  };
  r.onresult = (e) => {
    if (id !== session) return;
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript + " ";
      else interim += e.results[i][0].transcript;
    }
    $("#cp-text").value = (finalText + interim).trim();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(finish, interim ? 1500 : 800);
    resetGiveUp();
  };
  r.onerror = (e) => {
    if (id !== session) return;
    const msg = {
      "not-allowed": "I can't hear you yet. Click the lock or mic icon in the address bar, allow the microphone, then tap Talk again.",
      "service-not-allowed": "This browser blocked voice input. Try Chrome or Edge.",
      "audio-capture": "I can't find a microphone. Check it's plugged in and not being used by another app.",
      network: "The speech service didn't answer. Voice input needs an internet connection.",
    }[e.error];
    if (msg) { session++; addMsg("assistant", msg); stopTalk(); }
    // "no-speech" and "aborted" are normal: onend restarts listening.
  };
  r.onend = () => {
    if (id !== session) return;
    // The browser stopped by itself (silence or its time limit).
    if ($("#cp-text").value.trim()) finish();
    else setTimeout(() => { if (id === session && talkMode && !busy) listen(); }, 150);
  };
  try { r.start(); } catch { setTimeout(() => id === session && listen(), 300); return; }
  micOn(true);
}
function startTalk() {
  talkMode = true;
  $("#cp-talk").classList.add("on");
  $("#cp-talk").innerHTML = "■ Stop";
  if (!speak) setSpeak(true);
  resetGiveUp();
  listen();
}
function stopTalk() {
  talkMode = false;
  session++;
  clearTimeout(idleTimer); clearTimeout(giveUpTimer);
  try { rec?.abort(); } catch {}
  $("#cp-talk").classList.remove("on", "hearing");
  $("#cp-talk").innerHTML = "🎙️ Talk";
  setWave("");
}
$("#cp-talk").onclick = () => (talkMode ? stopTalk() : startTalk());
// Tap the wave to interrupt while it's speaking.
wave.onclick = () => { if (panel.dataset.mode === "speaking") { speechSynthesis.cancel(); setWave(""); if (talkMode) setTimeout(listen, 100); } };

// ---- talk to the server ----
async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  $("#cp-text").value = "";
  addMsg("user", text);
  history.push({ role: "user", text });
  setWave("thinking");
  typing(true);
  let actions = [];
  try {
    const [res] = await Promise.all([
      fetch("/api/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ history }) }),
      new Promise((r) => setTimeout(r, 450)), // a beat before answering feels less robotic
    ]);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    actions = data.actions ?? [];
    history.push({ role: "assistant", text: data.reply });
    typing(false);
    typeMsg(data.reply, actions);
    const spoken = say(data.reply);
    // Full-screen moments (investigation, negotiation, triage) start after the reply is heard.
    const big = actions.some((a) => ["analyze", "negotiate", "triage"].includes(a.type));
    if (big) { await spoken; stopTalk(); await runActions(actions); close(); busy = false; return; }
    await runActions(actions);
    await spoken;
  } catch (err) {
    typing(false);
    addMsg("assistant", `Sorry, something went wrong: ${err.message}`);
  }
  setWave("");
  busy = false;
  if (talkMode && !panel.classList.contains("hidden")) { resetGiveUp(); setTimeout(listen, 250); }
}

async function runActions(actions = []) {
  const DD = window.DD;
  for (const a of actions) {
    if (a.type === "view") DD.showView(a.view);
    if (a.type === "open_dispute") await DD.open(a.id);
    if (a.type === "analyze") await DD.investigate(a.id);
    if (a.type === "negotiate") await DD.negotiate(a.id);
    if (a.type === "autopilot") await DD.saveRules({ enabled: a.enabled });
    if (a.type === "simulate") await DD.simulate();
    if (a.type === "triage") DD.triage();
  }
}

$("#cp-form").onsubmit = (e) => { e.preventDefault(); send($("#cp-text").value); };
$("#copilot-orb").onclick = open;
$("#cp-close").onclick = close;
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); panel.classList.contains("hidden") ? open() : close(); }
  if (e.key === "Escape" && !panel.classList.contains("hidden")) close();
});
