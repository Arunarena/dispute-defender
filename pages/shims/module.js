// passkeys.js loads @simplewebauthn/server with createRequire. In the browser bundle it is
// imported directly instead (it runs on Web Crypto, so passkeys work in the static demo).
import * as simplewebauthn from "@simplewebauthn/server";
export const createRequire = () => () => simplewebauthn;
export default { createRequire };
