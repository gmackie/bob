import type { Stripe } from "@bob/payments";

import type { TenantPlan } from "./entitlements";
import { isTenantPlan, updateTenantStripeEntitlement } from "./entitlements";

const activeSubscriptionStatuses = new Set(["active", "trialing", "past_due"]);

function idFromStripeRef(ref: string | { id: string } | null | undefined) {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

function planFromMetadata(
  ...metadata: Array<Stripe.Metadata | null | undefined>
) {
  for (const values of metadata) {
    const plan = values?.plan ?? values?.tenant_plan;
    if (isTenantPlan(plan)) return plan;
  }
  return null;
}

function planFromPriceLookupKey(lookupKey: string | null | undefined) {
  if (!lookupKey) return null;
  if (lookupKey.includes("premium")) return "premium";
  if (lookupKey.includes("pro")) return "pro";
  if (lookupKey.includes("free")) return "free";
  return null;
}

function planFromSubscription(subscription: Stripe.Subscription): TenantPlan {
  if (!activeSubscriptionStatuses.has(subscription.status)) {
    return "free";
  }

  const item = subscription.items.data[0];
  const price = item?.price;
  const plan = planFromMetadata(subscription.metadata, price?.metadata);
  if (plan) return plan;

  return planFromPriceLookupKey(price?.lookup_key) ?? "pro";
}

async function resolveSubscription(
  stripe: Stripe,
  subscription: string | Stripe.Subscription | null,
) {
  if (!subscription) return null;
  if (typeof subscription !== "string") return subscription;
  return stripe.subscriptions.retrieve(subscription, {
    expand: ["items.data.price.product"],
  });
}

async function updateFromSubscription(
  db: any,
  subscription: Stripe.Subscription,
  metadata: Stripe.Metadata | null | undefined = null,
) {
  const item = subscription.items.data[0];
  const price = item?.price;
  const productId = idFromStripeRef(price?.product);

  return updateTenantStripeEntitlement(db, {
    tenantId: subscription.metadata.tenantId ?? metadata?.tenantId,
    customerId: idFromStripeRef(subscription.customer),
    subscriptionId: subscription.id,
    priceId: price?.id ?? null,
    productId,
    plan: planFromSubscription(subscription),
  });
}

export async function applyStripeEntitlementEvent(
  db: any,
  stripe: Stripe,
  event: Stripe.Event,
) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscription = await resolveSubscription(
        stripe,
        session.subscription,
      );
      if (!subscription) return null;
      return updateFromSubscription(db, subscription, session.metadata);
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return updateFromSubscription(
        db,
        event.data.object as Stripe.Subscription,
      );

    default:
      return null;
  }
}

export const stripeEntitlementEventTypes = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;
