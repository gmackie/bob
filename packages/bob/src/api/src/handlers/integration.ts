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

  const teamsRes = await linearGraphQL(input.apiKey, `{ teams { nodes { id name key } } }`);
  const teams = teamsRes.data?.teams?.nodes ?? [];
  const team = teams.find((t: any) => t.id === input.teamId);
  if (!team) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Team not found" });
  }

  const webhookRes = await linearGraphQL(input.apiKey, `
    mutation($url: String!, $teamId: String!, $label: String!) {
      webhookCreate(input: {
        url: $url,
        teamId: $teamId,
        label: $label,
        resourceTypes: ["Issue"]
        enabled: true
      }) {
        success
        webhook { id enabled secret }
      }
    }
  `, { url: input.webhookUrl, teamId: input.teamId, label: "blder.bot" });

  const webhook = webhookRes.data?.webhookCreate;
  if (!webhook?.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Failed to create Linear webhook",
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
    webhookSigningSecret: webhook.webhook.secret,
    enabled: true,
  };

  if (existing) {
    await ctx.db
      .update(workspaceIntegrations)
      .set(values)
      .where(eq(workspaceIntegrations.id, existing.id));
    return { id: existing.id, created: false, webhookId: webhook.webhook.id };
  }

  const [created] = await ctx.db
    .insert(workspaceIntegrations)
    .values({
      workspaceId: input.workspaceId,
      provider: "linear",
      ...values,
    })
    .returning({ id: workspaceIntegrations.id });

  return { id: created!.id, created: true, webhookId: webhook.webhook.id };
}

async function linearGraphQL(apiKey: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Linear API error: ${res.status}`,
    });
  }

  const data = await res.json() as any;
  if (data.errors?.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: data.errors[0].message,
    });
  }

  return data;
}

export async function integrationFetchLinearTeams(
  _ctx: HandlerContext,
  input: { apiKey: string },
) {
  const data = await linearGraphQL(input.apiKey, `{ teams { nodes { id name key } } }`);
  return data.data?.teams?.nodes ?? [];
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
