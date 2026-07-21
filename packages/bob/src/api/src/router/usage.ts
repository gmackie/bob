import type { TRPCRouterRecord } from "@trpc/server";

import { protectedProcedure } from "../trpc";
import { usageGetSnapshot, usageListPlanQuotas } from "../handlers/usage";

export const usageRouter = {
  /** Current tenant plan, limits, and live usage meters. */
  snapshot: protectedProcedure.query(({ ctx }) =>
    usageGetSnapshot({ db: ctx.db, userId: ctx.session.user.id }),
  ),

  /** Static catalog of plan → quota limits (for pricing / upgrade UI). */
  plans: protectedProcedure.query(({ ctx }) =>
    usageListPlanQuotas({ db: ctx.db, userId: ctx.session.user.id }),
  ),
} satisfies TRPCRouterRecord;
