// The few path helpers the engine uses.
const join = (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
const basename = (p) => String(p).split("/").pop();
const path = {
  join,
  resolve: join,
  basename,
  dirname: (p) => String(p).split("/").slice(0, -1).join("/"),
  extname: (p) => {
    const m = /\.[^./]*$/.exec(basename(p));
    return m ? m[0] : "";
  },
};
export default path;
