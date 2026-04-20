// Wraps better-auth as an Effect `ServiceMap.Service`.
//
// - `initAuth(opts)` constructs a `betterAuth(...)` instance mirroring Bob's
//   config (drizzle adapter, github social provider, expo plugin, trusted
//   origins). The `db` is typed as `unknown` on purpose: drizzle's cross-driver
//   types are brittle and the adapter only probes duck-typed methods at
//   runtime, so threading a strict type through would cost more than it buys.
// - `BetterAuth` is the Effect service tag; `layerBetterAuth` hoists a
//   pre-built instance into a Layer for downstream services/middleware.
//
// NOTE: not exported from the package barrel yet — Task 17 handles the public
// API surface. For now callers inside @gmacko/auth import from this module
// directly.
import { expo } from "@better-auth/expo";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { Layer, ServiceMap } from "effect";

export type AuthInstance = ReturnType<typeof betterAuth>;

export class BetterAuth extends ServiceMap.Service<BetterAuth, AuthInstance>()(
  "@gmacko/auth/BetterAuth",
) {}

export interface InitAuthOptions {
  /**
   * Drizzle db instance (from `drizzle-orm/pglite` or `drizzle-orm/postgres-js`).
   * Typed loose because the drizzle adapter duck-types against the driver
   * surface; propagating a precise type through cross-driver code is brittle.
   */
  readonly db: unknown;
  /** The base URL better-auth serves from (e.g. `http://localhost:3000`). */
  readonly baseUrl: string;
  /** The production/public URL for constructing redirect URIs. */
  readonly productionUrl: string;
  /** Shared secret used by better-auth to sign sessions. */
  readonly secret: string;
  readonly githubClientId: string;
  readonly githubClientSecret: string;
  /** Additional origins (beyond the built-in defaults) trusted for CORS/redirects. */
  readonly trustedOrigins?: readonly string[];
}

export function initAuth(opts: InitAuthOptions): AuthInstance {
  const config = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see note on InitAuthOptions.db
    database: drizzleAdapter(opts.db as any, { provider: "pg" }),
    baseURL: opts.baseUrl,
    secret: opts.secret,
    plugins: [expo()],
    socialProviders: {
      github: {
        clientId: opts.githubClientId,
        clientSecret: opts.githubClientSecret,
        redirectURI: `${opts.productionUrl}/api/auth/callback/github`,
        scope: ["user:email", "read:user"],
      },
    },
    trustedOrigins: Array.from(
      new Set(
        [
          "expo://",
          "gmacko://",
          "http://localhost:3000",
          opts.baseUrl,
          opts.productionUrl,
          ...(opts.trustedOrigins ?? []),
        ].filter(Boolean),
      ),
    ),
  } satisfies BetterAuthOptions;

  return betterAuth(config);
}

/** Provide a pre-constructed `AuthInstance` as the `BetterAuth` service. */
export const layerBetterAuth = (instance: AuthInstance): Layer.Layer<BetterAuth> =>
  Layer.succeed(BetterAuth)(instance);
