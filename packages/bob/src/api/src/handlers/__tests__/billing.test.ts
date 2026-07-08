import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@bob/db/client";

import { handleStripeWebhook, resolveTenantPlan } from "../billing";

const WEBHOOK_SECRET = "whsec_test";
const PRO_PRICE = "price_pro_456";

interface Captured {
  inserts: { values: Record<string, unknown>; conflict?: unknown }[];
  updates: { set: Record<string, unknown> }[];
}

/** Chainable mock of the drizzle db surface the billing webhook touches. */
function makeDb(
  overrides: {
    existingSubscriptionTenantId?: string | null;
    tenantByCustomerId?: string | null;
    tenantMember?: {
      tenant: { id: string; plan: string; stripeCustomerId: string | null };
    } | null;
  } = {},
): { db: Db; captured: Captured } {
  const captured: Captured = { inserts: [], updates: [] };

  const db = {
    query: {
      tenantMembers: {
        findFirst: async () => overrides.tenantMember ?? undefined,
      },
      tenantSubscriptions: {
        findFirst: async () =>
          overrides.existingSubscriptionTenantId
            ? { tenantId: overrides.existingSubscriptionTenantId }
            : undefined,
      },
      tenants: {
        findFirst: async () =>
          overrides.tenantByCustomerId
            ? { id: overrides.tenantByCustomerId }
            : undefined,
      },
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        const rec = { values };
        captured.inserts.push(rec);
        return {
          onConflictDoUpdate: (conflict: unknown) => {
            (rec as Captured["inserts"][number]).conflict = conflict;
            return Promise.resolve();
          },
        };
      },
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => {
        captured.updates.push({ set });
        return { where: () => Promise.resolve() };
      },
    }),
  } as unknown as Db;

  return { db, captured };
}

function subscriptionEvent(opts: {
  type: string;
  tenantId?: string;
  customer?: string;
  status?: string;
  priceId?: string;
  subscriptionId?: string;
}): string {
  return JSON.stringify({
    id: "evt_1",
    type: opts.type,
    data: {
      object: {
        id: opts.subscriptionId ?? "sub_1",
        customer: opts.customer ?? "cus_1",
        status: opts.status ?? "active",
        cancel_at_period_end: false,
        current_period_end: 1_700_100_000,
        items: { data: [{ price: { id: opts.priceId ?? PRO_PRICE } }] },
        metadata: opts.tenantId ? { tenantId: opts.tenantId } : {},
      },
    },
  });
}

function sign(body: string, ts = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${ts}.${body}`, "utf8")
    .digest("hex");
  return `t=${ts},v1=${sig}`;
}

describe("handleStripeWebhook", () => {
  const savedSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const savedPrice = process.env.STRIPE_PRICE_PRO;

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.STRIPE_PRICE_PRO = PRO_PRICE;
  });
  afterEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = savedSecret;
    process.env.STRIPE_PRICE_PRO = savedPrice;
  });

  it("grants the mapped plan on an active subscription", async () => {
    const { db, captured } = makeDb();
    const body = subscriptionEvent({
      type: "customer.subscription.created",
      tenantId: "tenant-1",
    });

    const result = await handleStripeWebhook(db, body, sign(body));

    expect(result).toMatchObject({
      received: true,
      handled: true,
      tenantId: "tenant-1",
      plan: "pro",
    });
    expect(captured.updates[0]?.set).toMatchObject({ plan: "pro" });
    expect(captured.inserts[0]?.values).toMatchObject({
      tenantId: "tenant-1",
      plan: "pro",
      status: "active",
    });
  });

  it("downgrades to free when the subscription is deleted", async () => {
    const { db, captured } = makeDb();
    const body = subscriptionEvent({
      type: "customer.subscription.deleted",
      tenantId: "tenant-1",
    });

    const result = await handleStripeWebhook(db, body, sign(body));

    expect(result.plan).toBe("free");
    expect(captured.updates[0]?.set).toMatchObject({ plan: "free" });
  });

  it("downgrades to free on a non-entitled status", async () => {
    const { db } = makeDb();
    const body = subscriptionEvent({
      type: "customer.subscription.updated",
      tenantId: "tenant-1",
      status: "unpaid",
    });

    const result = await handleStripeWebhook(db, body, sign(body));
    expect(result.plan).toBe("free");
  });

  it("resolves the tenant via the stored customer id when metadata is absent", async () => {
    const { db, captured } = makeDb({ tenantByCustomerId: "tenant-9" });
    const body = subscriptionEvent({
      type: "customer.subscription.updated",
      customer: "cus_9",
    });

    const result = await handleStripeWebhook(db, body, sign(body));
    expect(result.tenantId).toBe("tenant-9");
    expect(captured.updates[0]?.set).toMatchObject({ plan: "pro" });
  });

  it("acknowledges but does not act on unattributable subscriptions", async () => {
    const { db, captured } = makeDb();
    const body = subscriptionEvent({
      type: "customer.subscription.updated",
      // no metadata, no matching customer/subscription
    });

    const result = await handleStripeWebhook(db, body, sign(body));
    expect(result).toEqual({ received: true, handled: false });
    expect(captured.updates).toHaveLength(0);
  });

  it("ignores unrelated event types", async () => {
    const { db, captured } = makeDb();
    const body = JSON.stringify({
      id: "evt_2",
      type: "invoice.paid",
      data: { object: { id: "in_1" } },
    });

    const result = await handleStripeWebhook(db, body, sign(body));
    expect(result).toEqual({ received: true, handled: false });
    expect(captured.inserts).toHaveLength(0);
  });

  it("rejects an invalid signature", async () => {
    const { db } = makeDb();
    const body = subscriptionEvent({
      type: "customer.subscription.updated",
      tenantId: "tenant-1",
    });

    await expect(
      handleStripeWebhook(db, body, "t=1700000000,v1=deadbeef"),
    ).rejects.toThrow(/signature/i);
  });

  it("fails when the webhook secret is unset", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { db } = makeDb();
    const body = subscriptionEvent({
      type: "customer.subscription.updated",
      tenantId: "tenant-1",
    });

    await expect(handleStripeWebhook(db, body, sign(body))).rejects.toThrow(
      /STRIPE_WEBHOOK_SECRET/,
    );
  });
});

describe("resolveTenantPlan", () => {
  it("returns the tenant's plan", async () => {
    const { db } = makeDb({
      tenantMember: {
        tenant: { id: "tenant-1", plan: "premium", stripeCustomerId: "cus_1" },
      },
    });
    await expect(resolveTenantPlan(db, "user-1")).resolves.toEqual({
      tenantId: "tenant-1",
      plan: "premium",
      stripeCustomerId: "cus_1",
    });
  });

  it("falls back to the free plan when the user has no tenant", async () => {
    const { db } = makeDb({ tenantMember: null });
    await expect(resolveTenantPlan(db, "user-1")).resolves.toEqual({
      tenantId: null,
      plan: "free",
      stripeCustomerId: null,
    });
  });
});
