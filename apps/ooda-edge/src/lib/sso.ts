// Cross-domain SSO handoff between ooda.blder.bot (auth home) and ooda.gmac.io.
//
// A single cookie can't span both registrable domains, so we propagate the
// already-signed better-auth session token: ooda.blder.bot reads its own
// session cookie, wraps the token value in a short-lived HMAC-signed envelope
// (signed with the shared AUTH_SECRET, so it can't be forged in the URL), and
// ooda.gmac.io verifies the envelope and sets a matching .gmac.io session
// cookie. getSession then validates that token against the shared DB — no new
// session is minted, and logout on blder.bot (DB session delete) revokes both.

const enc = new TextEncoder();

/** Envelope validity window. Short — it only needs to survive one redirect. */
const TTL_MS = 60_000;

/** Session cookie better-auth issues over HTTPS (Secure prefix in prod). */
export const SESSION_COOKIE = "__Secure-better-auth.session_token" as const;

/** All prefixes better-auth may use, most-secure first. */
const SESSION_COOKIE_NAMES = [
  "__Secure-better-auth.session_token",
  "__Host-better-auth.session_token",
  "better-auth.session_token",
] as const;

function b64url(bytes: Uint8Array): string {
  const s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Sign a session-token value into a short-lived transport envelope. */
export async function signEnvelope(
  value: string,
  secret: string,
): Promise<string> {
  const payload = enc.encode(JSON.stringify({ v: value, exp: Date.now() + TTL_MS }));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, payload as BufferSource),
  );
  return `${b64url(payload)}.${b64url(sig)}`;
}

/**
 * Verify an envelope and return the session-token value, or null if the
 * signature is invalid, the shape is wrong, or it has expired. crypto.subtle
 * .verify does a constant-time comparison, so there's no timing side channel.
 */
export async function verifyEnvelope(
  token: string,
  secret: string,
): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  let payload: Uint8Array;
  let sig: Uint8Array;
  try {
    payload = b64urlDecode(parts[0]!);
    sig = b64urlDecode(parts[1]!);
  } catch {
    return null;
  }
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    sig as BufferSource,
    payload as BufferSource,
  );
  if (!ok) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as {
      v?: unknown;
      exp?: unknown;
    };
    if (typeof parsed.exp !== "number" || Date.now() > parsed.exp) return null;
    if (typeof parsed.v !== "string" || parsed.v.length === 0) return null;
    return parsed.v;
  } catch {
    return null;
  }
}

/** Read the better-auth session cookie value (any prefix) from a Cookie header. */
export function readSessionCookieValue(cookieHeader: string): string | null {
  const pairs = cookieHeader.split(";").map((c) => c.trim());
  for (const name of SESSION_COOKIE_NAMES) {
    for (const pair of pairs) {
      if (pair.startsWith(`${name}=`)) return pair.slice(name.length + 1);
    }
  }
  return null;
}
