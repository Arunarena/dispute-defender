// Builds the GitHub Pages demo into _site/: the full dashboard (public/) with the real server
// (src/server.js) bundled to run inside the page in demo mode, plus the phone app at /mobile/.
//   node scripts/build-pages.mjs        then serve _site/ with any static file server
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "_site");
const shim = (f) => path.join(root, "pages", "shims", f);

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, "public"), out, { recursive: true });

// Node built-ins and server-only packages, swapped for browser stand-ins.
const SWAPS = {
  express: shim("express.js"),
  fs: shim("fs.js"),
  path: shim("path.js"),
  crypto: shim("crypto.js"),
  events: shim("events.js"),
  module: shim("module.js"),
  "dotenv/config": shim("empty.js"),
  "@anthropic-ai/sdk": shim("anthropic.js"),
  "@anthropic-ai/sdk/helpers/beta/zod": shim("anthropic.js"),
  pdfkit: shim("pdfkit.js"),
};
const swapPlugin = {
  name: "swap",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      const name = args.path.replace(/^node:/, "");
      // A stand-in can still import the real package it wraps (pdfkit's browser build).
      if (!SWAPS[name] || args.importer === SWAPS[name]) return undefined;
      return { path: SWAPS[name] };
    });
  },
};

await esbuild.build({
  entryPoints: [path.join(root, "pages", "backend.js")],
  outfile: path.join(out, "backend.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  plugins: [swapPlugin],
  logLevel: "warning",
});
fs.copyFileSync(path.join(root, "pages", "client.js"), path.join(out, "client.js"));

// Pages serves the site from /<repo>/, so root paths in the HTML become relative,
// and the in-page server's client loads before the app's own scripts.
const samples = fs.readdirSync(path.join(root, "public", "samples")).map((f) => `samples/${f}`);
const head = `<script>window.DD_SAMPLES=${JSON.stringify(samples)}</script><script src="./client.js"></script>`;
for (const f of fs.readdirSync(out).filter((f) => f.endsWith(".html"))) {
  const file = path.join(out, f);
  const html = fs
    .readFileSync(file, "utf8")
    .replace(/(href|src)="\/(?!\/)/g, '$1="./')
    .replace(/<head>/i, `<head>\n    ${head}`);
  fs.writeFileSync(file, html);
}
// Image and page paths built in the app's scripts (pages/client.js also catches any it misses).
for (const f of ["app.js", "views.js"]) {
  const file = path.join(out, f);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/(["'`])\/(img\/|shop\.html)/g, "$1$2"));
}
// The manifest's paths too, so "install app" works under /<repo>/.
const manifest = path.join(out, "manifest.webmanifest");
fs.writeFileSync(manifest, fs.readFileSync(manifest, "utf8").replace(/"\/(?!\/)/g, '"./'));

// The phone app, with its own in-browser demo engine.
execFileSync(process.execPath, [path.join(root, "mobile", "scripts", "copy-engine.mjs")], { stdio: "inherit" });
fs.cpSync(path.join(root, "mobile", "www"), path.join(out, "mobile"), { recursive: true });
fs.writeFileSync(path.join(out, ".nojekyll"), "");

const kb = (f) => Math.round(fs.statSync(path.join(out, f)).size / 1024);
console.log(`Built _site/ (backend.js ${kb("backend.js")} KB)`);
