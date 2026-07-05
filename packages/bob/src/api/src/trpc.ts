import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z, ZodError } from "zod/v4";

import {


  DEFAULT_USER_ID,
  resolveAuthBypassUserId,
  resolveAuthContext
} from "@bob/auth";
import type {ApiKeyPermission} from "@bob/auth";
import type { AuthRuntimeBundle } from "@bob/auth/runtime";
import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { user } from "@bob/db/schema";
import { ensureUserMembershipForOwnedWorkspaces } from "./handlers/workspace";

/**
 * Create the tRPC context using the Effect auth runtime bridge.
 *
 * Accepts an `AuthRuntimeBundle` (from `createAuthRuntime()`) and calls
 * `authInstance.api.getSession()` internally to resolve the full better-auth
 * session shape. The returned context has the exact same shape as before so
 * all 370+ tRPC tests pass unchanged.
 *
 * Phase 7B-3 Task 3.
 */
export const createTRPCContext = async (opts: {
  headers: Headers;
  authBundle: AuthRuntimeBundle;
}) => {
  const authApi = opts.authBundle.authInstance.api;
  let defaultUser:
    | {
        session: null;
        user: typeof user.$inferSelect;
      }
    | null = null;
  const authBypassUserId = resolveAuthBypassUserId(opts.headers);
  const defaultUserId = authBypassUserId ?? DEFAULT_USER_ID;

  if (process.env.REQUIRE_AUTH !== "true" || authBypassUserId) {
    const [userRecord] = await db
      .select()
      .from(user)
      .where(eq(user.id, defaultUserId))
      .limit(1);

    if (userRecord) {
      defaultUser = {
        user: userRecord,
        session: null,
      };

      if (authBypassUserId) {
        await ensureUserMembershipForOwnedWorkspaces(db, authBypassUserId);
      }
    }
  }

  const authContext = await resolveAuthContext({
    authBundle: opts.authBundle,
    defaultUser,
    headers: opts.headers,
  });

  return {
    authApi,
    session: authContext.session,
    apiKeyAuth: authContext.apiKeyAuth,
    db,
  };
};
/**
 * 2. INITIALIZATION
 *
 * This is where the trpc api is initialized, connecting the context and
 * transformer
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
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

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these
 * a lot in the /src/server/api/routers folder
 */

/**
 * This is how you create new routers and subrouters in your tRPC API
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an articifial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    // artificial delay in dev 100-500ms
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const end = Date.now();
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

  return result;
});

/**
 * Public (unauthed) procedure
 *
 * This is the base piece you use to build new queries and mutations on your
 * tRPC API. It does not guarantee that a user querying is authorized, but you
 * can still access user session data if they are logged in
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
      ctx: {
        session: { ...ctx.session, user: ctx.session.user },
      },
    });
  });

const createApiKeyProcedure = (requiredPermission: ApiKeyPermission) =>
  t.procedure.use(timingMiddleware).use(({ ctx, next }) => {
    if (!ctx.apiKeyAuth) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "API key required",
      });
    }

    const hasPermission =
      ctx.apiKeyAuth.permissions.includes("admin") ||
      ctx.apiKeyAuth.permissions.includes(requiredPermission);

    if (!hasPermission) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `API key lacks '${requiredPermission}' permission`,
      });
    }

    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    return next({
      ctx: {
        session: { ...ctx.session, user: ctx.session.user },
        apiKeyAuth: ctx.apiKeyAuth,
      },
    });
  });

export const apiKeyReadProcedure = createApiKeyProcedure("read");
export const apiKeyWriteProcedure = createApiKeyProcedure("write");
export const apiKeyDeleteProcedure = createApiKeyProcedure("delete");
export const apiKeyAdminProcedure = createApiKeyProcedure("admin");
