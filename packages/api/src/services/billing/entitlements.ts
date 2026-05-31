import { TRPCError } from "@trpc/server";

import { eq } from "@bob/db";
import { tenants, workspaces } from "@bob/db/schema";

export const paidTenantPlans = ["premium", "pro"] as const;
export type PaidTenantPlan = (typeof paidTenantPlans)[number];
export type TenantPlan = "free" | PaidTenantPlan;

export function isTenantPlan(value: unknown): value is TenantPlan {
  return value === "free" || value === "premium" || value === "pro";
}

export function hasPaidEntitlement(plan: TenantPlan): plan is PaidTenantPlan {
  return plan === "premium" || plan === "pro";
}

export function requirePaidTenantPlan(plan: unknown) {
  if (!isTenantPlan(plan) || !hasPaidEntitlement(plan)) {
    throw new TRPCError({
      code: "PAYMENT_REQUIRED",
      message: "This feature requires an active paid plan.",
    });
  }
}

export async function requirePaidTenantByWorkspace(
  db: any,
  workspaceId: string | null | undefined,
) {
  if (!workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: { id: true, tenantId: true },
    with: { tenant: true },
  });

  if (!workspace?.tenantId || !workspace.tenant) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  requirePaidTenantPlan(workspace.tenant.plan);

  return workspace.tenant;
}

export interface StripeEntitlementUpdate {
  tenantId?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
  priceId?: string | null;
  productId?: string | null;
  plan: TenantPlan;
}

export async function updateTenantStripeEntitlement(
  db: any,
  update: StripeEntitlementUpdate,
) {
  const selector = update.tenantId
    ? eq(tenants.id, update.tenantId)
    : update.subscriptionId
      ? eq(tenants.stripeSubscriptionId, update.subscriptionId)
      : update.customerId
        ? eq(tenants.stripeCustomerId, update.customerId)
        : null;

  if (!selector) {
    throw new Error(
      "Stripe entitlement update requires tenant, subscription, or customer id",
    );
  }

  const [tenant] = await db
    .update(tenants)
    .set({
      plan: update.plan,
      stripeCustomerId: update.customerId ?? null,
      stripeSubscriptionId: update.subscriptionId ?? null,
      stripePriceId: update.priceId ?? null,
      stripeProductId: update.productId ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(selector)
    .returning();

  return tenant ?? null;
}
