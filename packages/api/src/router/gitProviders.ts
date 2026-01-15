import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, eq } from "@bob/db";
import { repositories } from "@bob/db/schema";

import type { GitProvider } from "../services/git/providers/types";
import {
  createConnection,
  createProviderClient,
  getConnection,
  listConnections,
  revokeConnection,
} from "../services/git/providerConnectionService";
import { protectedProcedure } from "../trpc";

const gitProviderSchema = z.enum(["github", "gitlab", "gitea"]);

export const gitProvidersRouter = {
  listConnections: protectedProcedure.query(async ({ ctx }) => {
    const connections = await listConnections(ctx.session.user.id);
    return connections;
  }),

  connectPat: protectedProcedure
    .input(
      z.object({
        provider: gitProviderSchema,
        accessToken: z.string().min(1),
        instanceUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const provider = input.provider as GitProvider;

      if (provider === "gitea" && !input.instanceUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Gitea requires an instance URL",
        });
      }

      const client = createProviderClient(
        provider,
        input.accessToken,
        input.instanceUrl,
      );

      let user;
      try {
        user = await client.getAuthenticatedUser();
      } catch (error) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: `Invalid token: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }

      const connectionId = await createConnection({
        userId: ctx.session.user.id,
        provider,
        instanceUrl: input.instanceUrl ?? null,
        providerAccountId: user.id,
        providerUsername: user.username,
        accessToken: input.accessToken,
      });

      return {
        id: connectionId,
        provider,
        instanceUrl: input.instanceUrl ?? null,
        providerAccountId: user.id,
        providerUsername: user.username,
      };
    }),

  disconnect: protectedProcedure
    .input(z.object({ connectionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const revoked = await revokeConnection(
        ctx.session.user.id,
        input.connectionId,
      );

      if (!revoked) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Connection not found or already revoked",
        });
      }

      return { success: true };
    }),

  testConnection: protectedProcedure
    .input(
      z.object({
        connectionId: z.string().uuid().optional(),
        provider: gitProviderSchema.optional(),
        instanceUrl: z.string().url().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      let provider: GitProvider;
      let instanceUrl: string | null = null;

      if (input.connectionId) {
        const existing = await listConnections(ctx.session.user.id);
        const connection = existing.find((c) => c.id === input.connectionId);
        if (!connection) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Connection not found",
          });
        }
        provider = connection.provider;
        instanceUrl = connection.instanceUrl;
      } else if (input.provider) {
        provider = input.provider as GitProvider;
        instanceUrl = input.instanceUrl ?? null;
      } else {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Either connectionId or provider must be provided",
        });
      }

      const conn = await getConnection(
        ctx.session.user.id,
        provider,
        instanceUrl,
      );
      if (!conn) {
        return { valid: false, error: "No connection found" };
      }

      try {
        const client = createProviderClient(
          provider,
          conn.accessToken,
          instanceUrl,
        );
        const user = await client.getAuthenticatedUser();
        return {
          valid: true,
          user: {
            id: user.id,
            username: user.username,
            name: user.name,
            avatarUrl: user.avatarUrl,
          },
        };
      } catch (error) {
        return {
          valid: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

  setDefaultForRepo: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string().uuid(),
        connectionId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const connections = await listConnections(ctx.session.user.id);
      const connection = connections.find((c) => c.id === input.connectionId);

      if (!connection) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Connection not found",
        });
      }

      const [updated] = await ctx.db
        .update(repositories)
        .set({
          gitProviderConnectionId: input.connectionId,
          remoteProvider: connection.provider,
          remoteInstanceUrl: connection.instanceUrl,
        })
        .where(
          and(
            eq(repositories.id, input.repositoryId),
            eq(repositories.userId, ctx.session.user.id),
          ),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Repository not found",
        });
      }

      return { success: true };
    }),

  detectRemote: protectedProcedure
    .input(z.object({ repositoryId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const repo = await ctx.db.query.repositories.findFirst({
        where: and(
          eq(repositories.id, input.repositoryId),
          eq(repositories.userId, ctx.session.user.id),
        ),
      });

      if (!repo) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Repository not found",
        });
      }

      if (repo.remoteUrl) {
        const parsed = parseRemoteUrl(repo.remoteUrl);
        return {
          detected: true,
          remoteUrl: repo.remoteUrl,
          ...parsed,
        };
      }

      return { detected: false };
    }),
} satisfies TRPCRouterRecord;

function parseRemoteUrl(url: string): {
  provider: GitProvider | null;
  instanceUrl: string | null;
  owner: string | null;
  name: string | null;
} {
  try {
    let parsed: URL;
    if (url.startsWith("git@")) {
      const match = url.match(/^git@([^:]+):(.+)\.git$/);
      if (!match)
        return { provider: null, instanceUrl: null, owner: null, name: null };
      const [, host, path] = match;
      parsed = new URL(`https://${host}/${path}`);
    } else {
      parsed = new URL(url.replace(/\.git$/, ""));
    }

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) {
      return { provider: null, instanceUrl: null, owner: null, name: null };
    }

    const owner = pathParts[0]!;
    const name = pathParts[1]!;
    const host = parsed.hostname.toLowerCase();

    let provider: GitProvider | null = null;
    let instanceUrl: string | null = null;

    if (host === "github.com") {
      provider = "github";
    } else if (host === "gitlab.com") {
      provider = "gitlab";
    } else if (host.includes("gitlab")) {
      provider = "gitlab";
      instanceUrl = `${parsed.protocol}//${parsed.host}`;
    } else if (host.includes("gitea") || host.includes("forgejo")) {
      provider = "gitea";
      instanceUrl = `${parsed.protocol}//${parsed.host}`;
    }

    return { provider, instanceUrl, owner, name };
  } catch {
    return { provider: null, instanceUrl: null, owner: null, name: null };
  }
}
