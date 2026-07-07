import { describe, expect, it } from "vitest";

import { getStripeIntegrationStatus, getStripeSecretKeyStatus } from "./index";

describe("getStripeIntegrationStatus", () => {
  it("reports disabled when the Stripe integration is off", () => {
    expect(getStripeIntegrationStatus({ secretKey: "sk_test_valid" })).toEqual({
      enabled: false,
      status: "disabled",
      reason: "Stripe integration is disabled.",
    });
  });

  it("classifies missing Stripe secret keys", () => {
    expect(getStripeSecretKeyStatus("   ")).toEqual({
      status: "missing_secret_key",
      reason: "Stripe secret key is not configured.",
    });
  });

  it("rejects account ids and placeholders before Stripe auth", () => {
    expect(getStripeSecretKeyStatus("acct_123")).toEqual({
      status: "invalid_secret_key",
      reason:
        "Stripe secret key must start with sk_test_, sk_live_, rk_test_, or rk_live_.",
    });

    expect(getStripeSecretKeyStatus("STRIPE_SECRET_KEY")).toEqual({
      status: "invalid_secret_key",
      reason:
        "Stripe secret key must start with sk_test_, sk_live_, rk_test_, or rk_live_.",
    });
  });

  it("accepts Stripe secret and restricted key formats", () => {
    expect(getStripeSecretKeyStatus(" sk_test_123abc ")).toEqual({
      status: "ready",
      reason: null,
    });

    expect(getStripeSecretKeyStatus("rk_live_456def")).toEqual({
      status: "ready",
      reason: null,
    });
  });
});
