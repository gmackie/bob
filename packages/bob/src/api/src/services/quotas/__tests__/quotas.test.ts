import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";

import {
  DEFAULT_PLAN,
  PLAN_QUOTAS,
  QUOTA_METRICS,
  formatQuotaValue,
  isTenantPlan,
  planMeetsMinimum,
  quotasForPlan,
} from "@bob/tenancy/plan-limits";
import type {
  PlanQuotas,
  QuotaMetric,
  TenantPlan,
} from "@bob/tenancy/plan-limits";

import {
  QuotaExceededError,
  isQuotaEnforcementEnabled,
  wouldExceedQuota,
} from "../policy";

interface TenantUsage {
  readonly tenantId: string;
  readonly plan: TenantPlan;
  readonly limits: PlanQuotas;
  readonly usage: Readonly<Record<QuotaMetric, number>>;
  readonly measuredAt: string;
  readonly periodStart: string;
}

function makeSnapshot(
  overrides: Omit<Partial<TenantUsage>, "usage" | "limits"> & {
    usage?: Partial<TenantUsage["usage"]>;
    limits?: Partial<TenantUsage["limits"]>;
  } = {},
): TenantUsage {
  const plan = overrides.plan ?? "free";
  const limits = { ...quotasForPlan(plan), ...overrides.limits };
  const usage = {
    seats: 0,
    activeAgents: 0,
    taskRuns: 0,
    storageBytes: 0,
    apiKeys: 0,
    webhookVolume: 0,
    ...overrides.usage,
  };
  return {
    tenantId: overrides.tenantId ?? "tenant-1",
    plan,
    limits,
    usage,
    measuredAt: overrides.measuredAt ?? new Date().toISOString(),
    periodStart: overrides.periodStart ?? "2026-07-01T00:00:00.000Z",
  };
}

/** Mirrors assertWithinQuota when a snapshot is supplied (no DB). */
function assertWithSnapshot(
  snapshot: TenantUsage,
  metric: QuotaMetric,
  delta = 1,
): TenantUsage {
  if (!isQuotaEnforcementEnabled()) return snapshot;
  const limit = snapshot.limits[metric];
  const usage = snapshot.usage[metric];
  if (Number.isFinite(limit) && usage + delta > limit) {
    throw new QuotaExceededError({
      metric,
      plan: snapshot.plan,
      limit,
      usage,
      delta,
    });
  }
  return snapshot;
}

describe("plan-limits", () => {
  it("covers every plan with every quota metric", () => {
    for (const plan of ["free", "premium", "pro"] as const) {
      const quotas = PLAN_QUOTAS[plan];
      for (const metric of QUOTA_METRICS) {
        expect(quotas[metric]).toBeTypeOf("number");
        expect(quotas[metric]).toBeGreaterThan(0);
      }
    }
  });

  it("tiers increase (or stay unlimited) from free → premium → pro", () => {
    for (const metric of QUOTA_METRICS) {
      const free = PLAN_QUOTAS.free[metric];
      const premium = PLAN_QUOTAS.premium[metric];
      const pro = PLAN_QUOTAS.pro[metric];
      expect(premium).toBeGreaterThanOrEqual(free);
      expect(pro).toBeGreaterThanOrEqual(premium);
    }
  });

  it("orders plans by capability", () => {
    expect(planMeetsMinimum("pro", "premium")).toBe(true);
    expect(planMeetsMinimum("premium", "premium")).toBe(true);
    expect(planMeetsMinimum("free", "premium")).toBe(false);
  });

  it("defaults and validates plan names", () => {
    expect(DEFAULT_PLAN).toBe("free");
    expect(isTenantPlan("free")).toBe(true);
    expect(isTenantPlan("enterprise")).toBe(false);
    expect(quotasForPlan("premium")).toEqual(PLAN_QUOTAS.premium);
  });

  it("formats storage and unlimited values", () => {
    expect(formatQuotaValue("storageBytes", 100 * 1024 * 1024)).toBe("100 MiB");
    expect(formatQuotaValue("storageBytes", 5 * 1024 * 1024 * 1024)).toBe(
      "5 GiB",
    );
    expect(formatQuotaValue("taskRuns", Infinity)).toBe("unlimited");
    expect(formatQuotaValue("seats", 10)).toBe("10");
  });
});

describe("wouldExceedQuota", () => {
  it("blocks free plan seats beyond 1", () => {
    expect(wouldExceedQuota("free", "seats", 1, 1)).toBe(true);
    expect(wouldExceedQuota("free", "seats", 0, 1)).toBe(false);
  });

  it("allows premium to hold 10 seats", () => {
    expect(wouldExceedQuota("premium", "seats", 9, 1)).toBe(false);
    expect(wouldExceedQuota("premium", "seats", 10, 1)).toBe(true);
  });

  it("treats Infinity as unlimited", () => {
    expect(wouldExceedQuota("pro", "taskRuns", 1_000_000, 1)).toBe(false);
    expect(Number.isFinite(PLAN_QUOTAS.pro.taskRuns)).toBe(false);
  });

  it("meters storage deltas", () => {
    const limit = PLAN_QUOTAS.free.storageBytes;
    expect(wouldExceedQuota("free", "storageBytes", limit - 100, 50)).toBe(
      false,
    );
    expect(wouldExceedQuota("free", "storageBytes", limit - 100, 200)).toBe(
      true,
    );
  });
});

describe("isQuotaEnforcementEnabled", () => {
  const saved = process.env.ENFORCE_USAGE_QUOTAS;

  afterEach(() => {
    if (saved === undefined) delete process.env.ENFORCE_USAGE_QUOTAS;
    else process.env.ENFORCE_USAGE_QUOTAS = saved;
  });

  it("honors explicit true/false overrides", () => {
    process.env.ENFORCE_USAGE_QUOTAS = "true";
    expect(isQuotaEnforcementEnabled()).toBe(true);
    process.env.ENFORCE_USAGE_QUOTAS = "false";
    expect(isQuotaEnforcementEnabled()).toBe(false);
  });
});

describe("assertWithinQuota (snapshot path)", () => {
  const saved = process.env.ENFORCE_USAGE_QUOTAS;

  beforeEach(() => {
    process.env.ENFORCE_USAGE_QUOTAS = "true";
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.ENFORCE_USAGE_QUOTAS;
    else process.env.ENFORCE_USAGE_QUOTAS = saved;
  });

  it("is a no-op when enforcement is disabled", () => {
    process.env.ENFORCE_USAGE_QUOTAS = "false";
    const snapshot = makeSnapshot({ usage: { seats: 99 } });
    expect(assertWithSnapshot(snapshot, "seats")).toEqual(snapshot);
  });

  it("allows usage under the limit", () => {
    const snapshot = makeSnapshot({ usage: { apiKeys: 1 } }); // free limit 2
    expect(assertWithSnapshot(snapshot, "apiKeys")).toEqual(snapshot);
  });

  it("throws QuotaExceededError when over limit", () => {
    const snapshot = makeSnapshot({
      plan: "free",
      usage: { activeAgents: 1 },
    });
    expect(() => assertWithSnapshot(snapshot, "activeAgents")).toThrow(
      QuotaExceededError,
    );
  });

  it("converts QuotaExceededError to TRPC FORBIDDEN", () => {
    const snapshot = makeSnapshot({
      plan: "free",
      usage: { webhookVolume: 100 },
    });
    try {
      assertWithSnapshot(snapshot, "webhookVolume");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      const trpc = (err as QuotaExceededError).toTRPCError();
      expect(trpc).toBeInstanceOf(TRPCError);
      expect(trpc.code).toBe("FORBIDDEN");
      expect(trpc.message).toMatch(/webhook deliveries/i);
      expect(trpc.message).toMatch(/free/i);
    }
  });

  it("includes formatted storage limits in the error message", () => {
    const err = new QuotaExceededError({
      metric: "storageBytes",
      plan: "free",
      limit: PLAN_QUOTAS.free.storageBytes,
      usage: PLAN_QUOTAS.free.storageBytes,
      delta: 1,
    });
    expect(err.message).toContain(
      formatQuotaValue("storageBytes", PLAN_QUOTAS.free.storageBytes),
    );
  });
});
