// Defender Copilot UI: chat + voice (speech recognition in, speech synthesis out).
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const panel = $("#copilot");
const log = $("#cp-log");
const wave = $("#cp-wave");
const history = [];
let speak = true;
let busy = false;

const CHIPS = ["Brief me", "What's due soon?", "Fight the headphones dispute", "Negotiate with Priya", "Show me Risk Radar", "Why am I losing money?", "Turn on Autopilot"];
$("#cp-chips").innerHTML = CHIPS.map((c) => `<button class="chip">${esc(c)}</button>`).join("");
document.querySelectorAll(".chip").forEach((b) => (b.onclick = () => send(b.textContent)));

function setWave(mode) { wave.className = `cp-wave ${mode ?? ""}`; }

function addMsg(role, text, acts = []) {
  const div = document.createElement("div");
  div.className = `cp-msg ${role}`;
  div.innerHTML = esc(text) + (acts.length ? `<div class="acts">⚡ ${acts.map(actionLabel).map(esc).join(" · ")}</div>` : "");
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

const actionLabel = (a) =>
  ({ open_dispute: `opened ${a.id}`, analyze: `investigating ${a.id}`, negotiate: `negotiation for ${a.id}`, view: `showing ${a.view}`, autopilot: `autopilot ${a.enabled ? "on" : "off"}`, simulate: "simulating a dispute" })[a.type] ?? a.type;

function open() {
  panel.classList.remove("hidden");
  $("#copilot-orb").classList.add("hidden");
  if (!log.children.length) addMsg("assistant", "Hi, I'm Defender. Ask me about your disputes, or tell me what to do. Try “brief me”.");
  setTimeout(() => $("#cp-text").focus(), 50);
}
function close() {
  panel.classList.add("hidden");
  $("#copilot-orb").classList.remove("hidden");
  speechSynthesis.cancel();
  stopListening();
}

// ---- speech out ----
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  voice = vs.find((v) => /natural|neural/i.test(v.name) && /aria|jenny|guy|ava|andrew|emma/i.test(v.name)) ?? vs.find((v) => /natural|neural|google/i.test(v.name)) ?? vs[0] ?? null;
}
speechSynthesis.onvoiceschanged = pickVoice;
pickVoice();
function say(text) {
  if (!speak || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\$(\d+)\.00\b/g, "$$$1"));
  if (voice) u.voice = voice;
  u.rate = 1.05;
  u.onstart = () => setWave("speaking");
  u.onend = () => setWave("");
  speechSynthesis.speak(u);
}
$("#cp-voice").onclick = () => {
  speak = !speak;
  $("#cp-voice").classList.toggle("off", !speak);
  $("#cp-voice").textContent = speak ? "🔊" : "🔇";
  if (!speak) speechSynthesis.cancel();
};

// ---- speech in ----
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function stopListening() { try { rec?.stop(); } catch {} $("#cp-mic").classList.remove("on"); if (wave.classList.contains("listening")) setWave(""); }
$("#cp-mic").onclick = () => {
  if (!SR) { addMsg("assistant", "Voice input isn't supported in this browser. Try Chrome or Edge, or just type."); return; }
  if ($("#cp-mic").classList.contains("on")) return stopListening();
  speechSynthesis.cancel();
  rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.onresult = (e) => {
    const r = e.results[e.results.length - 1];
    $("#cp-text").value = r[0].transcript;
    if (r.isFinal) { stopListening(); send(r[0].transcript); }
  };
  rec.onerror = () => stopListening();
  rec.onend = () => stopListening();
  rec.start();
  $("#cp-mic").classList.add("on");
  setWave("listening");
};

// ---- talk to the server ----
async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  $("#cp-text").value = "";
  addMsg("user", text);
  history.push({ role: "user", text });
  setWave("thinking");
  try {
    const res = await fetch("/api/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ history }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    history.push({ role: "assistant", text: data.reply });
    addMsg("assistant", data.reply, data.actions);
    setWave("");
    say(data.reply);
    await runActions(data.actions);
  } catch (err) {
    setWave("");
    addMsg("assistant", `Something went wrong: ${err.message}`);
  }
  busy = false;
}

async function runActions(actions = []) {
  const DD = window.DD;
  for (const a of actions) {
    if (a.type === "view") DD.showView(a.view);
    if (a.type === "open_dispute") await DD.open(a.id);
    if (a.type === "analyze") await DD.investigate(a.id);
    if (a.type === "negotiate") await DD.negotiate(a.id);
    if (a.type === "autopilot") { await DD.saveRules({ enabled: a.enabled }); }
    if (a.type === "simulate") await DD.simulate();
  }
  // Big full-screen moments (investigation, negotiation) take over; tuck the panel away.
  if (actions.some((a) => ["analyze", "negotiate"].includes(a.type))) close();
}

$("#cp-form").onsubmit = (e) => { e.preventDefault(); send($("#cp-text").value); };
$("#copilot-orb").onclick = open;
$("#cp-close").onclick = close;
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); panel.classList.contains("hidden") ? open() : close(); }
  if (e.key === "Escape" && !panel.classList.contains("hidden")) close();
});
