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

import {
  tenants as tenantsTable,
  tenantMembers as membersTable,
} from "@gmacko/db/schema/tenancy";

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
  /**
   * Optional drizzle schema map. The drizzle adapter looks up tables by name
   * — when omitted it scrapes table identifiers from the `db` instance's
   * relational metadata, which works in many setups but fails when our PG
   * schema deviates from better-auth's expected table name (we use plural
   * `users`/`sessions` etc.). Passing the schema explicitly + `pluralizeTables`
   * keeps the adapter aligned with our actual DDL.
   */
  readonly schema?: Record<string, unknown>;
  /**
   * Set to `true` when the schema map uses plural keys (`users`, `sessions`,
   * `accounts`, `verifications`) — the gmacko convention. Better-auth itself
   * expects singular (`user`, `session`, …). Defaults to `false` for
   * backwards compatibility with callers that pass a singular schema.
   */
  readonly pluralizeTables?: boolean;
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
  /**
   * Enable better-auth's email + password provider. Defaults to `false`
   * because the production wiring relies on GitHub OAuth + the device-code
   * pairing flow. Tests / dev environments that want the `/sign-up/email`
   * + `/sign-in/email` endpoints flip this to `true` and (typically) also
   * set `requireEmailVerification: false` so a sign-in immediately returns
   * a session cookie.
   */
  readonly emailAndPassword?: {
    readonly enabled: boolean;
    readonly requireEmailVerification?: boolean;
  };
  /**
   * When `true` (default), wires a `databaseHooks.user.create.after` that
   * creates a personal `tenants` row + `tenant_members` row (role: owner)
   * for every newly-signed-up user. Test setups that pre-seed tenancy can
   * disable this by passing `false`.
   */
  readonly bootstrapTenancy?: boolean;
}

export function initAuth(opts: InitAuthOptions): AuthInstance {
  // Build the `emailAndPassword` block conditionally — better-auth treats an
  // omitted block as "provider disabled" (default), so we only pass it when
  // the caller wants it on. Confirmed against
  // `better-auth@1.4.0-beta.9`'s api/index.mjs:175 which gates the
  // `/sign-up/email` route on `options.emailAndPassword?.enabled`.
  const emailAndPassword = opts.emailAndPassword?.enabled
    ? {
        enabled: true,
        requireEmailVerification:
          opts.emailAndPassword.requireEmailVerification ?? true,
      }
    : undefined;

  // Tenant bootstrap hook — see InitAuthOptions.bootstrapTenancy.
  //
  // Better-auth's `databaseHooks.user.create.after` runs sequentially AFTER the
  // user row is committed — NOT inside the same transaction. If this hook
  // throws (e.g. transient DB error on tenant insert), the user row stays
  // orphaned with no tenancy. The two inserts below are wrapped in their own
  // transaction so tenant + tenant_members are atomic with each other; future
  // work may add a startup self-heal pass for users with no membership.
  //
  // Note: tenants.slug is NOT NULL UNIQUE; we derive it from the user id so
  // it's stable + unique without coordination. tenants has no
  // `createdByUserId` column — the membership row is the only persisted
  // creator-link.
  const databaseHooks =
    opts.bootstrapTenancy === false
      ? undefined
      : {
          user: {
            create: {
              after: async (user: {
                id: string;
                name?: string | null;
                email: string;
              }) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see note on InitAuthOptions.db
                const drizzleDb = opts.db as any;
                const personalName =
                  user.name?.trim() ||
                  user.email.split("@")[0] ||
                  "Personal";
                const slug = `personal-${user.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32)}`;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle tx type varies by driver
                await drizzleDb.transaction(async (tx: any) => {
                  const [tenantRow] = await tx
                    .insert(tenantsTable)
                    .values({
                      name: `${personalName}'s workspace`,
                      slug,
                    })
                    .returning();
                  if (!tenantRow) {
                    // `.returning()` returning empty would mean the insert
                    // didn't materialise a row — drizzle/PGlite shouldn't
                    // ever produce this state, but if they do, surface it
                    // loudly rather than silently leaving the user with no
                    // tenancy. Better-auth turns this into a 500 on the
                    // sign-up call so the client knows to retry.
                    throw new Error(
                      `Tenant bootstrap failed: insert returned no row for user ${user.id}`,
                    );
                  }
                  await tx.insert(membersTable).values({
                    tenantId: tenantRow.id,
                    userId: user.id,
                    role: "owner",
                  });
                });
              },
            },
          },
        };

  const config = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see note on InitAuthOptions.db
    database: drizzleAdapter(opts.db as any, {
      provider: "pg",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(opts.schema ? { schema: opts.schema as any } : {}),
      ...(opts.pluralizeTables ? { usePlural: true } : {}),
    }),
    baseURL: opts.baseUrl,
    secret: opts.secret,
    plugins: [expo()],
    ...(emailAndPassword ? { emailAndPassword } : {}),
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
    ...(databaseHooks ? { databaseHooks } : {}),
  } satisfies BetterAuthOptions;

  return betterAuth(config);
}

/** Provide a pre-constructed `AuthInstance` as the `BetterAuth` service. */
export const layerBetterAuth = (instance: AuthInstance): Layer.Layer<BetterAuth> =>
  Layer.succeed(BetterAuth)(instance);
