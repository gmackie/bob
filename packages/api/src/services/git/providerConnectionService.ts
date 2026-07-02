import { and, eq, isNull, sql } from "@bob/db";
import { db } from "@bob/db/client";
import { account, gitProviderConnections } from "@bob/db/schema";

import type { EncryptedToken } from "../crypto/tokenVault";
import type { GitProvider, GitProviderClient } from "./providers/types";
import {
  decryptToken,
  encryptToken,
  isEncryptionConfigured,
} from "../crypto/tokenVault";
import { createGiteaClient } from "./providers/gitea";
import { createGitHubClient } from "./providers/github";
import { createGitLabClient } from "./providers/gitlab";

export interface ConnectionWithDecryptedToken {
  id: string;
  userId: string;
  provider: GitProvider;
  instanceUrl: string | null;
  providerAccountId: string;
  providerUsername: string | null;
  scopes: string | null;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  createdAt: string;
}

async function ensureGitHubConnectionFromOAuth(userId: string): Promise<void> {
  try {
    const existing = await db.query.gitProviderConnections.findFirst({
      where: and(
        eq(gitProviderConnections.userId, userId),
        eq(gitProviderConnections.provider, "github"),
        isNull(gitProviderConnections.instanceUrl),
        isNull(gitProviderConnections.revokedAt),
      ),
    });
    if (existing) return;

    const oauthAccount = await db.query.account.findFirst({
      where: and(eq(account.userId, userId), eq(account.providerId, "github")),
    });
    if (!oauthAccount) {
      console.warn(
        `[git-provider] No GitHub OAuth account found for user ${userId}. ` +
          "User may need to sign in with GitHub.",
      );
      return;
    }
    if (!oauthAccount.accessToken) {
      console.warn(
        `[git-provider] GitHub OAuth account found for user ${userId} but ` +
          "accessToken is missing. BetterAuth may not have stored the token. " +
          `Account ID: ${oauthAccount.id}, providerId: ${oauthAccount.providerId}`,
      );
      return;
    }

    if (!isEncryptionConfigured()) {
      console.error(
        "[git-provider] GIT_TOKEN_ENCRYPTION_KEY is not set or too short. " +
          "Cannot encrypt GitHub token to create provider connection.",
      );
      return;
    }

    // Try to fetch the GitHub username for a better UX
    let providerUsername: string | null = null;
    try {
      const ghClient = createGitHubClient(oauthAccount.accessToken);
      const ghUser = await ghClient.getAuthenticatedUser();
      providerUsername = ghUser.username;
    } catch (err) {
      console.warn(
        "[git-provider] Could not fetch GitHub username with OAuth token, " +
          "proceeding without it:",
        err instanceof Error ? err.message : err,
      );
    }

    await createConnection({
      userId,
      provider: "github",
      providerAccountId: oauthAccount.accountId,
      providerUsername,
      scopes: oauthAccount.scope ?? null,
      accessToken: oauthAccount.accessToken,
      refreshToken: oauthAccount.refreshToken ?? null,
      accessTokenExpiresAt: oauthAccount.accessTokenExpiresAt ?? null,
      refreshTokenExpiresAt: oauthAccount.refreshTokenExpiresAt ?? null,
    });

    console.info(
      `[git-provider] Created GitHub provider connection for user ${userId}` +
        (providerUsername ? ` (${providerUsername})` : ""),
    );
  } catch (err) {
    console.error(
      "[git-provider] Failed to ensure GitHub connection from OAuth:",
      err instanceof Error ? err.message : err,
    );
  }
}

type GitProviderConnectionRow = typeof gitProviderConnections.$inferSelect;

/** Decrypt a raw connection row into a usable connection with plaintext tokens. */
function decryptConnectionRow(
  connection: GitProviderConnectionRow,
): ConnectionWithDecryptedToken {
  const accessToken = decryptToken(
    {
      ciphertext: connection.accessTokenCiphertext,
      iv: connection.accessTokenIv,
      tag: connection.accessTokenTag,
    },
    connection.id,
  );

  let refreshToken: string | null = null;
  if (
    connection.refreshTokenCiphertext &&
    connection.refreshTokenIv &&
    connection.refreshTokenTag
  ) {
    refreshToken = decryptToken(
      {
        ciphertext: connection.refreshTokenCiphertext,
        iv: connection.refreshTokenIv,
        tag: connection.refreshTokenTag,
      },
      connection.id,
    );
  }

  return {
    id: connection.id,
    userId: connection.userId,
    provider: connection.provider as GitProvider,
    instanceUrl: connection.instanceUrl,
    providerAccountId: connection.providerAccountId,
    providerUsername: connection.providerUsername,
    scopes: connection.scopes,
    accessToken,
    refreshToken,
    accessTokenExpiresAt: connection.accessTokenExpiresAt,
    refreshTokenExpiresAt: connection.refreshTokenExpiresAt,
    createdAt: connection.createdAt,
  };
}

export async function getConnection(
  userId: string,
  provider: GitProvider,
  instanceUrl?: string | null,
): Promise<ConnectionWithDecryptedToken | null> {
  if (provider === "github" && !instanceUrl) {
    await ensureGitHubConnectionFromOAuth(userId);
  }

  const conditions = [
    eq(gitProviderConnections.userId, userId),
    eq(gitProviderConnections.provider, provider),
    isNull(gitProviderConnections.revokedAt),
  ];

  if (instanceUrl) {
    conditions.push(eq(gitProviderConnections.instanceUrl, instanceUrl));
  } else {
    conditions.push(isNull(gitProviderConnections.instanceUrl));
  }

  const connection = await db.query.gitProviderConnections.findFirst({
    where: and(...conditions),
  });

  if (!connection) return null;

  return decryptConnectionRow(connection);
}

/**
 * Load every active connection for a user with decrypted tokens.
 * Used by the connector health check, which must verify credentials against
 * each provider's live API.
 */
export async function listConnectionsWithTokens(
  userId: string,
): Promise<ConnectionWithDecryptedToken[]> {
  await ensureGitHubConnectionFromOAuth(userId);

  const connections = await db.query.gitProviderConnections.findMany({
    where: and(
      eq(gitProviderConnections.userId, userId),
      isNull(gitProviderConnections.revokedAt),
    ),
  });

  return connections.map(decryptConnectionRow);
}

export async function listConnections(userId: string): Promise<
  Array<{
    id: string;
    provider: GitProvider;
    instanceUrl: string | null;
    providerAccountId: string;
    providerUsername: string | null;
    createdAt: string;
  }>
> {
  await ensureGitHubConnectionFromOAuth(userId);

  const connections = await db.query.gitProviderConnections.findMany({
    where: and(
      eq(gitProviderConnections.userId, userId),
      isNull(gitProviderConnections.revokedAt),
    ),
  });

  return connections.map((c) => ({
    id: c.id,
    provider: c.provider as GitProvider,
    instanceUrl: c.instanceUrl,
    providerAccountId: c.providerAccountId,
    providerUsername: c.providerUsername,
    createdAt: c.createdAt,
  }));
}

export async function createConnection(params: {
  userId: string;
  provider: GitProvider;
  instanceUrl?: string | null;
  providerAccountId: string;
  providerUsername?: string | null;
  scopes?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  refreshTokenExpiresAt?: Date | null;
}): Promise<string> {
  const tempId = crypto.randomUUID();

  const encryptedAccessToken = encryptToken(params.accessToken, tempId);
  let encryptedRefreshToken: EncryptedToken | null = null;
  if (params.refreshToken) {
    encryptedRefreshToken = encryptToken(params.refreshToken, tempId);
  }

  const [result] = await db
    .insert(gitProviderConnections)
    .values({
      id: tempId,
      userId: params.userId,
      provider: params.provider,
      instanceUrl: params.instanceUrl ?? null,
      providerAccountId: params.providerAccountId,
      providerUsername: params.providerUsername ?? null,
      scopes: params.scopes ?? null,
      accessTokenCiphertext: encryptedAccessToken.ciphertext,
      accessTokenIv: encryptedAccessToken.iv,
      accessTokenTag: encryptedAccessToken.tag,
      refreshTokenCiphertext: encryptedRefreshToken?.ciphertext ?? null,
      refreshTokenIv: encryptedRefreshToken?.iv ?? null,
      refreshTokenTag: encryptedRefreshToken?.tag ?? null,
      accessTokenExpiresAt: params.accessTokenExpiresAt?.toISOString() ?? null,
      refreshTokenExpiresAt: params.refreshTokenExpiresAt?.toISOString() ?? null,
    })
    .returning({ id: gitProviderConnections.id });

  return result!.id;
}

export async function revokeConnection(
  userId: string,
  connectionId: string,
): Promise<boolean> {
  const result = await db
    .update(gitProviderConnections)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(gitProviderConnections.id, connectionId),
        eq(gitProviderConnections.userId, userId),
        isNull(gitProviderConnections.revokedAt),
      ),
    )
    .returning({ id: gitProviderConnections.id });

  return result.length > 0;
}

export async function updateConnectionToken(
  connectionId: string,
  accessToken: string,
  refreshToken?: string | null,
  accessTokenExpiresAt?: Date | null,
): Promise<void> {
  const encryptedAccessToken = encryptToken(accessToken, connectionId);
  let encryptedRefreshToken: EncryptedToken | null = null;
  if (refreshToken) {
    encryptedRefreshToken = encryptToken(refreshToken, connectionId);
  }

  await db
    .update(gitProviderConnections)
    .set({
      accessTokenCiphertext: encryptedAccessToken.ciphertext,
      accessTokenIv: encryptedAccessToken.iv,
      accessTokenTag: encryptedAccessToken.tag,
      refreshTokenCiphertext: encryptedRefreshToken?.ciphertext,
      refreshTokenIv: encryptedRefreshToken?.iv,
      refreshTokenTag: encryptedRefreshToken?.tag,
      accessTokenExpiresAt: accessTokenExpiresAt?.toISOString() ?? null,
    })
    .where(eq(gitProviderConnections.id, connectionId));
}

export function createProviderClient(
  provider: GitProvider,
  accessToken: string,
  instanceUrl?: string | null,
): GitProviderClient {
  switch (provider) {
    case "github":
      return createGitHubClient(accessToken);
    case "gitlab":
      return createGitLabClient(accessToken, instanceUrl ?? undefined);
    case "gitea":
      if (!instanceUrl) {
        throw new Error("Gitea requires an instance URL");
      }
      return createGiteaClient(accessToken, instanceUrl);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

export async function getProviderClientForUser(
  userId: string,
  provider: GitProvider,
  instanceUrl?: string | null,
): Promise<GitProviderClient | null> {
  const connection = await getConnection(userId, provider, instanceUrl);
  if (!connection) return null;

  return createProviderClient(
    provider,
    connection.accessToken,
    connection.instanceUrl,
  );
}

export async function ensureValidAccessToken(
  connection: ConnectionWithDecryptedToken,
): Promise<string> {
  if (!connection.accessTokenExpiresAt) {
    return connection.accessToken;
  }

  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (new Date(connection.accessTokenExpiresAt) > fiveMinutesFromNow) {
    return connection.accessToken;
  }

  if (!connection.refreshToken) {
    throw new Error("Access token expired and no refresh token available");
  }

  const newTokens = await refreshAccessToken(
    connection.provider,
    connection.refreshToken,
    connection.instanceUrl,
  );

  await updateConnectionToken(
    connection.id,
    newTokens.accessToken,
    newTokens.refreshToken,
    newTokens.expiresAt,
  );

  return newTokens.accessToken;
}

async function refreshAccessToken(
  provider: GitProvider,
  refreshToken: string,
  instanceUrl: string | null,
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }> {
  switch (provider) {
    case "github":
      throw new Error("GitHub OAuth tokens do not support refresh");

    case "gitlab": {
      const tokenUrl = instanceUrl
        ? `${instanceUrl}/oauth/token`
        : "https://gitlab.com/oauth/token";

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: process.env.AUTH_GITLAB_ID!,
          client_secret: process.env.AUTH_GITLAB_SECRET!,
        }).toString(),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to refresh GitLab token: ${await response.text()}`,
        );
      }

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000)
          : undefined,
      };
    }

    case "gitea":
      throw new Error("Gitea PAT tokens do not support refresh");

    default:
      throw new Error(`Unsupported provider for token refresh: ${provider}`);
  }
}

// ── Connector health ──────────────────────────────────────────────────

export interface ConnectorHealth {
  connectionId: string;
  provider: string;
  instanceUrl: string | null;
  providerUsername: string | null;
  status: "healthy" | "unhealthy";
  /** True when the failure is an authentication problem the user can fix by reconnecting. */
  needsReauth: boolean;
  error: string | null;
}

const DEFAULT_FORGEGRAPH_URL = "https://forgegraf.com";

/**
 * Heuristic: does this error look like an expired/revoked/invalid credential
 * (as opposed to a transient network or server error)? Auth failures are the
 * ones a user resolves by re-authenticating.
 */
export function isAuthFailure(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return (
    message.includes("401") ||
    message.includes("403") ||
    message.includes("unauthor") ||
    message.includes("forbidden") ||
    message.includes("invalid token") ||
    message.includes("invalid credentials") ||
    message.includes("bad credentials") ||
    message.includes("expired") ||
    message.includes("revoked")
  );
}

/**
 * Verify a connection's credentials against the live provider API.
 * Resolves with the authenticated username (when available) or throws on failure.
 */
export async function verifyConnectionCredentials(
  provider: string,
  accessToken: string,
  instanceUrl: string | null,
): Promise<string | null> {
  if (provider === "forgegraph") {
    const baseUrl = instanceUrl ?? DEFAULT_FORGEGRAPH_URL;
    const response = await fetch(`${baseUrl}/api/fg/apps`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`ForgeGraph ${response.status}`);
    }
    return null;
  }

  const client = createProviderClient(
    provider as GitProvider,
    accessToken,
    instanceUrl,
  );
  const user = await client.getAuthenticatedUser();
  return user.username;
}

/**
 * Check the health of a single connector: re-authenticate (refresh) if the
 * access token is expired, then verify the credentials against the provider.
 *
 * Dependencies are injectable so the classification/orchestration logic can be
 * unit-tested without hitting the network or a live provider.
 */
export async function checkConnectionHealth(
  connection: ConnectionWithDecryptedToken,
  deps: {
    reauth?: (c: ConnectionWithDecryptedToken) => Promise<string>;
    verify?: (
      provider: string,
      accessToken: string,
      instanceUrl: string | null,
    ) => Promise<string | null>;
  } = {},
): Promise<ConnectorHealth> {
  const reauth = deps.reauth ?? ensureValidAccessToken;
  const verify = deps.verify ?? verifyConnectionCredentials;

  const base = {
    connectionId: connection.id,
    provider: connection.provider,
    instanceUrl: connection.instanceUrl,
    providerUsername: connection.providerUsername,
  };

  // Re-authenticate failed connections: refresh expired-but-refreshable tokens.
  let accessToken: string;
  try {
    accessToken = await reauth(connection);
  } catch (error) {
    // Refresh failed (e.g. an expired token with no refresh grant) — the user
    // must reconnect manually.
    return {
      ...base,
      status: "unhealthy",
      needsReauth: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Verify API credentials against the live provider.
  try {
    const username = await verify(
      connection.provider,
      accessToken,
      connection.instanceUrl,
    );
    return {
      ...base,
      providerUsername: username ?? connection.providerUsername,
      status: "healthy",
      needsReauth: false,
      error: null,
    };
  } catch (error) {
    return {
      ...base,
      status: "unhealthy",
      needsReauth: isAuthFailure(error),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Check the health of every active connector for a user. */
export async function checkAllConnectionsHealth(
  userId: string,
): Promise<ConnectorHealth[]> {
  const connections = await listConnectionsWithTokens(userId);
  return Promise.all(connections.map((c) => checkConnectionHealth(c)));
}
