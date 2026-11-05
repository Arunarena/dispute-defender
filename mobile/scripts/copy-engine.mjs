// Copies the server's demo engine (demo data, scripted agent, autopilot rules,
// track record) into the app, so the offline demo runs the same logic as the server.
// Node-only imports (fs, path, events, zod, Claude) are swapped for small
// stand-ins in www/offline/shims by the import map in www/index.html.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "..", "..", "src");
const out = path.resolve(here, "..", "www", "offline", "engine");
const FILES = ["demoData.js", "store.js", "photos.js", "scripted.js", "autopilot.js", "outcomes.js"];

fs.mkdirSync(out, { recursive: true });
for (const f of FILES) {
  const code = fs.readFileSync(path.join(src, f), "utf8");
  fs.writeFileSync(path.join(out, f), `// Copied from src/${f} by mobile/scripts/copy-engine.mjs. Edit the original, not this copy.\n${code}`);
}
console.log(`Copied ${FILES.length} engine files to www/offline/engine`);
