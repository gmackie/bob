import type { TRPCRouterRecord } from "@trpc/server";

import { protectedProcedure, publicProcedure } from "../trpc";
import { authGetSession, authGetSecretMessage } from "../handlers/auth";

export const authRouter = {
  getSession: publicProcedure.query(({ ctx }) =>
    authGetSession({ db: ctx.db, session: ctx.session }),
  ),
  getSecretMessage: protectedProcedure.query(() => authGetSecretMessage()),
} satisfies TRPCRouterRecord;
