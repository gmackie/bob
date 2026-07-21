/**
 * Measure current tenant usage against plan quotas.
 *
 * Counts are derived from live tables (no separate counter table) so they stay
 * consistent after deletes/revokes. Monthly meters (task runs, webhook volume)
 * use the UTC calendar month of `now`.
 */
import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNull,
  or,
  sql,
} from "@bob/db";
import type { Db } from "@bob/db/client";
import {
  agentInstances,
  agentRuns,
  apiKeys,
  runArtifacts,
  taskRuns,
  tenantMembers,
  tenants,
  webhookConfigs,
  webhookDeliveries,
  workItemArtifacts,
  workItems,
  workspaces,
} from "@bob/db/schema";
import type {
  PlanQuotas,
  QuotaMetric,
  TenantPlan,
} from "@bob/tenancy/plan-limits";
import {
  DEFAULT_PLAN,
  isTenantPlan,
  quotasForPlan,
} from "@bob/tenancy/plan-limits";

/** Bytes assumed for a run artifact when metadata does not carry a size. */
const DEFAULT_RUN_ARTIFACT_BYTES = 1024;

export interface TenantUsage {
  readonly tenantId: string;
  readonly plan: TenantPlan;
  readonly limits: PlanQuotas;
  readonly usage: Readonly<Record<QuotaMetric, number>>;
  /** ISO timestamp of the measurement. */
  readonly measuredAt: string;
  /** Start of the UTC month used for monthly meters. */
  readonly periodStart: string;
}

export function startOfUtcMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function resolvePlan(db: Db, tenantId: string): Promise<TenantPlan> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { plan: true },
  });
  const plan = tenant?.plan;
  return isTenantPlan(plan) ? plan : DEFAULT_PLAN;
}

async function countSeats(db: Db, tenantId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(tenantMembers)
    .where(eq(tenantMembers.tenantId, tenantId));
  return Number(row?.n ?? 0);
}

/**
 * Active agents = agent instances in running/starting + agent runs still
 * queued or running for workspaces under the tenant.
 */
async function countActiveAgents(db: Db, tenantId: string): Promise<number> {
  const tenantWorkspaces = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.tenantId, tenantId));
  const workspaceIds = tenantWorkspaces.map((w) => w.id);

  let instanceCount = 0;
  if (workspaceIds.length > 0) {
    // agentInstances are not tenant-scoped directly; count via repos under
    // tenant workspaces is heavy. Use userIds of tenant members instead so
    // any running instance owned by a seat counts against the tenant.
    const members = await db
      .select({ userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(eq(tenantMembers.tenantId, tenantId));
    const userIds = members.map((m) => m.userId);
    if (userIds.length > 0) {
      const [row] = await db
        .select({ n: count() })
        .from(agentInstances)
        .where(
          and(
            inArray(agentInstances.userId, userIds),
            or(
              eq(agentInstances.status, "running"),
              eq(agentInstances.status, "starting"),
            ),
          ),
        );
      instanceCount = Number(row?.n ?? 0);
    }
  }

  const [runRow] = await db
    .select({ n: count() })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.tenantId, tenantId),
        or(eq(agentRuns.status, "queued"), eq(agentRuns.status, "running")),
      ),
    );

  return instanceCount + Number(runRow?.n ?? 0);
}

async function countTaskRunsThisMonth(
  db: Db,
  tenantId: string,
  periodStart: Date,
): Promise<number> {
  const members = await db
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(eq(tenantMembers.tenantId, tenantId));
  const userIds = members.map((m) => m.userId);

  let taskRunCount = 0;
  if (userIds.length > 0) {
    const [row] = await db
      .select({ n: count() })
      .from(taskRuns)
      .where(
        and(
          inArray(taskRuns.userId, userIds),
          gte(taskRuns.createdAt, periodStart.toISOString()),
        ),
      );
    taskRunCount = Number(row?.n ?? 0);
  }

  const [agentRunRow] = await db
    .select({ n: count() })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.tenantId, tenantId),
        gte(agentRuns.createdAt, periodStart.toISOString()),
      ),
    );

  return taskRunCount + Number(agentRunRow?.n ?? 0);
}

/**
 * Storage footprint:
 * - work_item_artifacts: UTF-8 length of content + summary for items in
 *   tenant workspaces (via workItems.workspaceId)
 * - run_artifacts: metadata.sizeBytes when present, else 1 KiB default
 */
async function countStorageBytes(db: Db, tenantId: string): Promise<number> {
  const [runBytes] = await db
    .select({
      n: sql<number>`coalesce(sum(
        case
          when (${runArtifacts.metadata} ->> 'sizeBytes') ~ '^[0-9]+$'
            then (${runArtifacts.metadata} ->> 'sizeBytes')::bigint
          else ${DEFAULT_RUN_ARTIFACT_BYTES}
        end
      ), 0)`.mapWith(Number),
    })
    .from(runArtifacts)
    .innerJoin(agentRuns, eq(runArtifacts.runId, agentRuns.id))
    .where(eq(agentRuns.tenantId, tenantId));

  // work_item_artifacts → work_items → workspaces.tenant_id
  const [wiBytes] = await db
    .select({
      n: sql<number>`coalesce(sum(
        coalesce(length(${workItemArtifacts.content}), 0)
        + coalesce(length(${workItemArtifacts.summary}), 0)
      ), 0)`.mapWith(Number),
    })
    .from(workItemArtifacts)
    .innerJoin(workItems, eq(workItemArtifacts.workItemId, workItems.id))
    .innerJoin(workspaces, eq(workspaces.id, workItems.workspaceId))
    .where(eq(workspaces.tenantId, tenantId));

  return Number(runBytes?.n ?? 0) + Number(wiBytes?.n ?? 0);
}

async function countApiKeys(db: Db, tenantId: string): Promise<number> {
  const members = await db
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(eq(tenantMembers.tenantId, tenantId));
  const userIds = members.map((m) => m.userId);
  if (userIds.length === 0) return 0;

  const [row] = await db
    .select({ n: count() })
    .from(apiKeys)
    .where(and(inArray(apiKeys.userId, userIds), isNull(apiKeys.revokedAt)));
  return Number(row?.n ?? 0);
}

async function countWebhookVolumeThisMonth(
  db: Db,
  tenantId: string,
  periodStart: Date,
): Promise<number> {
  const members = await db
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(eq(tenantMembers.tenantId, tenantId));
  const userIds = members.map((m) => m.userId);
  if (userIds.length === 0) return 0;

  const configs = await db
    .select({ id: webhookConfigs.id })
    .from(webhookConfigs)
    .where(inArray(webhookConfigs.userId, userIds));
  if (configs.length === 0) return 0;

  const configIds = configs.map((c) => c.id);
  const [row] = await db
    .select({ n: count() })
    .from(webhookDeliveries)
    .where(
      and(
        inArray(webhookDeliveries.webhookConfigId, configIds),
        gte(webhookDeliveries.receivedAt, periodStart.toISOString()),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Measure all quota meters for a tenant. */
export async function measureTenantUsage(
  db: Db,
  tenantId: string,
  now: Date = new Date(),
): Promise<TenantUsage> {
  const periodStart = startOfUtcMonth(now);
  const plan = await resolvePlan(db, tenantId);
  const limits = quotasForPlan(plan);

  const [seats, activeAgents, taskRunsCount, storageBytes, apiKeysCount, webhookVolume] =
    await Promise.all([
      countSeats(db, tenantId),
      countActiveAgents(db, tenantId),
      countTaskRunsThisMonth(db, tenantId, periodStart),
      countStorageBytes(db, tenantId),
      countApiKeys(db, tenantId),
      countWebhookVolumeThisMonth(db, tenantId, periodStart),
    ]);

  const usage: Record<QuotaMetric, number> = {
    seats,
    activeAgents,
    taskRuns: taskRunsCount,
    storageBytes,
    apiKeys: apiKeysCount,
    webhookVolume,
  };

  return {
    tenantId,
    plan,
    limits,
    usage,
    measuredAt: now.toISOString(),
    periodStart: periodStart.toISOString(),
  };
}

/** Resolve the caller's primary tenant id, or null when none exists yet. */
export async function resolveUserTenantId(
  db: Db,
  userId: string,
): Promise<string | null> {
  const membership = await db.query.tenantMembers.findFirst({
    where: eq(tenantMembers.userId, userId),
    columns: { tenantId: true },
  });
  return membership?.tenantId ?? null;
}
