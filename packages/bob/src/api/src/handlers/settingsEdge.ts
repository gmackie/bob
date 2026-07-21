/**
 * Settings-edge handler functions — pure business logic extracted from the
 * tRPC settingsEdge router.
 *
 * Phase 7B-4D-beta Task 5.
 */
import { createHash, randomBytes } from "crypto";
import { and, eq, isNull, sql } from "@bob/db";
import {
  apiKeys,
  gitProviderConnections,
  userPreferences,
} from "@bob/db/schema";

import {
  encryptToken,
  isEncryptionConfigured,
} from "../services/crypto/tokenVault";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function generateApiKey(): string {
  const prefix = "bob_";
  const bytes = randomBytes(32);
  return prefix + bytes.toString("hex").slice(0, 48);
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function getKeyPrefix(key: string): string {
  return key.substring(0, 12);
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function settingsEdgeGetPreferences(
  ctx: HandlerContext,
  _input: void,
) {
  const prefs = await ctx.db.query.userPreferences.findFirst({
    where: eq(userPreferences.userId, ctx.userId),
  });

  if (!prefs) {
    const [newPrefs] = await ctx.db
      .insert(userPreferences)
      .values({ userId: ctx.userId })
      .returning();
    return newPrefs;
  }

  return prefs;
}

export async function settingsEdgeUpdatePreferences(
  ctx: HandlerContext,
  input: Record<string, unknown>,
) {
  const existing = await ctx.db.query.userPreferences.findFirst({
    where: eq(userPreferences.userId, ctx.userId),
  });

  if (!existing) {
    const [newPrefs] = await ctx.db
      .insert(userPreferences)
      .values({ userId: ctx.userId, ...input })
      .returning();
    return newPrefs;
  }

  const [updated] = await ctx.db
    .update(userPreferences)
    .set(input)
    .where(eq(userPreferences.userId, ctx.userId))
    .returning();

  return updated;
}

export async function settingsEdgeListApiKeys(
  ctx: HandlerContext,
  _input: void,
) {
  const keys = await ctx.db.query.apiKeys.findMany({
    where: and(
      eq(apiKeys.userId, ctx.userId),
      isNull(apiKeys.revokedAt),
    ),
    columns: {
      id: true,
      name: true,
      keyPrefix: true,
      permissions: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: (keys, { desc }) => [desc(keys.createdAt)],
  });

  return keys;
}

export async function settingsEdgeCreateApiKey(
  ctx: HandlerContext,
  input: {
    name: string;
    permissions: ("read" | "write" | "delete" | "admin")[];
    expiresInDays?: number;
  },
) {
  const { assertWithinQuotaOrThrow } = await import("../services/quotas/index.js");
  await assertWithinQuotaOrThrow({
    db: ctx.db,
    userId: ctx.userId,
    metric: "apiKeys",
  });

  const key = generateApiKey();
  const keyHash = hashApiKey(key);
  const keyPrefix = getKeyPrefix(key);

  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const [created] = await ctx.db
    .insert(apiKeys)
    .values({
      userId: ctx.userId,
      name: input.name,
      keyHash,
      keyPrefix,
      permissions: input.permissions,
      expiresAt,
    })
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      permissions: apiKeys.permissions,
      expiresAt: apiKeys.expiresAt,
    });

  return {
    ...created,
    key,
  };
}

export async function settingsEdgeRevokeApiKey(
  ctx: HandlerContext,
  input: { id: string },
) {
  const [revoked] = await ctx.db
    .update(apiKeys)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(apiKeys.id, input.id),
        eq(apiKeys.userId, ctx.userId),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id });

  return { success: !!revoked };
}

export async function settingsEdgeGetForgeGraphConnection(
  ctx: HandlerContext,
  _input: void,
) {
  const connection = await ctx.db.query.gitProviderConnections.findFirst({
    where: and(
      eq(gitProviderConnections.userId, ctx.userId),
      eq(gitProviderConnections.provider, "forgegraph"),
      isNull(gitProviderConnections.revokedAt),
    ),
    columns: {
      id: true,
      providerUsername: true,
      createdAt: true,
    },
  });

  return connection ?? null;
}

export async function settingsEdgeConnectForgeGraph(
  ctx: HandlerContext,
  input: { apiToken: string },
) {
  if (!isEncryptionConfigured()) {
    throw new Error("Token encryption not configured (GIT_TOKEN_ENCRYPTION_KEY)");
  }

  // Validate token by calling ForgeGraph API
  const fgServer = process.env.FORGEGRAPH_URL ?? process.env.FG_API_URL ?? "https://forgegraf.com";
  const resp = await fetch(`${fgServer}/api/fg/apps`, {
    headers: { Authorization: `Bearer ${input.apiToken}` },
  });

  if (!resp.ok) {
    throw new Error("Invalid ForgeGraph API token");
  }

  // ForgeGraph doesn't expose a /user endpoint — use token prefix as identity
  const fgUser = { login: "forgegraph", id: 0 };

  // Revoke existing connection if any
  await ctx.db
    .update(gitProviderConnections)
    .set({ revokedAt: new Date().toISOString() })
    .where(
      and(
        eq(gitProviderConnections.userId, ctx.userId),
        eq(gitProviderConnections.provider, "forgegraph"),
        isNull(gitProviderConnections.revokedAt),
      ),
    );

  // Create new connection with encrypted token
  const connectionId = crypto.randomUUID();
  const encrypted = encryptToken(input.apiToken, connectionId);

  await ctx.db.insert(gitProviderConnections).values({
    id: connectionId,
    userId: ctx.userId,
    provider: "forgegraph",
    instanceUrl: fgServer,
    providerAccountId: String(fgUser.id),
    providerUsername: fgUser.login,
    accessTokenCiphertext: encrypted.ciphertext,
    accessTokenIv: encrypted.iv,
    accessTokenTag: encrypted.tag,
    scopes: "api",
  });

  return {
    id: connectionId,
    providerUsername: fgUser.login,
  };
}

export async function settingsEdgeDisconnectForgeGraph(
  ctx: HandlerContext,
  _input: void,
) {
  await ctx.db
    .update(gitProviderConnections)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(gitProviderConnections.userId, ctx.userId),
        eq(gitProviderConnections.provider, "forgegraph"),
        isNull(gitProviderConnections.revokedAt),
      ),
    );

  return { success: true };
}
