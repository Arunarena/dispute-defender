// In-memory file system for the GitHub Pages demo. Files written here last until the page reloads.
import { Buffer } from "buffer";

export const files = new Map();
const enoent = (p) => Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: "ENOENT" });

const fs = {
  readFileSync(p, opts) {
    if (!files.has(p)) throw enoent(p);
    const buf = files.get(p);
    const enc = typeof opts === "string" ? opts : opts?.encoding;
    return enc ? buf.toString(enc) : buf;
  },
  writeFileSync(p, data) {
    files.set(p, Buffer.isBuffer(data) ? data : typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data));
  },
  mkdirSync() {},
  existsSync: (p) => files.has(p),
  unlinkSync: (p) => files.delete(p),
};
export default fs;
export const { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } = fs;
