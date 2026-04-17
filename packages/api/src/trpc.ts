import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { Database } from "@gmacko/db";

export interface TRPCContext {
  db: Database;
}

export const createTRPCContext = (db: Database): TRPCContext => ({ db });

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
