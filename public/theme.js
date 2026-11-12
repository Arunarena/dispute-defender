// Theme switcher: five looks, remembered between visits. Press T to cycle.
// Loaded in <head> (not a module) so the saved theme applies before the first paint.
(function () {
  const THEMES = [
    { id: "neon", name: "Neon Cyber", sw: ["#00e5ff", "#ff3df2", "#2bffb1"], meta: "#05080f" },
    { id: "paypal", name: "PayPal Midnight", sw: ["#0070e0", "#3aa0ff", "#ffc439"], meta: "#060a22" },
    { id: "claude", name: "Claude Sunset", sw: ["#e8875f", "#f4c095", "#f5efe6"], meta: "#16110f" },
    { id: "aurora", name: "Aurora Glass", sw: ["#2de2e6", "#a78bfa", "#f472b6"], meta: "#05050e" },
    { id: "vault", name: "Vault", sw: ["#0b0b0b", "#d4af37", "#f0d78c"], meta: "#090909" },
    { id: "light", name: "Daylight", sw: ["#ffffff", "#0070e0", "#0e9f6e"], meta: "#f2f5fb" },
    { id: "kawaii", name: "Kawaii Bow 🎀", sw: ["#ff4f9a", "#ffffff", "#e8344e"], meta: "#ffe4ef" },
  ];
  const KEY = "dd-theme";
  const root = document.documentElement;
  const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
  const valid = (id) => THEMES.some((t) => t.id === id);

  function set(id) {
    root.dataset.theme = id;
    const t = THEMES.find((x) => x.id === id);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.meta);
    try { localStorage.setItem(KEY, id); } catch {}
    document.querySelectorAll(".theme-opt").forEach((b) => b.classList.toggle("on", b.dataset.pick === id));
    kawaii(id === "kawaii");
  }

  // ---------- Kawaii extras: rounded fonts, floating sweets, click hearts, Mochi ----------
  const SWEETS = ["🎀", "💖", "🌸", "⭐", "🍓", "✨", "💗", "🍬"];
  const SAYINGS = ["You've got this! 💖", "Another win? Yay! 🎀", "Mochi checked the tracking ✨", "Sweet, no refund! 🍓", "Purr-fect evidence 🐾"];
  let kwOn = false, kwLayer = null, kwMochi = null;
  function pop(x, y, n = 7) {
    for (let i = 0; i < n; i++) {
      const p = document.createElement("span");
      p.className = "kw-pop";
      p.textContent = SWEETS[(Math.random() * SWEETS.length) | 0];
      const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 60;
      p.style.cssText = `left:${x}px;top:${y}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 20}px;--r:${(Math.random() - 0.5) * 90}deg;font-size:${12 + Math.random() * 12}px`;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 950);
    }
  }
  function peek(text, ms = 2800) {
    if (!kwMochi) return;
    kwMochi.querySelector(".kw-say").textContent = text ?? SAYINGS[(Math.random() * SAYINGS.length) | 0];
    kwMochi.classList.add("peek");
    clearTimeout(peek.t);
    peek.t = setTimeout(() => kwMochi?.classList.remove("peek"), ms);
  }
  const onClick = (e) => { if (kwOn && e.isPrimary !== false) pop(e.clientX, e.clientY); };
  function kawaii(on) {
    if (!document.body) { if (on) document.addEventListener("DOMContentLoaded", () => kawaii(root.dataset.theme === "kawaii"), { once: true }); return; }
    if (on === kwOn) return;
    kwOn = on;
    if (!on) {
      kwLayer?.remove(); kwMochi?.remove(); kwLayer = kwMochi = null;
      document.removeEventListener("pointerdown", onClick);
      return;
    }
    if (!document.getElementById("kw-fonts")) {
      const l = document.createElement("link");
      l.id = "kw-fonts"; l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;800&family=Nunito:wght@400;600;800&display=swap";
      document.head.appendChild(l);
    }
    kwLayer = document.createElement("div");
    kwLayer.className = "kw-layer";
    kwLayer.innerHTML = Array.from({ length: 16 }, (_, i) => `<span class="kw-float" style="left:${(i * 6.3 + Math.random() * 4) % 100}%;--s:${14 + Math.random() * 16}px;--d:${16 + Math.random() * 14}s;--delay:${-Math.random() * 28}s">${SWEETS[i % SWEETS.length]}</span>`).join("");
    document.body.appendChild(kwLayer);
    // Same folder as the favicon, so it works both locally and on GitHub Pages.
    const base = (document.querySelector("link[rel=icon]")?.getAttribute("href") ?? "/img/shield.svg").replace(/shield\.svg$/, "");
    kwMochi = document.createElement("div");
    kwMochi.className = "kw-mochi";
    kwMochi.innerHTML = `<div class="kw-say"></div><img src="${base}mochi.svg" alt="Mochi" />`;
    kwMochi.onclick = (e) => { pop(e.clientX, e.clientY, 12); peek(); };
    document.body.appendChild(kwMochi);
    document.addEventListener("pointerdown", onClick);
    setTimeout(() => peek("Hi! I'm Mochi 🎀"), 500);
  }
  window.DDTheme = { isKawaii: () => kwOn, pop, peek };
  set(valid(saved) ? saved : "neon");

  // Switch with a circular reveal that grows from (x, y).
  function switchTo(id, x, y) {
    if (id === root.dataset.theme) return;
    root.style.setProperty("--tx", `${x ?? innerWidth / 2}px`);
    root.style.setProperty("--ty", `${y ?? 0}px`);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (document.startViewTransition && !reduce) document.startViewTransition(() => set(id));
    else set(id);
    // Some panels draw colors once (e.g. the matrix rain); let them refresh.
    window.dispatchEvent(new CustomEvent("themechange", { detail: id }));
  }

  function mount() {
    const brand = document.querySelector(".brand");
    if (!brand || document.querySelector(".theme-pick")) return;
    const wrap = document.createElement("div");
    wrap.className = "theme-pick";
    wrap.innerHTML = `<button class="theme-btn" type="button" title="Change theme (T)" aria-label="Change theme" aria-haspopup="true"></button>
      <div class="theme-menu hidden" role="menu">
        ${THEMES.map((t, i) => `<button class="theme-opt" role="menuitem" data-pick="${t.id}"><span class="sw">${t.sw.map((c) => `<i style="background:${c}"></i>`).join("")}</span><b>${t.name}</b><kbd>${i + 1}</kbd></button>`).join("")}
        <div class="theme-hint">Press T to cycle themes</div>
      </div>`;
    brand.appendChild(wrap);
    const btn = wrap.querySelector(".theme-btn"), menu = wrap.querySelector(".theme-menu");
    btn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle("hidden"); };
    menu.onclick = (e) => {
      const opt = e.target.closest(".theme-opt");
      if (!opt) return;
      const r = btn.getBoundingClientRect();
      switchTo(opt.dataset.pick, r.left + r.width / 2, r.top + r.height / 2);
      menu.classList.add("hidden");
    };
    document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) menu.classList.add("hidden"); });
    set(root.dataset.theme);
  }

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
    const r = document.querySelector(".theme-btn")?.getBoundingClientRect();
    const at = r ? [r.left + r.width / 2, r.top + r.height / 2] : [];
    if (e.key === "t" || e.key === "T") {
      const i = THEMES.findIndex((t) => t.id === root.dataset.theme);
      switchTo(THEMES[(i + 1) % THEMES.length].id, ...at);
    } else if (/^[1-7]$/.test(e.key) && document.querySelector(".theme-menu:not(.hidden)")) {
      switchTo(THEMES[+e.key - 1].id, ...at);
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
