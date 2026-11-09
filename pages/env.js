// Runs before the server code: the Node globals it expects, and the static demo's settings.
import { Buffer } from "buffer";

globalThis.Buffer ??= Buffer;
const base = location.origin + location.pathname.replace(/[^/]*$/, "");
globalThis.process ??= {
  env: {
    NODE_ENV: "production",
    PAYPAL_POLL_SECONDS: "0",
    // Fixed so a tag link opened in another tab or on a phone still verifies.
    NFC_TAG_SECRET: "dispute-defender-static-demo",
    TAG_URL_BASE: `${base}tap.html#/t/`,
  },
  cwd: () => "/app",
  on() {},
  exit() {},
  platform: "browser",
  versions: {},
};
