import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  entitlementsForPlan,
  featuresForPlan,
  planHasFeature,
  planMeetsMinimum,
} from "../entitlements";
import {
  planForPriceId,
  priceIdForPlan,
  purchasablePlans,
} from "../planMapping";
import {
  parseStripeSignatureHeader,
  verifyStripeSignature,
} from "../stripeClient";

describe("entitlements", () => {
  it("orders plans by capability", () => {
    expect(planMeetsMinimum("pro", "premium")).toBe(true);
    expect(planMeetsMinimum("premium", "premium")).toBe(true);
    expect(planMeetsMinimum("free", "premium")).toBe(false);
  });

  it("gates features by minimum plan", () => {
    expect(planHasFeature("free", "integrations")).toBe(false);
    expect(planHasFeature("premium", "integrations")).toBe(true);
    expect(planHasFeature("premium", "forgegraph")).toBe(false);
    expect(planHasFeature("pro", "forgegraph")).toBe(true);
  });

  it("free plan has no paid features; pro has all", () => {
    expect(featuresForPlan("free")).toEqual([]);
    expect(featuresForPlan("pro")).toEqual(
      expect.arrayContaining([
        "integrations",
        "forgegraph",
        "custom_agents",
        "priority_dispatch",
      ]),
    );
  });

  it("builds a full entitlement snapshot", () => {
    const snap = entitlementsForPlan("premium");
    expect(snap.plan).toBe("premium");
    expect(snap.features).toContain("integrations");
    expect(snap.limits.maxWorkspaces).toBe(10);
  });
});

describe("planMapping", () => {
  const saved = {
    premium: process.env.STRIPE_PRICE_PREMIUM,
    pro: process.env.STRIPE_PRICE_PRO,
  };
  beforeEach(() => {
    process.env.STRIPE_PRICE_PREMIUM = "price_premium_123";
    process.env.STRIPE_PRICE_PRO = "price_pro_456";
  });
  afterEach(() => {
    process.env.STRIPE_PRICE_PREMIUM = saved.premium;
    process.env.STRIPE_PRICE_PRO = saved.pro;
  });

  it("maps configured price ids to plans", () => {
    expect(planForPriceId("price_premium_123")).toBe("premium");
    expect(planForPriceId("price_pro_456")).toBe("pro");
    expect(planForPriceId("price_unknown")).toBeNull();
  });

  it("maps plans back to price ids", () => {
    expect(priceIdForPlan("premium")).toBe("price_premium_123");
    expect(purchasablePlans()).toEqual(["premium", "pro"]);
  });

  it("omits plans without a configured price", () => {
    delete process.env.STRIPE_PRICE_PRO;
    expect(priceIdForPlan("pro")).toBeNull();
    expect(purchasablePlans()).toEqual(["premium"]);
    expect(planForPriceId("price_pro_456")).toBeNull();
  });
});

describe("verifyStripeSignature", () => {
  const secret = "whsec_test";
  const now = 1_700_000_000;
  const rawBody = '{"id":"evt_1","type":"customer.subscription.updated"}';

  function sign(ts: number, body: string, withSecret = secret): string {
    const sig = createHmac("sha256", withSecret)
      .update(`${ts}.${body}`, "utf8")
      .digest("hex");
    return `t=${ts},v1=${sig}`;
  }

  it("parses the signature header", () => {
    const parsed = parseStripeSignatureHeader("t=123,v1=abc,v1=def");
    expect(parsed.timestamp).toBe(123);
    expect(parsed.signatures).toEqual(["abc", "def"]);
  });

  it("accepts a valid, in-tolerance signature", () => {
    expect(
      verifyStripeSignature({
        rawBody,
        signatureHeader: sign(now, rawBody),
        secret,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(
      verifyStripeSignature({
        rawBody: rawBody + " ",
        signatureHeader: sign(now, rawBody),
        secret,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(
      verifyStripeSignature({
        rawBody,
        signatureHeader: sign(now, rawBody, "whsec_wrong"),
        secret,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it("rejects a replayed (out-of-tolerance) timestamp", () => {
    expect(
      verifyStripeSignature({
        rawBody,
        signatureHeader: sign(now - 10_000, rawBody),
        secret,
        nowSeconds: now,
        toleranceSeconds: 300,
      }),
    ).toBe(false);
  });

  it("rejects a malformed header", () => {
    expect(
      verifyStripeSignature({
        rawBody,
        signatureHeader: "garbage",
        secret,
        nowSeconds: now,
      }),
    ).toBe(false);
  });
});
