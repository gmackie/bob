import type { TRPCRouterRecord } from "@trpc/server";

import { protectedProcedure, publicProcedure } from "../trpc";
import { systemHealth, systemStatus } from "../handlers/system";

export const systemRouter = {
  health: publicProcedure.query(({ ctx }) =>
    systemHealth({ db: ctx.db, session: ctx.session }),
  ),

  status: protectedProcedure.query(({ ctx }) =>
    systemStatus({ db: ctx.db, userId: ctx.session.user.id }),
  ),
} satisfies TRPCRouterRecord;
