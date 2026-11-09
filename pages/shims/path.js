// The parts of Node's "path" the server uses, POSIX style. The working directory is /app.
const CWD = "/app";

function normalize(p) {
  const out = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

export const sep = "/";
export const join = (...parts) => normalize(parts.filter(Boolean).join("/"));
export function resolve(...parts) {
  let p = "";
  for (const part of parts) p = part.startsWith("/") ? part : p ? `${p}/${part}` : part;
  return normalize(p.startsWith("/") ? p : `${CWD}/${p}`);
}
export const dirname = (p) => normalize(p.split("/").slice(0, -1).join("/") || "/");
export const basename = (p, ext) => {
  const b = p.split("/").filter(Boolean).pop() ?? "";
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
};
export const extname = (p) => {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i) : "";
};

export default { sep, join, resolve, dirname, basename, extname, normalize };
