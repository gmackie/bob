import { TRPCError } from "@trpc/server";
import { and, eq } from "@bob/db";
import { workspaceIntegrations, workspaceMembers } from "@bob/db/schema";

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
    createdAt: i.createdAt,
  }));
}
