/**
 * Pure quota policy helpers (no DB imports).
 */
import { TRPCError } from "@trpc/server";

import { isStripeEnabled } from "@bob/config/integrations";
import type { QuotaMetric, TenantPlan } from "@bob/tenancy/plan-limits";
import {
  QUOTA_LABELS,
  formatQuotaValue,
  quotasForPlan,
} from "@bob/tenancy/plan-limits";

/**
 * Whether plan quotas are enforced on write paths.
 *
 * - `ENFORCE_USAGE_QUOTAS=true|1` forces on
 * - `ENFORCE_USAGE_QUOTAS=false|0` forces off
 * - otherwise mirrors Stripe billing so quotas only bite once paid plans are live
 */
export function isQuotaEnforcementEnabled(): boolean {
  const override = process.env.ENFORCE_USAGE_QUOTAS?.trim().toLowerCase();
  if (override === "true" || override === "1") return true;
  if (override === "false" || override === "0") return false;
  return isStripeEnabled();
}

export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED" as const;
  readonly metric: QuotaMetric;
  readonly plan: TenantPlan;
  readonly limit: number;
  readonly usage: number;
  readonly delta: number;

  constructor(input: {
    metric: QuotaMetric;
    plan: TenantPlan;
    limit: number;
    usage: number;
    delta: number;
  }) {
    const label = QUOTA_LABELS[input.metric];
    super(
      `Plan quota exceeded for ${label}: using ${formatQuotaValue(input.metric, input.usage + input.delta)} of ${formatQuotaValue(input.metric, input.limit)} on the '${input.plan}' plan. Upgrade to continue.`,
    );
    this.name = "QuotaExceededError";
    this.metric = input.metric;
    this.plan = input.plan;
    this.limit = input.limit;
    this.usage = input.usage;
    this.delta = input.delta;
  }

  toTRPCError(): TRPCError {
    return new TRPCError({
      code: "FORBIDDEN",
      message: this.message,
      cause: this,
    });
  }
}

/** Pure check used by unit tests and non-async validators. */
export function wouldExceedQuota(
  plan: TenantPlan,
  metric: QuotaMetric,
  usage: number,
  delta = 1,
): boolean {
  const limit = quotasForPlan(plan)[metric];
  return Number.isFinite(limit) && usage + delta > limit;
}
