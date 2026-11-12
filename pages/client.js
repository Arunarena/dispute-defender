// GitHub Pages demo: runs the real server (backend.js, bundled from src/server.js) inside the page.
// Loaded before the app's own scripts. It sends the page's /api requests and event streams to that
// in-page server, and points root paths (/img/…, /api/…pdf, /uploads/…) at the right place.
(() => {
  window.DD_STATIC_DEMO = true;
  const BASE = location.pathname.replace(/[^/]*$/, ""); // e.g. /dispute-defender/
  const here = location.pathname.slice(BASE.length) || "index.html";
  // The buyer's tap page and the demo shop open in their own tabs: they ask the dashboard tab's server first,
  // so a tap or a shop order shows up there.
  const RELAY_FIRST = here === "tap.html" || here === "shop.html";
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("dd-static-demo") : null;

  let backendPromise = null;
  const backend = () =>
    (backendPromise ??= import(new URL("backend.js", document.baseURI).href).then(async (b) => {
      await b.preload(window.DD_SAMPLES ?? []).catch(() => {});
      if (!RELAY_FIRST && channel) serveRelay(b);
      return b;
    }));

  // Dashboard and shop/tap tabs find each other: the dashboard says "hello" when its server is
  // ready (and whenever asked), so a shop opened first, or before the dashboard finished loading,
  // still sends its orders there.
  if (channel && RELAY_FIRST) {
    channel.addEventListener("message", (e) => { if (e.data?.kind === "hello") relayWorks = true; });
    channel.postMessage({ kind: "ping" });
  }
  // The shop's "See it in Risk Radar" asks the dashboard tab to switch views.
  window.DD_SHOW_DASHBOARD = (view) => channel?.postMessage({ kind: "show", view });

  // "/api/x?y" for requests to this demo's API, otherwise null.
  function apiPath(raw) {
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin) return null;
    let p = url.pathname;
    if (BASE !== "/" && p.startsWith(BASE)) p = "/" + p.slice(BASE.length);
    return p.startsWith("/api/") ? p + url.search : null;
  }

  const headersObj = (h) => (h instanceof Headers ? Object.fromEntries(h) : Array.isArray(h) ? Object.fromEntries(h) : { ...(h ?? {}) });

  // Runs one request on the in-page server and collects the whole answer.
  function runLocal(b, req) {
    return new Promise((resolve) => {
      let status = 200;
      let headers = {};
      const chunks = [];
      b.handle(req, {
        head(s, h) {
          status = s;
          headers = h;
        },
        data: (c) => chunks.push(c),
        end: () => resolve({ status, headers, body: new Blob(chunks) }),
      });
    });
  }

  // The tap page: ask an open dashboard tab, or fall back to a server of its own.
  let relayWorks = RELAY_FIRST && channel;
  function viaRelay(req) {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        channel.removeEventListener("message", onMsg);
        reject(new Error("no dashboard tab"));
      }, 900);
      function onMsg(e) {
        if (e.data?.kind !== "res" || e.data.id !== id) return;
        clearTimeout(timer);
        channel.removeEventListener("message", onMsg);
        resolve({ status: e.data.status, headers: e.data.headers, body: new Blob([e.data.body]) });
      }
      channel.addEventListener("message", onMsg);
      channel.postMessage({ kind: "req", id, req });
    });
  }
  function serveRelay(b) {
    channel.postMessage({ kind: "hello" });
    channel.addEventListener("message", async (e) => {
      if (e.data?.kind === "ping") return channel.postMessage({ kind: "hello" });
      if (e.data?.kind === "show") return window.DD?.showView?.(e.data.view);
      if (e.data?.kind !== "req") return;
      const r = await runLocal(b, e.data.req);
      channel.postMessage({ kind: "res", id: e.data.id, status: r.status, headers: r.headers, body: await r.body.text() });
    });
  }

  async function call(req) {
    let r = null;
    // Anything that changes data (like placing an order) always tries the dashboard tab first,
    // even if an earlier attempt found none: it may have opened since.
    if (channel && RELAY_FIRST && (relayWorks || req.method !== "GET")) r = await viaRelay(req).then((x) => ((relayWorks = true), x), () => ((relayWorks = false), null));
    if (RELAY_FIRST && req.method !== "GET") window.DD_RELAYED = !!r;
    r ??= await runLocal(await backend(), req);
    const noBody = [204, 304].includes(r.status);
    return new Response(noBody ? null : r.body, { status: r.status, headers: r.headers });
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const path = apiPath(raw);
    if (!path) return realFetch(input, init);
    let body = init.body;
    if (body != null && typeof body !== "string") body = await new Response(body).text();
    return call({ method: (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(), url: path, headers: headersObj(init.headers), body });
  };

  // Server-sent events from the in-page server.
  const RealEventSource = window.EventSource;
  class LocalEventSource extends EventTarget {
    constructor(url) {
      const path = apiPath(url);
      if (!path) return new RealEventSource(url);
      super();
      Object.assign(this, { url: String(url), readyState: 0, onmessage: null, onerror: null, onopen: null, withCredentials: false });
      let buf = "";
      backend().then((b) => {
        if (this.readyState === 2) return;
        this._stop = b.handle({ method: "GET", url: path, headers: { accept: "text/event-stream" } }, {
          head: () => {
            this.readyState = 1;
            this._fire(new Event("open"));
          },
          data: (c) => {
            buf += typeof c === "string" ? c : new TextDecoder().decode(c);
            let i;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
              if (data) this._fire(new MessageEvent("message", { data }));
            }
          },
          end: () => {
            this.readyState = 2;
          },
        });
      });
    }
    _fire(ev) {
      this.dispatchEvent(ev);
      this["on" + ev.type]?.(ev);
    }
    close() {
      this.readyState = 2;
      this._stop?.();
    }
  }
  LocalEventSource.CONNECTING = 0;
  LocalEventSource.OPEN = 1;
  LocalEventSource.CLOSED = 2;
  window.EventSource = LocalEventSource;

  // Root paths in the app's HTML: static files live under BASE; /api and /uploads come from the in-page server.
  const blobs = new Map();
  async function blobUrl(path) {
    if (!blobs.has(path))
      blobs.set(
        path,
        (async () => {
          if (path.startsWith("/uploads/")) {
            const bytes = (await backend()).readUpload(path);
            return bytes ? URL.createObjectURL(new Blob([bytes], { type: /\.png$/.test(path) ? "image/png" : "image/jpeg" })) : "";
          }
          return URL.createObjectURL(await (await window.fetch(path)).blob());
        })(),
      );
    return blobs.get(path);
  }
  function fix(el, attr) {
    const v = el.getAttribute(attr);
    if (!v || !v.startsWith("/") || v.startsWith("//") || (BASE !== "/" && v.startsWith(BASE))) return;
    if (v.startsWith("/api/") || v.startsWith("/uploads/")) {
      const [path, hash] = v.split("#");
      el.setAttribute(attr, "about:blank");
      blobUrl(path).then((u) => u && el.setAttribute(attr, hash ? `${u}#${hash}` : u));
    } else {
      el.setAttribute(attr, BASE + v.slice(1));
    }
  }
  const scan = (root) => {
    if (root.nodeType !== 1) return;
    for (const el of [root, ...root.querySelectorAll("[src],[href]")]) {
      if (el.hasAttribute?.("src")) fix(el, "src");
      if (el.hasAttribute?.("href")) fix(el, "href");
    }
  };
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "attributes") fix(m.target, m.attributeName);
      else m.addedNodes.forEach(scan);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "href"] });

  // The dashboard starts its server straight away so the first screen loads fast.
  if (!RELAY_FIRST) backend();
})();
