/**
 * Usage / quota handlers — read plan limits and current consumption for the
 * caller's tenant. Used by billing UI and upgrade prompts.
 */
import {
  DEFAULT_PLAN,
  PLAN_QUOTAS,
  QUOTA_LABELS,
  QUOTA_METRICS,
  formatQuotaValue,
  quotasForPlan,
} from "@bob/tenancy/plan-limits";
import type { QuotaMetric, TenantPlan } from "@bob/tenancy/plan-limits";

import {
  isQuotaEnforcementEnabled,
  measureTenantUsage,
  resolveUserTenantId,
} from "../services/quotas/index.js";

import type { HandlerContext } from "./context.js";

export interface QuotaMeterView {
  readonly metric: QuotaMetric;
  readonly label: string;
  readonly usage: number;
  readonly limit: number;
  readonly remaining: number | null;
  readonly usageDisplay: string;
  readonly limitDisplay: string;
  readonly exceeded: boolean;
}

export async function usageGetSnapshot(ctx: HandlerContext) {
  const tenantId = await resolveUserTenantId(ctx.db, ctx.userId);
  if (!tenantId) {
    const plan: TenantPlan = DEFAULT_PLAN;
    const limits = quotasForPlan(plan);
    const meters: QuotaMeterView[] = QUOTA_METRICS.map((metric) =>
      toMeterView(metric, 0, limits[metric]),
    );
    return {
      tenantId: null,
      plan,
      enforcementEnabled: isQuotaEnforcementEnabled(),
      limits,
      usage: Object.fromEntries(QUOTA_METRICS.map((m) => [m, 0])) as Record<
        QuotaMetric,
        number
      >,
      meters,
      measuredAt: new Date().toISOString(),
      periodStart: null,
    };
  }

  const snapshot = await measureTenantUsage(ctx.db, tenantId);
  const meters: QuotaMeterView[] = QUOTA_METRICS.map((metric) =>
    toMeterView(metric, snapshot.usage[metric], snapshot.limits[metric]),
  );

  return {
    tenantId: snapshot.tenantId,
    plan: snapshot.plan,
    enforcementEnabled: isQuotaEnforcementEnabled(),
    limits: snapshot.limits,
    usage: snapshot.usage,
    meters,
    measuredAt: snapshot.measuredAt,
    periodStart: snapshot.periodStart,
  };
}

/** Catalog of all plans and their quotas (no auth-sensitive data). */
export async function usageListPlanQuotas(_ctx: HandlerContext) {
  await Promise.resolve();
  return (Object.keys(PLAN_QUOTAS) as TenantPlan[]).map((plan) => ({
    plan,
    limits: PLAN_QUOTAS[plan],
    meters: QUOTA_METRICS.map((metric) => ({
      metric,
      label: QUOTA_LABELS[metric],
      limit: PLAN_QUOTAS[plan][metric],
      limitDisplay: formatQuotaValue(metric, PLAN_QUOTAS[plan][metric]),
    })),
  }));
}

function toMeterView(
  metric: QuotaMetric,
  usage: number,
  limit: number,
): QuotaMeterView {
  const remaining = Number.isFinite(limit) ? Math.max(0, limit - usage) : null;
  return {
    metric,
    label: QUOTA_LABELS[metric],
    usage,
    limit,
    remaining,
    usageDisplay: formatQuotaValue(metric, usage),
    limitDisplay: formatQuotaValue(metric, limit),
    exceeded: Number.isFinite(limit) && usage >= limit,
  };
}
