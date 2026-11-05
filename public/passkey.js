// Passkey approval in the browser (WebAuthn). Works with Face ID / Touch ID, Windows Hello,
// Android fingerprint, or a phone used as a passkey for a laptop.
const HOLDER_KEY = "dd-passkey-holder";

const b64u = {
  toBuf: (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0)).buffer,
  from: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
};

const supported = () => Boolean(window.PublicKeyCredential && navigator.credentials);
const holder = () => localStorage.getItem(HOLDER_KEY);

// Server JSON options -> browser options (newer browsers have a built-in for this).
function creationOptions(o) {
  if (PublicKeyCredential.parseCreationOptionsFromJSON) return PublicKeyCredential.parseCreationOptionsFromJSON(o);
  return { ...o, challenge: b64u.toBuf(o.challenge), user: { ...o.user, id: b64u.toBuf(o.user.id) }, excludeCredentials: (o.excludeCredentials ?? []).map((c) => ({ ...c, id: b64u.toBuf(c.id) })) };
}
function requestOptions(o) {
  if (PublicKeyCredential.parseRequestOptionsFromJSON) return PublicKeyCredential.parseRequestOptionsFromJSON(o);
  return { ...o, challenge: b64u.toBuf(o.challenge), allowCredentials: (o.allowCredentials ?? []).map((c) => ({ ...c, id: b64u.toBuf(c.id) })) };
}

// Browser credential -> JSON the server library expects.
function toJSON(cred) {
  try {
    if (cred.toJSON) return cred.toJSON();
  } catch { /* some browsers throw on toJSON; fall through */ }
  const r = cred.response;
  const out = { id: cred.id, rawId: b64u.from(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults?.() ?? {}, authenticatorAttachment: cred.authenticatorAttachment ?? undefined, response: { clientDataJSON: b64u.from(r.clientDataJSON) } };
  if (r.attestationObject) Object.assign(out.response, { attestationObject: b64u.from(r.attestationObject), transports: r.getTransports?.() ?? [] });
  else Object.assign(out.response, { authenticatorData: b64u.from(r.authenticatorData), signature: b64u.from(r.signature), userHandle: r.userHandle ? b64u.from(r.userHandle) : undefined });
  return out;
}

async function post(path, body, extra = {}) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers(), ...extra }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { data, status: res.status });
  return data;
}

// Sent with every API call so the server knows this browser has a passkey.
function headers() {
  const h = holder();
  return h ? { "X-Passkey-Holder": h } : {};
}

// Asks for the passkey and returns a one-time token for `action`.
async function approve(action) {
  if (!supported()) throw new Error("This browser can't use passkeys.");
  const { ceremony, options } = await post("/api/passkeys/approve/start", { action });
  const cred = await navigator.credentials.get({ publicKey: requestOptions(options) });
  const { token } = await post("/api/passkeys/approve/finish", { ceremony, response: toJSON(cred) });
  return token;
}

// Runs fn(extraHeaders); if the server asks for a passkey, approves and runs it once more.
async function guarded(fn) {
  try {
    return await fn({});
  } catch (err) {
    if (err.status !== 401 || err.data?.passkey !== "required") throw err;
    const token = await approve(err.data.action);
    return fn({ "X-Approval-Token": token });
  }
}

async function register(label) {
  if (!supported()) throw new Error("This browser can't create passkeys.");
  const { ceremony, options } = await guarded((h) => post("/api/passkeys/register/start", { label }, h));
  const cred = await navigator.credentials.create({ publicKey: creationOptions(options) });
  const out = await post("/api/passkeys/register/finish", { ceremony, response: toJSON(cred) });
  localStorage.setItem(HOLDER_KEY, out.id);
  return out;
}

async function removeAll() {
  const out = await guarded((h) => post("/api/passkeys/remove", {}, h));
  localStorage.removeItem(HOLDER_KEY);
  return out;
}

window.Passkey = { supported, holder, headers, approve, register, removeAll };
