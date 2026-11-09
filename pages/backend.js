// The real server (src/server.js) bundled for the browser. pages/client.js sends the page's
// /api requests here. Built by scripts/build-pages.mjs.
import "./env.js";
import "../src/server.js";
import { files } from "./shims/fs.js";
import { Buffer } from "buffer";
export { handle } from "./shims/express.js";

// Sample photos the server reads from disk (for the dossier PDF).
export async function preload(paths) {
  await Promise.all(
    paths.map(async (p) => {
      const res = await fetch(p);
      if (res.ok) files.set(`/app/public/${p}`, Buffer.from(await res.arrayBuffer()));
    }),
  );
}

// Files the server wrote, such as uploaded photos (/uploads/x.png lives at /app/data/uploads/x.png).
export const readUpload = (urlPath) => files.get(`/app/data${urlPath}`) ?? null;
