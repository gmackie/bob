import { describe, expect, it, vi } from "vitest";

import { applyStripeEntitlementEvent } from "../stripeEntitlements";

const createDb = () => {
  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  return {
    update,
    __mock: {
      updateReturning,
      updateSet,
    },
  };
};

describe("Stripe entitlement events", () => {
  it("maps active subscription plan metadata onto the tenant", async () => {
    const db = createDb();
    db.__mock.updateReturning.mockResolvedValueOnce([
      { id: "tenant-1", plan: "premium" },
    ]);

    const result = await applyStripeEntitlementEvent(
      db,
      {} as any,
      {
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_123",
            customer: "cus_123",
            status: "active",
            metadata: { tenantId: "tenant-1", plan: "premium" },
            items: {
              data: [
                {
                  price: {
                    id: "price_123",
                    lookup_key: "bob_premium_monthly",
                    metadata: {},
                    product: "prod_123",
                  },
                },
              ],
            },
          },
        },
      } as any,
    );

    expect(result).toEqual({ id: "tenant-1", plan: "premium" });
    expect(db.__mock.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "premium",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        stripePriceId: "price_123",
        stripeProductId: "prod_123",
      }),
    );
  });

  it("downgrades cancelled subscriptions to free", async () => {
    const db = createDb();
    db.__mock.updateReturning.mockResolvedValueOnce([
      { id: "tenant-1", plan: "free" },
    ]);

    await applyStripeEntitlementEvent(
      db,
      {} as any,
      {
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_123",
            customer: "cus_123",
            status: "canceled",
            metadata: { tenantId: "tenant-1", plan: "pro" },
            items: { data: [] },
          },
        },
      } as any,
    );

    expect(db.__mock.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "free" }),
    );
  });
});
