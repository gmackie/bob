import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { OpenApiMeta } from "trpc-to-openapi";
import { z, ZodError } from "zod";

import type { AuthInstance } from "@gmacko/core/auth";
import { db } from "@gmacko/ooda/db/client";

export const createTRPCContext = async (opts: {
  headers: Headers;
  auth?: AuthInstance;
}) => {
  return { db, headers: opts.headers, auth: opts.auth };
};

export const t = initTRPC
  .meta<OpenApiMeta>()
  .context<typeof createTRPCContext>()
  .create({
    transformer: superjson,
    errorFormatter: ({ shape, error }) => ({
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError
            ? z.flattenError(error.cause as ZodError<Record<string, unknown>>)
            : null,
      },
    }),
  });

export const createTRPCRouter = t.router;

export const publicProcedure = t.procedure;

export const runnerProcedure = t.procedure.use(async ({ ctx, next }) => {
  const secret = process.env.OODA_RUNNER_SECRET;
  if (!secret) return next();
  const bearer = ctx.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer || bearer !== secret) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid runner secret" });
  }
  return next();
});

export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Auth not configured",
    });
  }

  const session = await ctx.auth.api.getSession({
    headers: ctx.headers,
  });

  if (!session?.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Not authenticated",
    });
  }

  return next({
    ctx: {
      ...ctx,
      userId: session.user.id,
      email: session.user.email,
      session,
    },
  });
});
