// A tiny Express stand-in for the GitHub Pages demo. src/server.js registers its routes here,
// and handle() runs them for requests the page makes (see pages/client.js). No network involved.
const routes = [];

function compile(pattern) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/[.]/g, "\\.").replace(/\/:([A-Za-z]+)/g, (_, k) => (keys.push(k), "/([^/]+)")) + "/?$");
  return { re, keys };
}

function express() {
  const add = (method) => (pattern, ...handlers) => {
    if (typeof pattern === "string") routes.push({ method, ...compile(pattern), handler: handlers.at(-1) });
  };
  return {
    get: add("GET"),
    post: add("POST"),
    put: add("PUT"),
    delete: add("DELETE"),
    use() {}, // CORS, JSON parsing and static files are handled by the browser
    set() {},
    listen(port, cb) {
      setTimeout(() => cb?.(), 0);
      return { close() {} };
    },
  };
}
express.json = () => (req, res, next) => next();
express.static = () => (req, res, next) => next();
export default express;

// sink: { head(status, headers), data(chunk), end() }. Returns a function that ends the request early
// (the page closed an event stream), which fires req.on("close") listeners.
export function handle({ method = "GET", url, headers = {}, body }, sink) {
  const u = new URL(url, "http://local");
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const closers = [];
  let parsed = {};
  if (typeof body === "string" && body) {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = body;
    }
  }
  const req = {
    method,
    url: u.pathname + u.search,
    originalUrl: u.pathname + u.search,
    path: u.pathname,
    query: Object.fromEntries(u.searchParams),
    params: {},
    body: parsed,
    headers: lower,
    get: (h) => lower[h.toLowerCase()] ?? (h.toLowerCase() === "host" ? location.host : h.toLowerCase() === "user-agent" ? navigator.userAgent : undefined),
    header(h) {
      return this.get(h);
    },
    protocol: location.protocol.replace(":", ""),
    hostname: location.hostname,
    ip: "127.0.0.1",
    on(ev, fn) {
      if (ev === "close") closers.push(fn);
    },
  };

  let sent = false;
  let ended = false;
  const res = {
    statusCode: 200,
    _headers: {},
    get headersSent() {
      return sent;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    setHeader(k, v) {
      this._headers[k.toLowerCase()] = String(v);
      return this;
    },
    getHeader(k) {
      return this._headers[k.toLowerCase()];
    },
    set(k, v) {
      if (typeof k === "object") for (const [a, b] of Object.entries(k)) this.setHeader(a, b);
      else this.setHeader(k, v);
      return this;
    },
    type(t) {
      return this.setHeader("content-type", t.includes("/") ? t : t === "json" ? "application/json" : `text/${t}`);
    },
    writeHead(c, h = {}) {
      this.statusCode = c;
      for (const [k, v] of Object.entries(h)) this.setHeader(k, v);
      this._flush();
      return this;
    },
    _flush() {
      if (!sent) {
        sent = true;
        sink.head(this.statusCode, this._headers);
      }
    },
    write(chunk) {
      if (ended) return false;
      this._flush();
      sink.data(chunk);
      return true;
    },
    end(chunk) {
      if (ended) return this;
      if (chunk != null) this.write(chunk);
      this._flush();
      ended = true;
      sink.end();
      return this;
    },
    json(obj) {
      if (!this.getHeader("content-type")) this.setHeader("content-type", "application/json");
      return this.end(JSON.stringify(obj));
    },
    send(b) {
      if (b != null && typeof b === "object" && !(b instanceof Uint8Array)) return this.json(b);
      if (!this.getHeader("content-type")) this.setHeader("content-type", typeof b === "string" ? "text/html" : "application/octet-stream");
      return this.end(b);
    },
    sendStatus(c) {
      return this.status(c).end(String(c));
    },
    sendFile() {
      return this.status(404).json({ error: "Not available in the static demo" });
    },
    redirect(to) {
      return this.status(302).setHeader("location", to).end();
    },
  };

  const route = routes.find((r) => r.method === method && r.re.test(u.pathname));
  if (!route) {
    res.status(404).json({ error: `Not available in the static demo: ${method} ${u.pathname}` });
  } else {
    const m = route.re.exec(u.pathname);
    route.keys.forEach((k, i) => (req.params[k] = decodeURIComponent(m[i + 1])));
    Promise.resolve()
      .then(() => route.handler(req, res, () => res.status(404).json({ error: "Not found" })))
      .catch((err) => {
        console.error(err);
        if (!sent) res.status(err.status || 500).json({ error: err.message });
        else res.end();
      });
  }
  return () => {
    ended = true;
    closers.forEach((fn) => fn());
  };
}
