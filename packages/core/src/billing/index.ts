// @gmacko/billing — Phase 6L peripheral package stub.
//
// Public surface:
//   - `Billing` — Effect service for plan listing, checkout, subscription
//     lookup/cancel, and webhook handling.
//   - `layerBillingStub` — Layer that fails every method with
//     `BillingNotImplementedError`.
//   - Tagged error: `BillingNotImplementedError`.
//   - Types: `SubscriptionPlan`, `Subscription`, `BillingShape`.
//
// Real implementation deferred to Phase 7 (Bob migration). Stripe-style driver
// lands when Bob ships subscriptions.
import { Effect, Layer, Schema, ServiceMap } from "effect";

export interface SubscriptionPlan {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
  readonly interval: "month" | "year";
  readonly currency: string;
}

export interface Subscription {
  readonly id: string;
  readonly tenantId: string;
  readonly planId: string;
  readonly status: "active" | "canceled" | "past_due" | "trialing";
  readonly currentPeriodEnd: Date;
}

export class BillingNotImplementedError extends Schema.TaggedErrorClass<BillingNotImplementedError>()(
  "BillingNotImplementedError",
  {
    reason: Schema.String,
    action: Schema.optional(Schema.String),
  },
) {}

export interface BillingShape {
  readonly listPlans: () => Effect.Effect<
    readonly SubscriptionPlan[],
    BillingNotImplementedError
  >;
  readonly createCheckoutSession: (input: {
    readonly planId: string;
    readonly tenantId: string;
    readonly successUrl: string;
    readonly cancelUrl: string;
  }) => Effect.Effect<{ readonly url: string }, BillingNotImplementedError>;
  readonly getSubscriptionForTenant: (
    tenantId: string,
  ) => Effect.Effect<Subscription | null, BillingNotImplementedError>;
  readonly cancelSubscription: (
    subscriptionId: string,
  ) => Effect.Effect<void, BillingNotImplementedError>;
  readonly handleWebhook: (
    rawBody: string,
    signature: string,
  ) => Effect.Effect<void, BillingNotImplementedError>;
}

export const Billing = ServiceMap.Service<BillingShape>(
  "@gmacko/billing/Billing",
);

const reason = "@gmacko/billing: deferred to Phase 7 (Bob migration)";

const fail = (
  action?: string,
): Effect.Effect<never, BillingNotImplementedError> =>
  Effect.fail(new BillingNotImplementedError({ reason, action }));

export const layerBillingStub: Layer.Layer<BillingShape> = Layer.succeed(
  Billing,
  {
    listPlans: () => fail("listPlans"),
    createCheckoutSession: () => fail("createCheckoutSession"),
    getSubscriptionForTenant: () => fail("getSubscriptionForTenant"),
    cancelSubscription: () => fail("cancelSubscription"),
    handleWebhook: () => fail("handleWebhook"),
  },
);

/** Package version/phase sentinel — kept for the 6L smoke test. */
export const __gmackoBillingPhase = "6l" as const;
