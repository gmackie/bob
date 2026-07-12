import { createHash } from "node:crypto";
import { db } from "@bob/db/client";

const SESSION_COOKIE_NAMES = new Set([
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
]);

const AUTH_BYPASS_TOKEN_PREFIX = "bob-auth-bypass:";
const DEFAULT_BYPASS_USER_ID = "default-user";

/**
 * Refuse-to-boot guard: the dev auth bypass must never be live in
 * production. "Compiled out" is meaningless on a tsx/Node stack — a boot
 * guard is observable and testable. Called from index.ts before anything
 * listens; one stray env var in a systemd unit becomes a loud startup
 * failure instead of a silently fake-authenticated control plane.
 */
export function assertNoAuthBypassInProduction(
  env: Record<string, string | undefined> = process.env,
): void {
  const production = env.NODE_ENV === "production" || env.BOB_ENV === "production";
  if (production && env.BOB_AUTH_BYPASS === "true") {
    throw new Error(
      "BOB_AUTH_BYPASS is set in a production environment — refusing to boot. " +
        "Provision a real API key for every caller (see docs/ops/hetzner-bob-runtime-verify.md) " +
        "and remove BOB_AUTH_BYPASS from the unit/env.",
    );
  }
}

/**
 * Authorize an internal HTTP endpoint bearer (/internal/*).
 *
 * Primary: a hashed, revocable API key from the api_keys table — the same
 * mechanism daemons use, minus the workspace pairing. Legacy: the static
 * NUDGE_SHARED_SECRET env value, accepted only while
 * BOB_ALLOW_LEGACY_NUDGE_SECRET is not "false" — a rotation ramp, not a
 * permanent path; every legacy acceptance logs a deprecation warning.
 */
export async function validateInternalBearer(bearer: string): Promise<boolean> {
  if (!bearer) return false;

  try {
    const keyHash = hashApiKey(bearer);
    const keyRow = await db.query.apiKeys.findFirst({
      where: (apiKeys, { eq }) => eq(apiKeys.keyHash, keyHash),
    });
    if (keyRow && !keyRow.revokedAt) {
      if (!keyRow.expiresAt) return true;
      const raw: unknown = keyRow.expiresAt;
      const expiresAt = raw instanceof Date ? raw : new Date(raw as string);
      if (expiresAt.getTime() > Date.now()) return true;
      return false;
    }
  } catch (err) {
    console.error("[auth] internal bearer key lookup failed:", err);
    // fall through to the legacy check — DB trouble must not lock out ops
  }

  const legacy = process.env.NUDGE_SHARED_SECRET;
  if (
    legacy &&
    bearer === legacy &&
    process.env.BOB_ALLOW_LEGACY_NUDGE_SECRET !== "false"
  ) {
    console.warn(
      "[auth] internal endpoint authorized via legacy NUDGE_SHARED_SECRET — rotate the caller to an API key and set BOB_ALLOW_LEGACY_NUDGE_SECRET=false",
    );
    return true;
  }
  return false;
}

/**
 * Validate a browser Better Auth credential and return the userId.
 *
 * Mobile and web clients send the full cookie header from better-auth's
 * client helper. Better Auth stores signed session cookies as
 * `<session-token>.<signature>` and looks up the database session by the
 * token prefix; raw tokens are still accepted for older local tooling.
 *
 * Returns null if the credential is invalid or the session is expired.
 */
export async function validateBrowserToken(token: string): Promise<string | null> {
  if (!token) return null;

  const devUserId = resolveDevAuthBypassToken(token);
  if (devUserId) return devUserId;
  if (token.startsWith(AUTH_BYPASS_TOKEN_PREFIX)) return null;

  const sessionToken = extractBrowserSessionToken(token);
  if (!sessionToken) return null;

  const row = await db.query.session.findFirst({
    where: (session, { eq }) => eq(session.token, sessionToken),
  });

  if (!row) return null;

  const expiresAt = row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt);
  if (expiresAt.getTime() <= Date.now()) return null;

  return row.userId;
}

function resolveDevAuthBypassToken(credential: string): string | null {
  if (process.env.BOB_AUTH_BYPASS !== "true") {
    return null;
  }

  if (!credential.startsWith(AUTH_BYPASS_TOKEN_PREFIX)) return null;

  const token = credential.slice(AUTH_BYPASS_TOKEN_PREFIX.length).trim();
  if (token.length === 0) return null;

  const configuredToken = process.env.BOB_AUTH_BYPASS_TOKEN?.trim();
  if (!configuredToken || token !== configuredToken) return null;

  const configuredUserId =
    process.env.BOB_AUTH_BYPASS_USER_ID?.trim() || DEFAULT_BYPASS_USER_ID;
  return configuredUserId;
}

function extractBrowserSessionToken(credential: string): string | null {
  if (!credential.includes("=")) return credential;

  for (const part of credential.split(";")) {
    const [rawName = "", ...rawValueParts] = part.trim().split("=");
    if (!SESSION_COOKIE_NAMES.has(rawName)) continue;

    const rawValue = rawValueParts.join("=");
    if (!rawValue) return null;

    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      // Keep the raw value if a non-browser client sends an unescaped token.
    }

    return value.split(".")[0] ?? null;
  }

  return null;
}

/**
 * Validate a daemon's API key + workspaceId pair.
 *
 * Checks:
 *   1. API key exists in api_keys table (matched by hash)
 *   2. Not revoked, not expired
 *   3. workspaceId belongs to the same userId as the API key
 *
 * Returns the userId on success, null on failure.
 */
export async function validateDaemonAuth(
  apiKey: string,
  workspaceId: string,
): Promise<string | null> {
  if (!apiKey || !workspaceId) return null;

  const keyHash = hashApiKey(apiKey);

  const keyRow = await db.query.apiKeys.findFirst({
    where: (apiKeys, { eq }) => eq(apiKeys.keyHash, keyHash),
  });

  if (!keyRow) return null;
  if (keyRow.revokedAt) return null;
  if (keyRow.expiresAt) {
    const raw: unknown = keyRow.expiresAt;
    const expiresAt = raw instanceof Date ? raw : new Date(raw as string);
    if (expiresAt.getTime() <= Date.now()) return null;
  }

  const workspace = await db.query.workspaces.findFirst({
    where: (workspaces, { eq }) => eq(workspaces.id, workspaceId),
  });

  if (!workspace) return null;
  if (workspace.ownerUserId !== keyRow.userId) return null;

  return keyRow.userId;
}

/**
 * Hash an API key the same way the auth router does when creating keys.
 * SHA-256 hex encoding — keep this in sync with packages/api/src/router/settings.ts
 * and packages/api/src/router/publicApi.ts.
 */
function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}
