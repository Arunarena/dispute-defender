// Passkey approval (WebAuthn): Face ID, Touch ID, Windows Hello or a phone's fingerprint
// must confirm every action that moves money or answers PayPal.
//
// Live PayPal mode: once any passkey is registered, every approval needs one.
// Demo mode: only the browser that registered a passkey is asked for it, so one visitor
// enrolling on a shared demo doesn't lock everyone else out.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";

const FILE = path.resolve("data", "passkeys.json");
const RP_NAME = "Dispute Defender";

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { credentials: [] };
  }
}
function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

const ceremonies = new Map(); // id -> { challenge, kind, action, exp }
const approvals = new Map(); // token -> { action, exp }
const sweep = (m) => { for (const [k, v] of m) if (v.exp < Date.now()) m.delete(k); };
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });

export const credentialCount = () => load().credentials.length;

// liveMode: real PayPal keys are set. holder: the credential id this browser registered.
export function isRequired({ liveMode, holder }) {
  const creds = load().credentials;
  if (!creds.length) return false;
  return liveMode ? true : Boolean(holder && creds.some((c) => c.id === holder));
}

export function status(ctx) {
  return {
    required: isRequired(ctx),
    thisDevice: Boolean(ctx.holder && load().credentials.some((c) => c.id === ctx.holder)),
    credentials: load().credentials.map(({ id, label, createdAt, lastUsed }) => ({ id: id.slice(0, 10) + "…", label, createdAt, lastUsed })),
  };
}

// ---- register a passkey on this device ----
export async function startRegistration({ rpID, label }) {
  sweep(ceremonies);
  const db = load();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: "seller",
    userDisplayName: "Store owner",
    attestationType: "none",
    excludeCredentials: db.credentials.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  const id = crypto.randomUUID();
  ceremonies.set(id, { challenge: options.challenge, kind: "register", label: String(label || "Passkey").slice(0, 40), exp: Date.now() + 5 * 60000 });
  return { ceremony: id, options };
}

export async function finishRegistration({ ceremony, response, rpID, origins }) {
  const c = ceremonies.get(ceremony);
  ceremonies.delete(ceremony);
  if (!c || c.kind !== "register" || c.exp < Date.now()) throw fail("Registration expired. Try again.");
  const v = await verifyRegistrationResponse({ response, expectedChallenge: c.challenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true });
  if (!v.verified) throw fail("Passkey could not be verified.", 401);
  const { credential } = v.registrationInfo;
  const db = load();
  db.credentials.push({ id: credential.id, publicKey: Buffer.from(credential.publicKey).toString("base64url"), counter: credential.counter, transports: credential.transports ?? response.response?.transports ?? [], label: c.label, createdAt: new Date().toISOString(), lastUsed: null });
  save(db);
  return { id: credential.id, label: c.label };
}

// ---- approve one action ----
export async function startApproval({ rpID, action, holder, liveMode }) {
  sweep(ceremonies);
  const creds = load().credentials.filter((c) => liveMode || c.id === holder);
  if (!creds.length) throw fail("No passkey registered on this device.");
  const options = await generateAuthenticationOptions({ rpID, allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports })), userVerification: "required" });
  const id = crypto.randomUUID();
  ceremonies.set(id, { challenge: options.challenge, kind: "approve", action, exp: Date.now() + 5 * 60000 });
  return { ceremony: id, options };
}

export async function finishApproval({ ceremony, response, rpID, origins }) {
  const c = ceremonies.get(ceremony);
  ceremonies.delete(ceremony);
  if (!c || c.kind !== "approve" || c.exp < Date.now()) throw fail("Approval expired. Try again.");
  const db = load();
  const cred = db.credentials.find((x) => x.id === response.id);
  if (!cred) throw fail("Unknown passkey.", 401);
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: c.challenge,
    expectedOrigin: origins,
    expectedRPID: rpID,
    credential: { id: cred.id, publicKey: Buffer.from(cred.publicKey, "base64url"), counter: cred.counter, transports: cred.transports },
    requireUserVerification: true,
  });
  if (!v.verified) throw fail("Passkey check failed.", 401);
  cred.counter = v.authenticationInfo.newCounter;
  cred.lastUsed = new Date().toISOString();
  save(db);
  sweep(approvals);
  const token = crypto.randomBytes(24).toString("base64url");
  approvals.set(token, { action: c.action, exp: Date.now() + 2 * 60000 });
  return { token, label: cred.label };
}

// One-time use: a token approves exactly one action, within two minutes.
export function consumeApproval(token, action) {
  const a = approvals.get(token ?? "");
  if (!a || a.exp < Date.now() || a.action !== action) return false;
  approvals.delete(token);
  return true;
}

export function removeAll() {
  save({ credentials: [] });
}
