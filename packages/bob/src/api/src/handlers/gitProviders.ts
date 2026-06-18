/**
 * Git providers handler functions — pure business logic extracted from the
 * tRPC gitProviders router.
 *
 * Phase 7B-4D-beta Task 4.
 */
import { TRPCError } from "@trpc/server";
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

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Helpers (moved verbatim from the router)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function gitProvidersListConnections(
  ctx: HandlerContext,
  _input: void,
) {
  const connections = await listConnections(ctx.userId);
  return connections;
}

export async function gitProvidersConnectPat(
  ctx: HandlerContext,
  input: {
    provider: "github" | "gitlab" | "gitea";
    accessToken: string;
    instanceUrl?: string;
  },
) {
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
    userId: ctx.userId,
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
}

export async function gitProvidersDisconnect(
  ctx: HandlerContext,
  input: { connectionId: string },
) {
  const revoked = await revokeConnection(
    ctx.userId,
    input.connectionId,
  );

  if (!revoked) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Connection not found or already revoked",
    });
  }

  return { success: true };
}

export async function gitProvidersTestConnection(
  ctx: HandlerContext,
  input: {
    connectionId?: string;
    provider?: "github" | "gitlab" | "gitea";
    instanceUrl?: string;
  },
) {
  let provider: GitProvider;
  let instanceUrl: string | null = null;

  if (input.connectionId) {
    const existing = await listConnections(ctx.userId);
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
    ctx.userId,
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
}

export async function gitProvidersSetDefaultForRepo(
  ctx: HandlerContext,
  input: { repositoryId: string; connectionId: string },
) {
  const connections = await listConnections(ctx.userId);
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
        eq(repositories.userId, ctx.userId),
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
}

export async function gitProvidersDetectRemote(
  ctx: HandlerContext,
  input: { repositoryId: string },
) {
  const repo = await ctx.db.query.repositories.findFirst({
    where: and(
      eq(repositories.id, input.repositoryId),
      eq(repositories.userId, ctx.userId),
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
}
