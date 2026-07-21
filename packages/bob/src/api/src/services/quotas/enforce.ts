/**
 * Quota enforcement helpers.
 *
 * Call `assertWithinQuota` (or the metric-specific wrappers) immediately
 * before creating a metered resource. Enforcement is inert until enabled via
 * env / Stripe so existing free-plan test suites stay green while the wiring
 * ships.
 */
import type { Db } from "@bob/db/client";
import type { QuotaMetric } from "@bob/tenancy/plan-limits";

import {
  QuotaExceededError,
  isQuotaEnforcementEnabled,
} from "./policy.js";
import {
  measureTenantUsage,
  resolveUserTenantId,
} from "./usage.js";
import type { TenantUsage } from "./usage.js";

export {
  QuotaExceededError,
  isQuotaEnforcementEnabled,
  wouldExceedQuota,
} from "./policy.js";

export interface AssertQuotaInput {
  readonly db: Db;
  /** Tenant to check. When omitted, resolved from `userId`. */
  readonly tenantId?: string | null;
  /** Used to resolve the tenant when `tenantId` is not provided. */
  readonly userId?: string;
  readonly metric: QuotaMetric;
  /** How much of the metric the pending operation will consume (default 1). */
  readonly delta?: number;
  /**
   * Optional pre-measured snapshot (avoids a second full measurement when the
   * caller already has one). When provided, only that metric is re-checked
   * against the snapshot's usage + limits.
   */
  readonly snapshot?: TenantUsage;
}

/**
 * Throw `QuotaExceededError` when the tenant would exceed `metric` after
 * applying `delta`. No-op when enforcement is disabled or the tenant cannot
 * be resolved (callers that create tenants first should resolve/create the
 * tenant before calling).
 */
export async function assertWithinQuota(
  input: AssertQuotaInput,
): Promise<TenantUsage | null> {
  if (!isQuotaEnforcementEnabled()) return null;

  const tenantId =
    input.tenantId ??
    (input.userId
      ? await resolveUserTenantId(input.db, input.userId)
      : null);
  if (!tenantId) return null;

  const delta = input.delta ?? 1;
  if (delta <= 0) {
    return input.snapshot ?? (await measureTenantUsage(input.db, tenantId));
  }

  const snapshot =
    input.snapshot ?? (await measureTenantUsage(input.db, tenantId));
  const limit = snapshot.limits[input.metric];
  const usage = snapshot.usage[input.metric];

  if (Number.isFinite(limit) && usage + delta > limit) {
    throw new QuotaExceededError({
      metric: input.metric,
      plan: snapshot.plan,
      limit,
      usage,
      delta,
    });
  }

  return snapshot;
}

/**
 * Like `assertWithinQuota` but converts `QuotaExceededError` into a TRPCError
 * for handler use. Prefer this at tRPC / Effect-RPC boundaries.
 */
export async function assertWithinQuotaOrThrow(
  input: AssertQuotaInput,
): Promise<TenantUsage | null> {
  try {
    return await assertWithinQuota(input);
  } catch (err) {
    if (err instanceof QuotaExceededError) throw err.toTRPCError();
    throw err;
  }
}
