/** Edge -> Node vault origin identity assertion (Bob #235).
 *
 * The edge authenticates the browser/mobile session, then forwards vault-only
 * tRPC requests to the loopback vault host's origin with an HMAC over the
 * actor, time, method, origin path+query and body digest. The Node host honours
 * a valid assertion for `vault.*` procedures only. WebCrypto, so it runs in both
 * Workers and Node. */
export const VAULT_ASSERTION_HEADER = "x-bob-vault-assertion";
const VERSION = "v1";
const MAX_SKEW_MS = 60_000;

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64url = (value: string) =>
  btoa(String.fromCharCode(...encoder.encode(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (value: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

async function mac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

async function canonical(actor: string, timestamp: number, method: string, pathAndQuery: string, body: string) {
  const digest = hex(await crypto.subtle.digest("SHA-256", encoder.encode(body)));
  return [VERSION, actor, String(timestamp), method.toUpperCase(), pathAndQuery, digest].join("\n");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface VaultAssertionRequest {
  method: string;
  /** Path and query exactly as the vault host receives it, e.g. `/api/trpc/vault.list?input=...`. */
  pathAndQuery: string;
  body: string;
}

export async function signVaultAssertion(
  secret: string, actor: string, request: VaultAssertionRequest, now = Date.now(),
): Promise<string> {
  if (secret.length < 32) throw new Error("Vault origin secret is too short");
  if (!actor) throw new Error("Vault assertion requires an actor");
  const signature = await mac(secret, await canonical(actor, now, request.method, request.pathAndQuery, request.body));
  return [VERSION, b64url(actor), String(now), signature].join(".");
}

/** Returns the asserted actor, or null for any missing, stale or invalid assertion. */
export async function verifyVaultAssertion(
  secret: string | undefined, header: string | null, request: VaultAssertionRequest, now = Date.now(),
): Promise<string | null> {
  if (!secret || secret.length < 32 || !header) return null;
  const parts = header.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION || !/^\d{1,16}$/.test(parts[2]!) || !/^[0-9a-f]{64}$/.test(parts[3]!)) return null;
  const timestamp = Number(parts[2]);
  if (Math.abs(now - timestamp) > MAX_SKEW_MS) return null;
  let actor: string;
  try { actor = fromB64url(parts[1]!); } catch { return null; }
  if (!actor) return null;
  const expected = await mac(secret, await canonical(actor, timestamp, request.method, request.pathAndQuery, request.body));
  return constantTimeEqual(expected, parts[3]!) ? actor : null;
}

/** True when every procedure in a (possibly batched) tRPC path is a vault procedure. */
export function isVaultOnlyTrpcPath(pathname: string, prefix = "/api/trpc/"): boolean {
  if (!pathname.startsWith(prefix)) return false;
  const procedures = decodeURIComponent(pathname.slice(prefix.length)).split(",");
  return procedures.length > 0 && procedures.every((name) => /^vault\.[A-Za-z]+$/.test(name));
}
