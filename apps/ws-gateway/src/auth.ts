import { createHash } from "node:crypto";

import { db } from "@bob/db/client";

/**
 * Validate a better-auth session token and return the userId.
 * Returns null if the token is invalid or the session is expired.
 *
 * The session table is owned by better-auth but we query it directly —
 * we share the same Postgres and don't need to call better-auth's HTTP API.
 */
export async function validateBrowserToken(
  token: string,
): Promise<string | null> {
  if (!token) return null;

  if (process.env.REQUIRE_AUTH !== "true" && token === "default-user") {
    return "default-user";
  }

  const row = await db.query.session.findFirst({
    where: (session, { eq }) => eq(session.token, token),
  });

  if (!row) return null;

  const expiresAt =
    row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt);
  if (expiresAt.getTime() <= Date.now()) return null;

  return row.userId;
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
