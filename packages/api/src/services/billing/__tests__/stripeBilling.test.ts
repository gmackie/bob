import { describe, expect, it, vi } from "vitest";

import {
  hasTenantPlan,
  planFromStripeIds,
  syncTenantSubscriptionPlan,
} from "../stripeBilling";

describe("stripe billing helpers", () => {
  it("maps Stripe price and product ids to tenant plans", () => {
    const env = {
      STRIPE_PREMIUM_PRICE_ID: "price_premium",
      STRIPE_PRO_PRODUCT_ID: "prod_pro",
    };

    expect(planFromStripeIds("price_premium", null, env)).toBe("premium");
    expect(planFromStripeIds(null, "prod_pro", env)).toBe("pro");
    expect(planFromStripeIds("price_unknown", null, env)).toBeNull();
  });

  it("compares tenant plan levels", () => {
    expect(hasTenantPlan("pro", "premium")).toBe(true);
    expect(hasTenantPlan("premium", "pro")).toBe(false);
    expect(hasTenantPlan("free", "free")).toBe(true);
  });

  it("syncs inactive subscriptions back to free", async () => {
    const where = vi.fn();
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update };

    const plan = await syncTenantSubscriptionPlan({
      db,
      subscriptionId: "sub_1",
      customerId: "cus_1",
      status: "canceled",
      priceId: "price_pro",
      metadataTenantId: "tenant-1",
    });

    expect(plan).toBe("free");
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "free",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        stripeSubscriptionStatus: "canceled",
      }),
    );
  });
});
