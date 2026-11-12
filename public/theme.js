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
  }
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
    } else if (/^[1-6]$/.test(e.key) && document.querySelector(".theme-menu:not(.hidden)")) {
      switchTo(THEMES[+e.key - 1].id, ...at);
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
