// Effect auth runtime bridge for Bob.
//
// Creates a `ManagedRuntime` that bootstraps gmacko's Effect auth services
// (Sessions, ApiKeys, DeviceCodes, Tenancy) so Bob's tRPC context can call
// `runtime.runPromise(...)` to resolve sessions/keys via the shared auth stack.
//
// The runtime accepts a pre-built drizzle db instance from Bob's side (PGlite
// or node-postgres) and wires it into gmacko's GmackoDb service. This way
// Bob's existing DB bootstrap (which now includes gmacko's auth tables from
// Phase 7B-3 Task 1) provides the single db handle for both Bob's domain
// queries AND gmacko's auth queries.
//
// Phase 7B-3 Task 2.

import { Layer, ManagedRuntime } from "effect";

import {
  initAuth,
  layerBetterAuth,
  layerAuth,
  Sessions,
  ApiKeys,
  Tenancy,
  DeviceCodes,
  type InitAuthOptions,
} from "@gmacko/core/auth";
import { layerGmackoDb } from "@gmacko/core/db";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options for creating the auth runtime bridge.
 *
 * The `db` parameter accepts Bob's drizzle instance (typed loose because
 * `layerGmackoDb` and `initAuth` both accept `unknown`-ish db handles —
 * the drizzle adapter duck-types at runtime).
 */
export interface AuthRuntimeOptions {
  /** Bob's drizzle db instance (PGlite or node-postgres). */
  readonly db: unknown;
  /**
   * Optional drizzle schema map. Passed through to `initAuth` so
   * better-auth's drizzle adapter can resolve tables by name.
   */
  readonly schema?: Record<string, unknown>;
  /**
   * Set to `true` when the schema map uses plural keys (`users`, `sessions`,
   * etc.) — the gmacko convention. Defaults to `false`.
   */
  readonly pluralizeTables?: boolean;
  /** Base URL for better-auth (e.g. `http://localhost:5173`). */
  readonly baseUrl: string;
  /** Production/public URL for redirect URIs. */
  readonly productionUrl: string;
  /** Shared secret for signing sessions. */
  readonly secret: string;
  /** GitHub OAuth client ID. */
  readonly githubClientId: string;
  /** GitHub OAuth client secret. */
  readonly githubClientSecret: string;
  /** Override GitHub OAuth scopes. Default `["user:email", "read:user"]`. */
  readonly githubScopes?: readonly string[];
  /** Additional trusted origins. */
  readonly trustedOrigins?: readonly string[];
  /**
   * Enable email + password auth (off by default — Bob uses GitHub OAuth).
   */
  readonly emailAndPassword?: InitAuthOptions["emailAndPassword"];
  /**
   * Whether to auto-create a personal tenant on user sign-up.
   * Defaults to the gmacko default (true). Tests can disable with `false`.
   */
  readonly bootstrapTenancy?: boolean;
}

// ---------------------------------------------------------------------------
// Runtime type
// ---------------------------------------------------------------------------

/** The set of Effect services the auth runtime provides. */
export type AuthServices = Sessions | ApiKeys | DeviceCodes | Tenancy;

/** The ManagedRuntime type Bob's tRPC context will hold. */
export type AuthRuntime = ManagedRuntime.ManagedRuntime<AuthServices, never>;

/**
 * The return value of `createAuthRuntime()`.
 *
 * Exposes both the ManagedRuntime (for Effect-based auth calls) and the raw
 * better-auth instance (so Bob's tRPC context can call `authInstance.api.getSession()`
 * and return the full session shape that 370+ tRPC tests rely on).
 */
export interface AuthRuntimeBundle {
  /** The ManagedRuntime providing Sessions, ApiKeys, DeviceCodes, Tenancy. */
  readonly runtime: AuthRuntime;
  /**
   * The raw better-auth instance created by gmacko's `initAuth()`.
   *
   * Bob's tRPC context uses `authInstance.api.getSession({ headers })` to
   * resolve the FULL better-auth session shape (with all fields like
   * `session.token`, `session.ipAddress`, `user.emailVerified` etc.) that
   * Bob's 370+ tRPC tests expect. The Effect `Sessions.validateRequest()`
   * returns a narrower `SessionValidationResult`, which is NOT sufficient
   * for backwards compatibility.
   */
  readonly authInstance: ReturnType<typeof initAuth>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a `ManagedRuntime` that provides gmacko's four auth services
 * (Sessions, ApiKeys, DeviceCodes, Tenancy) on top of Bob's drizzle db.
 *
 * Usage in Bob's app bootstrap:
 * ```ts
 * const runtime = createAuthRuntime({
 *   db,
 *   baseUrl: "http://localhost:5173",
 *   productionUrl: "https://blder.bot",
 *   secret: process.env.AUTH_SECRET!,
 *   githubClientId: process.env.AUTH_GITHUB_ID!,
 *   githubClientSecret: process.env.AUTH_GITHUB_SECRET!,
 * });
 *
 * // In tRPC context:
 * const result = await runtime.runPromise(
 *   Effect.flatMap(Sessions.asEffect(), (s) => s.validateRequest(headers))
 * );
 * ```
 */
export function createAuthRuntime(opts: AuthRuntimeOptions): AuthRuntimeBundle {
  // 1. Create the better-auth instance using gmacko's initAuth.
  const authInstance = initAuth({
    db: opts.db,
    schema: opts.schema,
    pluralizeTables: opts.pluralizeTables,
    baseUrl: opts.baseUrl,
    productionUrl: opts.productionUrl,
    secret: opts.secret,
    githubClientId: opts.githubClientId,
    githubClientSecret: opts.githubClientSecret,
    githubScopes: opts.githubScopes,
    trustedOrigins: opts.trustedOrigins,
    emailAndPassword: opts.emailAndPassword,
    bootstrapTenancy: opts.bootstrapTenancy,
  });

  // 2. Build layers.
  //    - layerGmackoDb wraps the drizzle db as the GmackoDb Effect service.
  //    - layerBetterAuth wraps the auth instance as the BetterAuth Effect service.
  //    - layerAuth() bundles Sessions + ApiKeys + DeviceCodes + Tenancy,
  //      requiring GmackoDb | BetterAuth.
  // `as never` — Db is typed against gmacko's schema but Bob's drizzle instance
  // is structurally compatible; auth services use direct table refs, not relational queries.
  const dbLayer = layerGmackoDb(opts.db as never);
  const betterAuthLayer = layerBetterAuth(authInstance);
  const authServicesLayer = layerAuth();

  // 3. Provide GmackoDb + BetterAuth into the auth services layer,
  //    yielding a fully-satisfied Layer<Sessions | ApiKeys | DeviceCodes | Tenancy>.
  const fullLayer = Layer.provide(
    authServicesLayer,
    Layer.mergeAll(dbLayer, betterAuthLayer),
  );

  // 4. Create the ManagedRuntime.
  const runtime = ManagedRuntime.make(fullLayer);

  return { runtime, authInstance };
}

export { Sessions, ApiKeys, Tenancy, DeviceCodes };
