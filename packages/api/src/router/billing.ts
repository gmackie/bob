import { z } from "zod/v4";

import type { TenantPlan } from "../services/billing/stripeBilling";
import {
  assertTenantBillingAdmin,
  billableTenantPlans,
  ensureStripeCustomer,
  getBillingBaseUrl,
  getStripeClient,
  getStripePlanConfig,
  getTenantMembership,
  requireTenantPlan,
} from "../services/billing/stripeBilling";
import { protectedProcedure } from "../trpc";

export const billingRouter = {
  getTenantPlan: protectedProcedure
    .input(z.object({ tenantId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const membership = await getTenantMembership(
        ctx.db,
        ctx.session.user.id,
        input.tenantId,
      );

      return {
        tenantId: membership.tenant.id,
        plan: membership.tenant.plan,
        stripeSubscriptionStatus: membership.tenant.stripeSubscriptionStatus,
      };
    }),

  assertTenantPlan: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().uuid(),
        requiredPlan: z.enum(["free", "premium", "pro"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenant = await requireTenantPlan(
        ctx.db,
        ctx.session.user.id,
        input.tenantId,
        input.requiredPlan as TenantPlan,
      );

      return { ok: true, tenantId: tenant.id, plan: tenant.plan };
    }),

  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().uuid(),
        plan: z.enum(billableTenantPlans),
        successUrl: z.string().url().optional(),
        cancelUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await getTenantMembership(
        ctx.db,
        ctx.session.user.id,
        input.tenantId,
      );
      assertTenantBillingAdmin(membership.role);

      const stripe = getStripeClient();
      const customerId = await ensureStripeCustomer({
        db: ctx.db,
        stripe,
        tenant: membership.tenant,
        user: ctx.session.user,
      });
      const baseUrl = getBillingBaseUrl();
      const planConfig = getStripePlanConfig(input.plan);

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: planConfig.priceId, quantity: 1 }],
        success_url:
          input.successUrl ??
          `${baseUrl}/settings/billing?checkout=success&tenant=${input.tenantId}`,
        cancel_url:
          input.cancelUrl ??
          `${baseUrl}/settings/billing?checkout=cancelled&tenant=${input.tenantId}`,
        client_reference_id: input.tenantId,
        metadata: {
          tenantId: input.tenantId,
          plan: input.plan,
        },
        subscription_data: {
          metadata: {
            tenantId: input.tenantId,
            plan: input.plan,
          },
        },
      });

      return { id: session.id, url: session.url };
    }),

  createPortalSession: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().uuid(),
        returnUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await getTenantMembership(
        ctx.db,
        ctx.session.user.id,
        input.tenantId,
      );
      assertTenantBillingAdmin(membership.role);

      const stripe = getStripeClient();
      const customerId = await ensureStripeCustomer({
        db: ctx.db,
        stripe,
        tenant: membership.tenant,
        user: ctx.session.user,
      });
      const baseUrl = getBillingBaseUrl();

      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url:
          input.returnUrl ??
          `${baseUrl}/settings/billing?tenant=${input.tenantId}`,
      });

      return { id: session.id, url: session.url };
    }),
};
