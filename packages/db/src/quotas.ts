import { and, eq, gte, inArray, isNull } from "drizzle-orm";

import {
  agentRuns,
  apiKeys,
  chatConversations,
  runArtifacts,
  taskRuns,
  tenantMembers,
  tenants,
  webhookConfigs,
  webhookDeliveries,
  workItemArtifacts,
  workItems,
  workspaces,
} from "./schema";

export type TenantPlan = "free" | "premium" | "pro";

export type QuotaName =
  | "seats"
  | "activeAgents"
  | "monthlyTaskRuns"
  | "artifacts"
  | "apiKeys"
  | "monthlyWebhookDeliveries";

export type PlanQuotas = Record<QuotaName, number | null>;

export const PLAN_QUOTAS: Record<TenantPlan, PlanQuotas> = {
  free: {
    seats: 1,
    activeAgents: 1,
    monthlyTaskRuns: 25,
    artifacts: 100,
    apiKeys: 2,
    monthlyWebhookDeliveries: 100,
  },
  premium: {
    seats: 5,
    activeAgents: 3,
    monthlyTaskRuns: 500,
    artifacts: 2_000,
    apiKeys: 10,
    monthlyWebhookDeliveries: 5_000,
  },
  pro: {
    seats: 25,
    activeAgents: 10,
    monthlyTaskRuns: 5_000,
    artifacts: 25_000,
    apiKeys: 50,
    monthlyWebhookDeliveries: 50_000,
  },
};

export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED";

  constructor(
    readonly quota: QuotaName,
    readonly limit: number,
  ) {
    super(`Tenant quota exceeded for ${quota} (limit ${limit})`);
  }
}

function monthStartIso(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
}

function getLimit(plan: TenantPlan, quota: QuotaName) {
  return PLAN_QUOTAS[plan][quota];
}

async function findTenant(db: any, tenantId: string) {
  if (!db.query?.tenants?.findFirst) return null;

  return db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { id: true, plan: true },
  });
}

async function findWorkspaceTenantId(db: any, workspaceId: string) {
  if (!db.query?.workspaces?.findFirst) return null;

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: { tenantId: true },
  });

  return workspace?.tenantId ?? null;
}

async function findUserTenant(db: any, userId: string) {
  if (!db.query?.tenantMembers?.findFirst) return null;

  const membership = await db.query.tenantMembers.findFirst({
    where: eq(tenantMembers.userId, userId),
    with: { tenant: true },
  });

  return membership?.tenant ?? null;
}

async function findTenantWorkspaceIds(db: any, tenantId: string) {
  if (!db.query?.workspaces?.findMany) return [];

  const rows = await db.query.workspaces.findMany({
    where: eq(workspaces.tenantId, tenantId),
    columns: { id: true },
  });

  return rows.map((row: { id: string }) => row.id);
}

async function findTenantWorkItemIds(db: any, tenantId: string) {
  if (!db.query?.workItems?.findMany) return [];

  const workspaceIds = await findTenantWorkspaceIds(db, tenantId);
  if (workspaceIds.length === 0) return [];

  const rows = await db.query.workItems.findMany({
    where: inArray(workItems.workspaceId, workspaceIds),
    columns: { id: true },
  });

  return rows.map((row: { id: string }) => row.id);
}

async function findTenantAgentRunIds(db: any, tenantId: string) {
  if (!db.query?.agentRuns?.findMany) return [];

  const rows = await db.query.agentRuns.findMany({
    where: eq(agentRuns.tenantId, tenantId),
    columns: { id: true },
  });

  return rows.map((row: { id: string }) => row.id);
}

async function getTenantUsage(db: any, tenantId: string, quota: QuotaName) {
  if (quota === "seats") {
    if (!db.query?.tenantMembers?.findMany) return 0;

    return (
      await db.query.tenantMembers.findMany({
        where: eq(tenantMembers.tenantId, tenantId),
        columns: { id: true },
      })
    ).length;
  }

  if (quota === "activeAgents") {
    const workspaceIds = await findTenantWorkspaceIds(db, tenantId);
    const workItemIds = await findTenantWorkItemIds(db, tenantId);
    const activeSessions =
      !db.query?.chatConversations?.findMany || workspaceIds.length === 0
        ? []
        : await db.query.chatConversations.findMany({
            where: and(
              inArray(chatConversations.planningWorkspaceId, workspaceIds),
              inArray(chatConversations.status, [
                "pending",
                "provisioning",
                "running",
              ]),
            ),
            columns: { id: true },
          });
    const activeTaskRuns =
      !db.query?.taskRuns?.findMany || workItemIds.length === 0
        ? []
        : await db.query.taskRuns.findMany({
            where: and(
              inArray(taskRuns.workItemId, workItemIds),
              inArray(taskRuns.status, ["starting", "running"]),
            ),
            columns: { id: true },
          });
    const activeRuns = !db.query?.agentRuns?.findMany
      ? []
      : await db.query.agentRuns.findMany({
          where: and(
            eq(agentRuns.tenantId, tenantId),
            inArray(agentRuns.status, ["queued", "running"]),
          ),
          columns: { id: true },
        });

    return activeSessions.length + activeTaskRuns.length + activeRuns.length;
  }

  if (quota === "monthlyTaskRuns") {
    const since = monthStartIso();
    const workItemIds = await findTenantWorkItemIds(db, tenantId);
    const localRuns =
      !db.query?.taskRuns?.findMany || workItemIds.length === 0
        ? []
        : await db.query.taskRuns.findMany({
            where: and(
              inArray(taskRuns.workItemId, workItemIds),
              gte(taskRuns.createdAt, since),
            ),
            columns: { id: true },
          });
    const publicRuns = !db.query?.agentRuns?.findMany
      ? []
      : await db.query.agentRuns.findMany({
          where: and(
            eq(agentRuns.tenantId, tenantId),
            gte(agentRuns.createdAt, since),
          ),
          columns: { id: true },
        });

    return localRuns.length + publicRuns.length;
  }

  if (quota === "artifacts") {
    const workItemIds = await findTenantWorkItemIds(db, tenantId);
    const agentRunIds = await findTenantAgentRunIds(db, tenantId);
    const workItemArtifactRows =
      !db.query?.workItemArtifacts?.findMany || workItemIds.length === 0
        ? []
        : await db.query.workItemArtifacts.findMany({
            where: inArray(workItemArtifacts.workItemId, workItemIds),
            columns: { id: true },
          });
    const runArtifactRows =
      !db.query?.runArtifacts?.findMany || agentRunIds.length === 0
        ? []
        : await db.query.runArtifacts.findMany({
            where: inArray(runArtifacts.runId, agentRunIds),
            columns: { id: true },
          });

    return workItemArtifactRows.length + runArtifactRows.length;
  }

  if (quota === "apiKeys") {
    if (!db.query?.tenantMembers?.findMany || !db.query?.apiKeys?.findMany) {
      return 0;
    }

    const members = await db.query.tenantMembers.findMany({
      where: eq(tenantMembers.tenantId, tenantId),
      columns: { userId: true },
    });
    const userIds = members.map((member: { userId: string }) => member.userId);
    if (userIds.length === 0) return 0;

    return (
      await db.query.apiKeys.findMany({
        where: and(inArray(apiKeys.userId, userIds), isNull(apiKeys.revokedAt)),
        columns: { id: true },
      })
    ).length;
  }

  const since = monthStartIso();
  const workspaceIds = await findTenantWorkspaceIds(db, tenantId);
  if (
    workspaceIds.length === 0 ||
    !db.query?.webhookConfigs?.findMany ||
    !db.query?.webhookDeliveries?.findMany
  ) {
    return 0;
  }

  const configs = await db.query.webhookConfigs.findMany({
    where: inArray(webhookConfigs.workspaceId, workspaceIds),
    columns: { id: true },
  });
  const configIds = configs.map((config: { id: string }) => config.id);
  if (configIds.length === 0) return 0;

  return (
    await db.query.webhookDeliveries.findMany({
      where: and(
        inArray(webhookDeliveries.webhookConfigId, configIds),
        gte(webhookDeliveries.receivedAt, since),
      ),
      columns: { id: true },
    })
  ).length;
}

export async function assertTenantQuota(
  db: any,
  tenantId: string | null | undefined,
  quota: QuotaName,
  increment = 1,
) {
  if (!tenantId) return;

  const tenant = await findTenant(db, tenantId);
  if (!tenant) return;

  const limit = getLimit(tenant.plan as TenantPlan, quota);
  if (limit === null) return;

  const usage = await getTenantUsage(db, tenantId, quota);
  if (usage + increment > limit) {
    throw new QuotaExceededError(quota, limit);
  }
}

export async function assertWorkspaceQuota(
  db: any,
  workspaceId: string | null | undefined,
  quota: QuotaName,
  increment = 1,
) {
  if (!workspaceId) return;

  const tenantId = await findWorkspaceTenantId(db, workspaceId);
  await assertTenantQuota(db, tenantId, quota, increment);
}

export async function assertUserQuota(
  db: any,
  userId: string,
  quota: QuotaName,
  increment = 1,
) {
  const tenant = await findUserTenant(db, userId);
  if (!tenant && quota === "apiKeys" && db.query?.apiKeys?.findMany) {
    const limit = getLimit("free", quota);
    if (limit === null) return;

    const usage = (
      await db.query.apiKeys.findMany({
        where: and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)),
        columns: { id: true },
      })
    ).length;
    if (usage + increment > limit) {
      throw new QuotaExceededError(quota, limit);
    }
    return;
  }

  await assertTenantQuota(db, tenant?.id, quota, increment);
}
