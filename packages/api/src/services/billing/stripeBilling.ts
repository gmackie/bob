import { TRPCError } from "@trpc/server";

import { and, eq } from "@bob/db";
import { tenantMembers, tenantPlanEnum, tenants } from "@bob/db/schema";
import { Stripe } from "@bob/payments";

export type TenantPlan = (typeof tenantPlanEnum.enumValues)[number];

export const billableTenantPlans = [
  "premium",
  "pro",
] as const satisfies readonly TenantPlan[];

const PLAN_RANK: Record<TenantPlan, number> = {
  free: 0,
  premium: 1,
  pro: 2,
};

type BillableTenantPlan = (typeof billableTenantPlans)[number];

type TenantMembership = {
  role: "owner" | "admin" | "member";
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: TenantPlan;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    stripeSubscriptionStatus: string | null;
  };
};

export function hasTenantPlan(
  currentPlan: TenantPlan,
  requiredPlan: TenantPlan,
) {
  return PLAN_RANK[currentPlan] >= PLAN_RANK[requiredPlan];
}

export async function requireTenantPlan(
  db: any,
  userId: string,
  tenantId: string,
  requiredPlan: TenantPlan,
) {
  const membership = await getTenantMembership(db, userId, tenantId);
  if (!hasTenantPlan(membership.tenant.plan, requiredPlan)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${requiredPlan} plan required`,
    });
  }
  return membership.tenant;
}

export async function getTenantMembership(
  db: any,
  userId: string,
  tenantId: string,
): Promise<TenantMembership> {
  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.userId, userId),
    ),
    columns: { role: true },
    with: { tenant: true },
  });

  if (!membership?.tenant) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  return membership as TenantMembership;
}

export function assertTenantBillingAdmin(role: TenantMembership["role"]) {
  if (role !== "owner" && role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Tenant owner or admin required",
    });
  }
}

export function getStripeClient(
  env: Record<string, string | undefined> = process.env,
) {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "STRIPE_SECRET_KEY is not configured",
    });
  }

  return new Stripe(secretKey);
}

export function constructStripeWebhookEvent(input: {
  body: string;
  signature: string | null;
  env?: Record<string, string | undefined>;
}) {
  const env = input.env ?? process.env;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "STRIPE_WEBHOOK_SECRET is not configured",
    });
  }
  if (!input.signature) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Missing Stripe signature",
    });
  }

  return getStripeClient(env).webhooks.constructEvent(
    input.body,
    input.signature,
    webhookSecret,
  );
}

export function getBillingBaseUrl(
  env: Record<string, string | undefined> = process.env,
) {
  return (
    env.FRONTEND_URL ??
    env.NEXT_PUBLIC_SITE_URL ??
    env.BOB_APP_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function getStripePlanConfig(
  plan: BillableTenantPlan,
  env: Record<string, string | undefined> = process.env,
) {
  const key = plan.toUpperCase();
  const priceId = env[`STRIPE_${key}_PRICE_ID`]?.trim();
  const productId = env[`STRIPE_${key}_PRODUCT_ID`]?.trim();

  if (!priceId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `STRIPE_${key}_PRICE_ID is not configured`,
    });
  }

  return { plan, priceId, productId: productId || null };
}

export function planFromStripeIds(
  priceId: string | null | undefined,
  productId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): TenantPlan | null {
  for (const plan of billableTenantPlans) {
    const key = plan.toUpperCase();
    if (priceId && env[`STRIPE_${key}_PRICE_ID`]?.trim() === priceId) {
      return plan;
    }
    if (productId && env[`STRIPE_${key}_PRODUCT_ID`]?.trim() === productId) {
      return plan;
    }
  }

  return null;
}

export async function ensureStripeCustomer(input: {
  db: any;
  stripe: Stripe;
  tenant: TenantMembership["tenant"];
  user: { id: string; email?: string | null; name?: string | null };
}) {
  if (input.tenant.stripeCustomerId) {
    return input.tenant.stripeCustomerId;
  }

  const customer = await input.stripe.customers.create({
    email: input.user.email ?? undefined,
    name: input.tenant.name,
    metadata: {
      tenantId: input.tenant.id,
      userId: input.user.id,
    },
  });

  await input.db
    .update(tenants)
    .set({ stripeCustomerId: customer.id })
    .where(eq(tenants.id, input.tenant.id));

  return customer.id;
}

export async function syncTenantSubscriptionPlan(input: {
  db: any;
  subscriptionId: string;
  customerId: string | null;
  status: string | null;
  priceId?: string | null;
  productId?: string | null;
  metadataTenantId?: string | null;
}) {
  const plan = planFromStripeIds(input.priceId, input.productId) ?? "free";
  const activeStatuses = new Set(["active", "trialing"]);
  const tenantPlan = activeStatuses.has(input.status ?? "") ? plan : "free";

  const values = {
    plan: tenantPlan,
    stripeCustomerId: input.customerId,
    stripeSubscriptionId: input.subscriptionId,
    stripeSubscriptionStatus: input.status,
    updatedAt: new Date().toISOString(),
  };

  if (input.metadataTenantId) {
    await input.db
      .update(tenants)
      .set(values)
      .where(eq(tenants.id, input.metadataTenantId));
    return tenantPlan;
  }

  if (input.customerId) {
    await input.db
      .update(tenants)
      .set(values)
      .where(eq(tenants.stripeCustomerId, input.customerId));
  }

  return tenantPlan;
}

export async function syncStripeSubscription(input: {
  db: any;
  subscription: Stripe.Subscription;
}) {
  const item = input.subscription.items.data[0];
  const price = item?.price;
  const productId =
    typeof price?.product === "string" ? price.product : price?.product?.id;
  const customerId =
    typeof input.subscription.customer === "string"
      ? input.subscription.customer
      : input.subscription.customer?.id;

  return syncTenantSubscriptionPlan({
    db: input.db,
    subscriptionId: input.subscription.id,
    customerId: customerId ?? null,
    status: input.subscription.status,
    priceId: price?.id ?? null,
    productId: productId ?? null,
    metadataTenantId: input.subscription.metadata.tenantId ?? null,
  });
}
