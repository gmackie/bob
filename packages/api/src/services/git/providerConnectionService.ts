import { and, eq, isNull } from "@bob/db";
import { db } from "@bob/db/client";
import { gitProviderConnections } from "@bob/db/schema";

import type { EncryptedToken } from "../crypto/tokenVault";
import type { GitProvider, GitProviderClient } from "./providers/types";
import { decryptToken, encryptToken } from "../crypto/tokenVault";
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
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  createdAt: Date;
}

export async function getConnection(
  userId: string,
  provider: GitProvider,
  instanceUrl?: string | null,
): Promise<ConnectionWithDecryptedToken | null> {
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

export async function listConnections(userId: string): Promise<
  Array<{
    id: string;
    provider: GitProvider;
    instanceUrl: string | null;
    providerAccountId: string;
    providerUsername: string | null;
    createdAt: Date;
  }>
> {
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
      accessTokenExpiresAt: params.accessTokenExpiresAt ?? null,
      refreshTokenExpiresAt: params.refreshTokenExpiresAt ?? null,
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
    .set({ revokedAt: new Date() })
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
      accessTokenExpiresAt: accessTokenExpiresAt ?? null,
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
  if (connection.accessTokenExpiresAt > fiveMinutesFromNow) {
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
