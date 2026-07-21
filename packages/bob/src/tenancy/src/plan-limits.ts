/**
 * Plan usage limits — single source of truth for per-tenant quotas.
 *
 * `tenants.plan` (`free` | `premium` | `pro`) drives these numbers. The billing
 * pipeline (when enabled) keeps `tenants.plan` in sync with Stripe; this module
 * is deliberately free of Stripe/DB so it can be shared by API enforcement,
 * the execution daemon, and UI upgrade prompts.
 *
 * Keep the plan name set in sync with `tenantPlanEnum` in `./schema.ts`.
 */

/** All tenant plans, lowest tier first. Must match `tenant_plan` enum. */
export const TENANT_PLANS = ["free", "premium", "pro"] as const;
export type TenantPlan = (typeof TENANT_PLANS)[number];

export const DEFAULT_PLAN: TenantPlan = "free";

export const PLAN_RANK: Record<TenantPlan, number> = {
  free: 0,
  premium: 1,
  pro: 2,
};

/**
 * Metered resources enforced by plan. Values are hard ceilings; `Infinity`
 * means unlimited for that plan.
 */
export type QuotaMetric =
  /** Tenant seats (tenant_members rows). */
  | "seats"
  /** Concurrent active agent instances / in-flight agent runs. */
  | "activeAgents"
  /** Task / agent runs created in the current calendar month (UTC). */
  | "taskRuns"
  /** Approximate artifact/storage footprint in bytes. */
  | "storageBytes"
  /** Non-revoked API keys owned by tenant members. */
  | "apiKeys"
  /** Outbound + inbound webhook deliveries in the current calendar month (UTC). */
  | "webhookVolume";

export const QUOTA_METRICS: readonly QuotaMetric[] = [
  "seats",
  "activeAgents",
  "taskRuns",
  "storageBytes",
  "apiKeys",
  "webhookVolume",
] as const;

export type PlanQuotas = Readonly<Record<QuotaMetric, number>>;

/** Human labels for error messages and UI. */
export const QUOTA_LABELS: Record<QuotaMetric, string> = {
  seats: "team seats",
  activeAgents: "active agents",
  taskRuns: "task runs this month",
  storageBytes: "artifact storage",
  apiKeys: "API keys",
  webhookVolume: "webhook deliveries this month",
};

/**
 * Per-plan hard limits.
 *
 * Free is intentionally tight so multi-seat / high-volume use requires an
 * upgrade. Premium is the mid-market team tier; pro is effectively unlimited
 * for practical product workloads (Infinity for open-ended meters).
 */
export const PLAN_QUOTAS: Record<TenantPlan, PlanQuotas> = {
  free: {
    seats: 1,
    activeAgents: 1,
    taskRuns: 50,
    storageBytes: 100 * 1024 * 1024, // 100 MiB
    apiKeys: 2,
    webhookVolume: 100,
  },
  premium: {
    seats: 10,
    activeAgents: 5,
    taskRuns: 500,
    storageBytes: 5 * 1024 * 1024 * 1024, // 5 GiB
    apiKeys: 20,
    webhookVolume: 5_000,
  },
  pro: {
    seats: 100,
    activeAgents: 50,
    taskRuns: Infinity,
    storageBytes: Infinity,
    apiKeys: 200,
    webhookVolume: Infinity,
  },
};

export function isTenantPlan(value: unknown): value is TenantPlan {
  return (
    typeof value === "string" &&
    (TENANT_PLANS as readonly string[]).includes(value)
  );
}

export function quotasForPlan(plan: TenantPlan): PlanQuotas {
  return PLAN_QUOTAS[plan] ?? PLAN_QUOTAS[DEFAULT_PLAN];
}

export function planMeetsMinimum(
  plan: TenantPlan,
  minimum: TenantPlan,
): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[minimum];
}

/** Format a quota value for display (∞ for unlimited, MiB/GiB for storage). */
export function formatQuotaValue(metric: QuotaMetric, value: number): string {
  if (!Number.isFinite(value)) return "unlimited";
  if (metric === "storageBytes") {
    if (value >= 1024 * 1024 * 1024) {
      return `${(value / (1024 * 1024 * 1024)).toFixed(value % (1024 * 1024 * 1024) === 0 ? 0 : 1)} GiB`;
    }
    if (value >= 1024 * 1024) {
      return `${(value / (1024 * 1024)).toFixed(value % (1024 * 1024) === 0 ? 0 : 1)} MiB`;
    }
    if (value >= 1024) return `${Math.round(value / 1024)} KiB`;
    return `${value} B`;
  }
  return String(value);
}
