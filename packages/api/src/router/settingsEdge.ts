/**
 * Edge-safe settings router for Cloudflare Workers.
 * DB-only procedures (no node:fs/node:os/node:path).
 * Config file operations stay in the full settings router.
 */
import { createHash, randomBytes } from "crypto";
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { and, eq, isNull, sql } from "@bob/db";
import {
  apiKeys,
  gitProviderConnections,
  UpdateUserPreferencesSchema,
  userPreferences,
} from "@bob/db/schema";

import {
  encryptToken,
  decryptToken,
  isEncryptionConfigured,
} from "../services/crypto/tokenVault";
import { protectedProcedure } from "../trpc";

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

export const settingsEdgeRouter: TRPCRouterRecord = {
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const prefs = await ctx.db.query.userPreferences.findFirst({
      where: eq(userPreferences.userId, ctx.session.user.id),
    });

    if (!prefs) {
      const [newPrefs] = await ctx.db
        .insert(userPreferences)
        .values({ userId: ctx.session.user.id })
        .returning();
      return newPrefs;
    }

    return prefs;
  }),

  updatePreferences: protectedProcedure
    .input(UpdateUserPreferencesSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.userPreferences.findFirst({
        where: eq(userPreferences.userId, ctx.session.user.id),
      });

      if (!existing) {
        const [newPrefs] = await ctx.db
          .insert(userPreferences)
          .values({ userId: ctx.session.user.id, ...input })
          .returning();
        return newPrefs;
      }

      const [updated] = await ctx.db
        .update(userPreferences)
        .set(input)
        .where(eq(userPreferences.userId, ctx.session.user.id))
        .returning();

      return updated;
    }),

  listApiKeys: protectedProcedure.query(async ({ ctx }) => {
    const keys = await ctx.db.query.apiKeys.findMany({
      where: and(
        eq(apiKeys.userId, ctx.session.user.id),
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
  }),

  createApiKey: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        permissions: z
          .array(z.enum(["read", "write", "delete", "admin"]))
          .min(1),
        expiresInDays: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const key = generateApiKey();
      const keyHash = hashApiKey(key);
      const keyPrefix = getKeyPrefix(key);

      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      const [created] = await ctx.db
        .insert(apiKeys)
        .values({
          userId: ctx.session.user.id,
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
    }),

  revokeApiKey: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [revoked] = await ctx.db
        .update(apiKeys)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(apiKeys.id, input.id),
            eq(apiKeys.userId, ctx.session.user.id),
            isNull(apiKeys.revokedAt),
          ),
        )
        .returning({ id: apiKeys.id });

      return { success: !!revoked };
    }),

  // ForgeGraph token management
  getForgeGraphConnection: protectedProcedure.query(async ({ ctx }) => {
    const connection = await ctx.db.query.gitProviderConnections.findFirst({
      where: and(
        eq(gitProviderConnections.userId, ctx.session.user.id),
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
  }),

  connectForgeGraph: protectedProcedure
    .input(
      z.object({
        apiToken: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isEncryptionConfigured()) {
        throw new Error("Token encryption not configured (GIT_TOKEN_ENCRYPTION_KEY)");
      }

      // Validate token by calling ForgeGraph API
      const fgServer = process.env.FORGEGRAPH_URL ?? "https://forge.gmac.io";
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
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(gitProviderConnections.userId, ctx.session.user.id),
            eq(gitProviderConnections.provider, "forgegraph"),
            isNull(gitProviderConnections.revokedAt),
          ),
        );

      // Create new connection with encrypted token
      const connectionId = crypto.randomUUID();
      const encrypted = encryptToken(input.apiToken, connectionId);

      await ctx.db.insert(gitProviderConnections).values({
        id: connectionId,
        userId: ctx.session.user.id,
        provider: "forgegraph",
        instanceUrl: fgServer,
        providerAccountId: String(fgUser.id ?? "unknown"),
        providerUsername: fgUser.login ?? null,
        accessTokenCiphertext: encrypted.ciphertext,
        accessTokenIv: encrypted.iv,
        accessTokenTag: encrypted.tag,
        scopes: "api",
      });

      return {
        id: connectionId,
        providerUsername: fgUser.login ?? null,
      };
    }),

  disconnectForgeGraph: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(gitProviderConnections)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(gitProviderConnections.userId, ctx.session.user.id),
          eq(gitProviderConnections.provider, "forgegraph"),
          isNull(gitProviderConnections.revokedAt),
        ),
      );

    return { success: true };
  }),
};
