/**
 * Billing handlers — plan entitlements, checkout, and Stripe webhook sync.
 *
 * The webhook is the write path that keeps `tenants.plan` in lockstep with
 * Stripe; every other handler is a read of that state. Handlers stay free of
 * the tRPC context shape (they take a plain `Db`) so they can be driven from
 * tests and, later, a raw HTTP webhook endpoint.
 */
import { TRPCError } from "@trpc/server";

import type { Db } from "@bob/db/client";
import { eq } from "@bob/db";
import {
  subscriptionStatusEnum,
  tenantMembers,
  tenants,
  tenantSubscriptions,
} from "@bob/db/schema";

import type { TenantPlan } from "../services/billing/entitlements.js";
import type { PaidPlan } from "../services/billing/planMapping.js";
import type { StripeSubscriptionObject } from "../services/billing/stripeClient.js";
import {
  DEFAULT_PLAN,
  entitlementsForPlan,
  featuresForPlan,
  PLAN_LIMITS,
} from "../services/billing/entitlements.js";
import {
  planForPriceId,
  priceIdForPlan,
  purchasablePlans,
} from "../services/billing/planMapping.js";
import {
  createCheckoutSession as createStripeCheckoutSession,
  getStripeWebhookSecret,
  parseStripeEvent,
  verifyStripeSignature,
} from "../services/billing/stripeClient.js";

type SubscriptionStatus = (typeof subscriptionStatusEnum.enumValues)[number];

/** Statuses that keep a tenant entitled to its paid plan (grace on past_due). */
const ENTITLED_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  "active",
  "trialing",
  "past_due",
]);

function normalizeStatus(raw: string): SubscriptionStatus {
  return (subscriptionStatusEnum.enumValues as readonly string[]).includes(raw)
    ? (raw as SubscriptionStatus)
    : "incomplete";
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ResolvedTenant {
  readonly tenantId: string | null;
  readonly plan: TenantPlan;
  readonly stripeCustomerId: string | null;
}

/**
 * Resolve the caller's tenant and its current plan. Falls back to the free
 * plan when the user has no tenant yet (entitlement checks then deny paid
 * features rather than crash).
 */
export async function resolveTenantPlan(
  db: Db,
  userId: string,
): Promise<ResolvedTenant> {
  const membership = await db.query.tenantMembers.findFirst({
    where: eq(tenantMembers.userId, userId),
    with: {
      tenant: {
        columns: { id: true, plan: true, stripeCustomerId: true },
      },
    },
  });

  const tenant = membership?.tenant;
  if (!tenant) {
    return { tenantId: null, plan: DEFAULT_PLAN, stripeCustomerId: null };
  }
  return {
    tenantId: tenant.id,
    plan: tenant.plan,
    stripeCustomerId: tenant.stripeCustomerId ?? null,
  };
}

/** Entitlement snapshot for the calling user's tenant. */
export async function getEntitlements(ctx: { db: Db; userId: string }) {
  const { tenantId, plan } = await resolveTenantPlan(ctx.db, ctx.userId);
  return { tenantId, ...entitlementsForPlan(plan) };
}

/** Catalog of purchasable plans with their configured Stripe price + features. */
export function listPlans() {
  return purchasablePlans().map((plan) => ({
    plan,
    priceId: priceIdForPlan(plan),
    features: featuresForPlan(plan),
    limits: PLAN_LIMITS[plan],
  }));
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export async function createCheckoutSession(
  ctx: { db: Db; userId: string; userEmail?: string | null },
  input: { plan: PaidPlan; successUrl: string; cancelUrl: string },
) {
  const priceId = priceIdForPlan(input.plan);
  if (!priceId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `No Stripe price configured for the '${input.plan}' plan`,
    });
  }

  const { tenantId, stripeCustomerId } = await resolveTenantPlan(
    ctx.db,
    ctx.userId,
  );
  if (!tenantId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No tenant to bill — create a workspace first",
    });
  }

  const session = await createStripeCheckoutSession({
    priceId,
    tenantId,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    customerId: stripeCustomerId ?? undefined,
    customerEmail: ctx.userEmail ?? undefined,
  });

  return { checkoutUrl: session.url, sessionId: session.id };
}

// ---------------------------------------------------------------------------
// Webhook -> plan sync
// ---------------------------------------------------------------------------

async function resolveTenantIdForSubscription(
  db: Db,
  sub: StripeSubscriptionObject,
): Promise<string | null> {
  const fromMetadata = sub.metadata?.tenantId;
  if (fromMetadata) return fromMetadata;

  const existing = await db.query.tenantSubscriptions.findFirst({
    where: eq(tenantSubscriptions.stripeSubscriptionId, sub.id),
    columns: { tenantId: true },
  });
  if (existing?.tenantId) return existing.tenantId;

  if (sub.customer) {
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.stripeCustomerId, sub.customer),
      columns: { id: true },
    });
    if (tenant?.id) return tenant.id;
  }
  return null;
}

/**
 * Derive the plan a subscription grants. A deleted subscription or a
 * non-entitled status always downgrades to free; otherwise the plan comes from
 * the subscription's price (free if the price isn't one we recognize).
 */
function planForSubscription(
  sub: StripeSubscriptionObject,
  status: SubscriptionStatus,
  deleted: boolean,
): TenantPlan {
  if (deleted || !ENTITLED_STATUSES.has(status)) return "free";
  const priceId = sub.items?.data?.[0]?.price?.id;
  return (priceId && planForPriceId(priceId)) || "free";
}

export interface WebhookResult {
  readonly received: boolean;
  readonly handled: boolean;
  readonly tenantId?: string;
  readonly plan?: TenantPlan;
}

/**
 * Verify and process a Stripe webhook. Keeps `tenant_subscriptions` and the
 * denormalized `tenants.plan` in sync from `customer.subscription.*` events.
 * Unrecognized event types are acknowledged but not acted on.
 */
export async function handleStripeWebhook(
  db: Db,
  rawBody: string,
  signatureHeader: string,
): Promise<WebhookResult> {
  const secret = getStripeWebhookSecret();
  if (!secret) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "STRIPE_WEBHOOK_SECRET is not configured",
    });
  }

  if (!verifyStripeSignature({ rawBody, signatureHeader, secret })) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid Stripe webhook signature",
    });
  }

  const event = parseStripeEvent(rawBody);
  if (!event.type.startsWith("customer.subscription.")) {
    return { received: true, handled: false };
  }

  const sub = event.data.object as unknown as StripeSubscriptionObject;
  const tenantId = await resolveTenantIdForSubscription(db, sub);
  if (!tenantId) {
    // Nothing to attribute this subscription to — acknowledge so Stripe stops
    // retrying, but don't touch any tenant.
    return { received: true, handled: false };
  }

  const deleted = event.type === "customer.subscription.deleted";
  const status = deleted ? "canceled" : normalizeStatus(sub.status);
  const plan = planForSubscription(sub, status, deleted);
  const priceId = sub.items?.data?.[0]?.price?.id ?? "";
  const currentPeriodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  await db
    .insert(tenantSubscriptions)
    .values({
      tenantId,
      stripeCustomerId: sub.customer,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      status,
      plan,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      currentPeriodEnd,
    })
    .onConflictDoUpdate({
      target: tenantSubscriptions.tenantId,
      set: {
        stripeCustomerId: sub.customer,
        stripeSubscriptionId: sub.id,
        stripePriceId: priceId,
        status,
        plan,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        currentPeriodEnd,
        updatedAt: new Date().toISOString(),
      },
    });

  // Denormalize onto the tenant for cheap entitlement reads, and record the
  // Stripe customer so future checkouts reuse it.
  await db
    .update(tenants)
    .set({
      plan,
      stripeCustomerId: sub.customer,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tenants.id, tenantId));

  return { received: true, handled: true, tenantId, plan };
}
