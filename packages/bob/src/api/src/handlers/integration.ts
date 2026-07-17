import { TRPCError } from "@trpc/server";
import { and, eq } from "@bob/db";
import { workspaceIntegrations, workspaceMembers } from "@bob/db/schema";
import { LinearClient } from "@linear/sdk";

import type { HandlerContext } from "./context.js";

async function assertWorkspaceAccess(db: any, userId: string, workspaceId: string) {
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { id: true },
  });

  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

export async function integrationGet(
  ctx: HandlerContext,
  input: { workspaceId: string; provider: string },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);

  const integration = await ctx.db.query.workspaceIntegrations.findFirst({
    where: and(
      eq(workspaceIntegrations.workspaceId, input.workspaceId),
      eq(workspaceIntegrations.provider, input.provider),
    ),
  });

  if (!integration) return null;

  return {
    id: integration.id,
    provider: integration.provider,
    enabled: integration.enabled,
    hasApiKey: !!integration.apiKey,
    hasWebhookSecret: !!integration.webhookSigningSecret,
    linearTeamId: integration.linearTeamId,
    linearWebBaseUrl: integration.linearWebBaseUrl,
    createdAt: integration.createdAt,
  };
}

export async function integrationSave(
  ctx: HandlerContext,
  input: {
    workspaceId: string;
    provider: string;
    apiKey?: string;
    webhookSigningSecret?: string;
    linearTeamId?: string;
    linearWebBaseUrl?: string | null;
    enabled?: boolean;
  },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);

  const existing = await ctx.db.query.workspaceIntegrations.findFirst({
    where: and(
      eq(workspaceIntegrations.workspaceId, input.workspaceId),
      eq(workspaceIntegrations.provider, input.provider),
    ),
  });

  const updates: Record<string, unknown> = {};
  if (input.apiKey !== undefined) updates.apiKey = input.apiKey;
  if (input.webhookSigningSecret !== undefined) updates.webhookSigningSecret = input.webhookSigningSecret;
  if (input.linearTeamId !== undefined) updates.linearTeamId = input.linearTeamId;
  if (input.linearWebBaseUrl !== undefined) updates.linearWebBaseUrl = input.linearWebBaseUrl;
  if (input.enabled !== undefined) updates.enabled = input.enabled;

  if (existing) {
    await ctx.db
      .update(workspaceIntegrations)
      .set(updates)
      .where(eq(workspaceIntegrations.id, existing.id));

    return { id: existing.id, created: false };
  }

  const [created] = await ctx.db
    .insert(workspaceIntegrations)
    .values({
      workspaceId: input.workspaceId,
      provider: input.provider,
      enabled: input.enabled ?? true,
      apiKey: input.apiKey ?? null,
      webhookSigningSecret: input.webhookSigningSecret ?? null,
      linearTeamId: input.linearTeamId ?? null,
      linearWebBaseUrl: input.linearWebBaseUrl ?? null,
    })
    .returning({ id: workspaceIntegrations.id });

  return { id: created!.id, created: true };
}

export async function integrationDelete(
  ctx: HandlerContext,
  input: { workspaceId: string; provider: string },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);

  await ctx.db
    .delete(workspaceIntegrations)
    .where(
      and(
        eq(workspaceIntegrations.workspaceId, input.workspaceId),
        eq(workspaceIntegrations.provider, input.provider),
      ),
    );

  return { deleted: true };
}

export async function integrationSetupLinear(
  ctx: HandlerContext,
  input: {
    workspaceId: string;
    apiKey: string;
    teamId: string;
    webhookUrl: string;
  },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);

  const client = new LinearClient({ apiKey: input.apiKey });

  const teamsResult = await client.teams();
  const team = teamsResult.nodes.find((t) => t.id === input.teamId);
  if (!team) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Team not found" });
  }

  const webhookResult = await client.createWebhook({
    url: input.webhookUrl,
    teamId: input.teamId,
    label: "Bob (blder)",
    resourceTypes: ["Issue"],
    enabled: true,
  });

  if (!webhookResult.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Failed to create Linear webhook",
    });
  }

  const webhook = await webhookResult.webhook;
  if (!webhook) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Webhook created but could not retrieve details",
    });
  }

  const existing = await ctx.db.query.workspaceIntegrations.findFirst({
    where: and(
      eq(workspaceIntegrations.workspaceId, input.workspaceId),
      eq(workspaceIntegrations.provider, "linear"),
    ),
  });

  const values = {
    apiKey: input.apiKey,
    linearTeamId: input.teamId,
    webhookSigningSecret: (webhook as any).secret ?? null,
    linearWebBaseUrl: null,
    enabled: true,
  };

  if (existing) {
    await ctx.db
      .update(workspaceIntegrations)
      .set(values)
      .where(eq(workspaceIntegrations.id, existing.id));
    return { id: existing.id, created: false, webhookId: webhook.id };
  }

  const [created] = await ctx.db
    .insert(workspaceIntegrations)
    .values({
      workspaceId: input.workspaceId,
      provider: "linear",
      ...values,
    })
    .returning({ id: workspaceIntegrations.id });

  return { id: created!.id, created: true, webhookId: webhook.id };
}


export async function integrationFetchLinearTeams(
  _ctx: HandlerContext,
  input: { apiKey: string },
) {
  try {
    const client = new LinearClient({ apiKey: input.apiKey });
    const result = await client.teams();
    return result.nodes.map((t) => ({ id: t.id, name: t.name, key: t.key }));
  } catch (e: any) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: e?.message ?? "Invalid API key",
    });
  }
}

export async function integrationList(
  ctx: HandlerContext,
  input: { workspaceId: string },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);

  const integrations = await ctx.db.query.workspaceIntegrations.findMany({
    where: eq(workspaceIntegrations.workspaceId, input.workspaceId),
  });

  return integrations.map((i: any) => ({
    id: i.id,
    provider: i.provider,
    enabled: i.enabled,
    hasApiKey: !!i.apiKey,
    hasWebhookSecret: !!i.webhookSigningSecret,
    linearTeamId: i.linearTeamId,
    linearWebBaseUrl: i.linearWebBaseUrl,
    createdAt: i.createdAt,
  }));
}
