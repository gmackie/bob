import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { OpenApiMeta } from "trpc-to-openapi";
import { z, ZodError } from "zod";

import type { AuthInstance } from "@gmacko/core/auth";
import { validateApiKey } from "@gmacko/core/auth/validate-api-key";
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

  // Primary path: a browser better-auth session cookie. Unchanged — this is
  // still the only credential a browser client presents.
  const session = await ctx.auth.api.getSession({
    headers: ctx.headers,
  });

  if (session?.user) {
    return next({
      ctx: {
        ...ctx,
        userId: session.user.id,
        email: session.user.email,
        session,
      },
    });
  }

  // Secondary path: a programmatic API key for machine clients (e.g. the
  // LevelForge studio backend) that cannot present a browser cookie. Accepted
  // as either `x-api-key: <key>` or `Authorization: Bearer <key>` — the two
  // header forms LevelForge tries. The key is validated against the SAME
  // `api_keys` table + algorithm as Bob's `ApiKeys.validateKey` (exact sha256
  // hash match, revoked + expired enforced). A missing, malformed, unknown,
  // revoked, or expired key falls through to UNAUTHORIZED below — no bypass.
  const apiKey =
    ctx.headers.get("x-api-key")?.trim() ||
    ctx.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    null;

  if (apiKey) {
    // `db as never` — OODA's drizzle instance is structurally compatible with
    // the validator's `PgDatabase` param, but resolves to a different copy of
    // `drizzle-orm` than @gmacko/core, so the protected-member nominal check
    // fails. Same cross-package shim the Bob auth runtime uses (`opts.db as
    // never`). The validator only issues plain `select`s via explicit table
    // refs, so runtime behavior is identical.
    const result = await validateApiKey(db as never, apiKey);
    if (result.ok) {
      return next({
        ctx: {
          ...ctx,
          userId: result.value.userId,
          email: result.value.email,
          // Minimal session-shaped object so downstream code reading
          // `ctx.session.user` continues to work for key-authenticated calls.
          session: {
            user: { id: result.value.userId, email: result.value.email },
          },
        },
      });
    }
  }

  throw new TRPCError({
    code: "UNAUTHORIZED",
    message: "Not authenticated",
  });
});
