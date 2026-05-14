import { createHash } from "node:crypto";
import { db } from "@bob/db/client";

const SESSION_COOKIE_NAMES = new Set([
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
]);

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
