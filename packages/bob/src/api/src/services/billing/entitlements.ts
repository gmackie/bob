/**
 * Plan entitlements — the single source of truth for what each tenant plan is
 * allowed to do.
 *
 * `tenants.plan` (see `@bob/tenancy/schema`) is kept in sync with Stripe via
 * the billing webhook. This module turns that plan value into concrete
 * feature/limit answers that API procedures gate on. Keeping it dependency-free
 * (only the schema enum) means the same table can be reused by the web UI to
 * render upgrade prompts.
 */
import type { tenantPlanEnum } from "@bob/db/schema";

/** All tenant plans, lowest tier first. Derived from the DB enum. */
export type TenantPlan = (typeof tenantPlanEnum.enumValues)[number];

/**
 * Ordering of plans by capability. A plan "meets" another when its rank is
 * greater than or equal. Free is the implicit floor for tenants with no
 * subscription.
 */
export const PLAN_RANK: Record<TenantPlan, number> = {
  free: 0,
  premium: 1,
  pro: 2,
};

export const DEFAULT_PLAN: TenantPlan = "free";

/**
 * Paid features gated behind a plan. Adding a feature here and referencing it
 * from `requireFeature(...)` in a procedure is all that's needed to gate it.
 */
export type Feature =
  /** Third-party integrations (Linear, GitHub apps, etc.). */
  | "integrations"
  /** ForgeGraph pipeline orchestration. */
  | "forgegraph"
  /** Per-workspace custom agent configuration. */
  | "custom_agents"
  /** Priority dispatch / concurrent agent runs beyond the free ceiling. */
  | "priority_dispatch";

/** The minimum plan required for each feature. */
export const FEATURE_MIN_PLAN: Record<Feature, TenantPlan> = {
  integrations: "premium",
  custom_agents: "premium",
  forgegraph: "pro",
  priority_dispatch: "pro",
};

/** Numeric limits per plan. `Infinity` means unlimited. */
export interface PlanLimits {
  readonly maxWorkspaces: number;
  readonly maxConcurrentAgentRuns: number;
}

export const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  free: { maxWorkspaces: 1, maxConcurrentAgentRuns: 1 },
  premium: { maxWorkspaces: 10, maxConcurrentAgentRuns: 5 },
  pro: { maxWorkspaces: Infinity, maxConcurrentAgentRuns: 20 },
};

/** True when `plan` is at least as capable as `minimum`. */
export function planMeetsMinimum(
  plan: TenantPlan,
  minimum: TenantPlan,
): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[minimum];
}

/** True when `plan` is entitled to `feature`. */
export function planHasFeature(plan: TenantPlan, feature: Feature): boolean {
  return planMeetsMinimum(plan, FEATURE_MIN_PLAN[feature]);
}

/** The set of features a plan is entitled to, in declaration order. */
export function featuresForPlan(plan: TenantPlan): Feature[] {
  return (Object.keys(FEATURE_MIN_PLAN) as Feature[]).filter((f) =>
    planHasFeature(plan, f),
  );
}

/** Full entitlement snapshot for a plan — handy for the client. */
export function entitlementsForPlan(plan: TenantPlan) {
  return {
    plan,
    features: featuresForPlan(plan),
    limits: PLAN_LIMITS[plan],
  } as const;
}
