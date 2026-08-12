import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { OpenApiMeta } from "trpc-to-openapi";
import { z, ZodError } from "zod";

import type { AuthInstance } from "@gmacko/core/auth";
import { validateApiKey } from "@gmacko/core/auth/validate-api-key";
import { db } from "@gmacko/ooda/db/client";

import type { OodaRolloutCapabilityV1 } from "../contracts/v1";
import { resolveOodaRolloutPolicy } from "../kernel/rollout-policy";

export const createTRPCContext = async (opts: {
  headers: Headers;
  auth?: AuthInstance;
  // On the CF Workers edge, callers inject the per-request Hyperdrive client
  // (apps/ooda-edge's lazy proxy) — the module-level `db` binds its
  // prepared-statement config at import time, before the edge sets its
  // per-request env, so it can't be used to query at the edge. Defaults to the
  // module `db` for the Node runtime.
  db?: typeof db;
}) => {
  return { db: opts.db ?? db, headers: opts.headers, auth: opts.auth };
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
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid runner secret",
    });
  }
  return next();
});

/**
 * Agent jobs can execute tools in a trusted host environment, so unlike the
 * legacy runner protocol this lane fails closed when no shared secret exists.
 */
export const trustedRunnerProcedure = t.procedure.use(async ({ ctx, next }) => {
  const secret = process.env.OODA_RUNNER_SECRET?.trim();
  if (!secret) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "OODA_RUNNER_SECRET must be configured before agent jobs can run",
    });
  }
  const bearer = ctx.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer !== secret) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid runner secret",
    });
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

  // Extract the machine credential before consulting better-auth. At the edge,
  // Hyperdrive clients are request-scoped; opening a session lookup before the
  // API-key lookup can consume/lose that binding even though a key-only caller
  // has no browser session to resolve. Cookie-bearing requests still consult
  // better-auth first so browser identity keeps precedence when both
  // credentials are present.
  const apiKey =
    ctx.headers.get("x-api-key")?.trim() ||
    ctx.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() ||
    null;
  const hasCookie = Boolean(ctx.headers.get("cookie")?.trim());

  const session =
    !apiKey || hasCookie
      ? await ctx.auth.api.getSession({ headers: ctx.headers })
      : null;

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
  if (apiKey) {
    // `db as never` — OODA's drizzle instance is structurally compatible with
    // the validator's `PgDatabase` param, but resolves to a different copy of
    // `drizzle-orm` than @gmacko/core, so the protected-member nominal check
    // fails. Same cross-package shim the Bob auth runtime uses (`opts.db as
    // never`). The validator only issues plain `select`s via explicit table
    // refs, so runtime behavior is identical.
    // `usersTable: null` skips the owner-email join: the deployed Bob DB's
    // `api_keys.user_id` is a text FK to the better-auth `"user"` table, which
    // type-clashes the core `users` (uuid) table and fails the join query.
    // Identity is established by `userId`; email is best-effort (empty when the
    // join is skipped) and not used for authorization.
    // Key-only edge requests deliberately skip the unrelated better-auth
    // lookup above, keeping this validation on the request-bound Hyperdrive
    // client. Cookie-bearing requests preserve browser-session precedence.
    const result = await validateApiKey(
      ctx.db as never,
      apiKey,
      undefined,
      null,
    );
    if (result.ok) {
      const email = result.value.email ?? "";
      return next({
        ctx: {
          ...ctx,
          userId: result.value.userId,
          email,
          // Minimal session-shaped object so downstream code reading
          // `ctx.session.user` continues to work for key-authenticated calls.
          session: {
            user: { id: result.value.userId, email },
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

export const rolloutProcedure = (capability: OodaRolloutCapabilityV1) =>
  authedProcedure.use(({ ctx, next }) => {
    const policy = resolveOodaRolloutPolicy(ctx.userId);
    if (!policy.capabilities[capability]) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          `OODA rollout capability ${capability} is not enabled at stage ${policy.stage}. ${policy.reasons.join(" ")}`.trim(),
      });
    }
    return next({ ctx: { ...ctx, rolloutPolicy: policy } });
  });
