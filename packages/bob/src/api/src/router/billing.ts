import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import {
  createCheckoutSession,
  getEntitlements,
  handleStripeWebhook,
  listPlans,
} from "../handlers/billing";
import { protectedProcedure, publicProcedure } from "../trpc";

export const billingRouter = {
  /** Current tenant's plan, entitled features, and limits. */
  entitlements: protectedProcedure.query(({ ctx }) =>
    getEntitlements({ db: ctx.db, userId: ctx.session.user.id }),
  ),

  /** Purchasable plans with their configured Stripe prices. */
  plans: publicProcedure.query(() => listPlans()),

  /** Start a Stripe Checkout Session to upgrade the tenant's plan. */
  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        plan: z.enum(["premium", "pro"]),
        successUrl: z.string().url(),
        cancelUrl: z.string().url(),
      }),
    )
    .mutation(({ ctx, input }) =>
      createCheckoutSession(
        {
          db: ctx.db,
          userId: ctx.session.user.id,
          userEmail: ctx.session.user.email,
        },
        input,
      ),
    ),

  /**
   * Stripe webhook sink. Kept on a public procedure because Stripe authenticates
   * via the signature, not a session. The raw request body MUST be forwarded
   * verbatim as `payload` — any re-serialization breaks signature verification.
   */
  webhook: publicProcedure
    .input(z.object({ payload: z.string(), signature: z.string() }))
    .mutation(({ ctx, input }) =>
      handleStripeWebhook(ctx.db, input.payload, input.signature),
    ),
} satisfies TRPCRouterRecord;
