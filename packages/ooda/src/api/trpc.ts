import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { OpenApiMeta } from "trpc-to-openapi";
import { z, ZodError } from "zod";

import { db } from "@gmacko/ooda/db/client";
import { validateSessionToken, extractSessionToken, SessionNotFoundError } from "@gmacko/ooda/db/auth";

export const createTRPCContext = async (opts: { headers: Headers }) => {
  return { db, headers: opts.headers };
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
  const token = extractSessionToken(ctx.headers);
  if (!token) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Missing session token",
    });
  }

  try {
    const { userId, email } = await validateSessionToken(ctx.db, token);
    return next({ ctx: { ...ctx, userId, email } });
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid or expired session",
      });
    }
    throw err;
  }
});
