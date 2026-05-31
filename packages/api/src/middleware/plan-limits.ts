import { TRPCError } from "@trpc/server";

import { count, eq } from "@bob/db";
import {
  agentRuns,
  projects,
  runArtifacts,
  tenants,
  workspaces,
} from "@bob/db/schema";

export const PLAN_LIMITS = {
  free: {
    apps: 1,
    nodes: 1,
    storageWrites: 100,
  },
  premium: {
    apps: 10,
    nodes: 5,
    storageWrites: 10_000,
  },
  pro: {
    apps: null,
    nodes: null,
    storageWrites: null,
  },
} as const;

export type TenantPlan = keyof typeof PLAN_LIMITS;
export type PlanLimitedResource = keyof (typeof PLAN_LIMITS)["free"];

type Db = {
  select: (...args: any[]) => any;
};

function normalizePlan(plan: string | null | undefined): TenantPlan {
  if (plan === "premium" || plan === "pro") return plan;
  return "free";
}

function resourceLabel(resource: PlanLimitedResource): string {
  switch (resource) {
    case "apps":
      return "app";
    case "nodes":
      return "node";
    case "storageWrites":
      return "storage write";
  }
}

async function getTenantPlan(db: Db, tenantId: string): Promise<TenantPlan> {
  const [tenant] = await db
    .select({ plan: tenants.plan })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
  }

  return normalizePlan(tenant.plan);
}

async function getUsageCount(
  db: Db,
  tenantId: string,
  resource: PlanLimitedResource,
): Promise<number> {
  if (resource === "apps") {
    const [row] = await db
      .select({ count: count(projects.id) })
      .from(projects)
      .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
      .where(eq(workspaces.tenantId, tenantId));
    return Number(row?.count ?? 0);
  }

  if (resource === "nodes") {
    const [row] = await db
      .select({ count: count(workspaces.id) })
      .from(workspaces)
      .where(eq(workspaces.tenantId, tenantId));
    return Number(row?.count ?? 0);
  }

  const [row] = await db
    .select({ count: count(runArtifacts.id) })
    .from(runArtifacts)
    .innerJoin(agentRuns, eq(runArtifacts.runId, agentRuns.id))
    .where(eq(agentRuns.tenantId, tenantId));
  return Number(row?.count ?? 0);
}

export async function assertPlanLimitAvailable(
  db: Db,
  input: {
    tenantId: string;
    resource: PlanLimitedResource;
    plan?: string | null;
  },
) {
  const plan = input.plan
    ? normalizePlan(input.plan)
    : await getTenantPlan(db, input.tenantId);
  const limit = PLAN_LIMITS[plan][input.resource];

  if (limit === null) {
    return;
  }

  const usage = await getUsageCount(db, input.tenantId, input.resource);
  if (usage < limit) {
    return;
  }

  const label = resourceLabel(input.resource);
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `The ${plan} plan allows ${limit} ${label}${limit === 1 ? "" : "s"}. Upgrade the tenant plan or remove an existing ${label} before creating another.`,
  });
}
