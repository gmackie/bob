// Shared, plain-async API-key validator backed by the `api_keys` table.
//
// This is the SINGLE source of truth for how a plaintext programmatic API key
// is turned into an authenticated identity. It is deliberately framework-free
// (no Effect, no better-auth) so it can be consumed by BOTH:
//
//   1. The Effect `ApiKeys` service (`api-keys.ts` → `validateKey` delegates
//      here), and
//   2. OODA's tRPC `authedProcedure` (`packages/ooda/src/api/trpc.ts`), which
//      has no Effect runtime in its request path.
//
// The algorithm mirrors the historical `ApiKeys.validateKey` EXACTLY:
//   - reject anything not carrying an accepted prefix (`gmk_` / `bob_`),
//   - `sha256(plaintext)` hex compare against `api_keys.key_hash`,
//   - join `users` for the owning email,
//   - reject revoked keys (`revoked_at` set),
//   - reject expired keys (`expires_at <= now`).
//
// It is READ-ONLY: it never mutates `last_used_at`. The Effect service layers
// that fire-and-forget write on top after a successful validation.
//
// Dependency hygiene: this module imports only `node:crypto`, `drizzle-orm`,
// and the two schema tables — matching the `errors.ts` pattern so it can be
// pulled into a Node request path without dragging in better-auth/effect.
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

import {
  apiKeys as apiKeysTable,
  type ApiKeyPermission,
} from "@gmacko/core/db/schema/api-keys";
import { users as usersTable } from "@gmacko/core/db/schema/auth";

/**
 * Accepted plaintext key prefixes. This is the canonical list shared by the
 * core `ApiKeys` service default and OODA's programmatic-auth path. It is
 * byte-identical to Bob's `API_KEY_PREFIXES` (`packages/bob/src/auth/src/
 * api-key.ts`) — `gmk_` (gmacko-issued) and `bob_` (Bob device-flow issued).
 */
export const API_KEY_PREFIXES = ["gmk_", "bob_"] as const;

/**
 * Successful validation payload — the owning identity for the key.
 *
 * NOTE: intentionally does NOT include `tenantId`. The `tenant_id` column
 * exists in the gmacko-core `api_keys` schema but NOT in the deployed Bob
 * `api_keys` table (the runtime DB OODA queries — Bob's device-flow keys
 * predate tenancy). Selecting only the columns common to BOTH schemas keeps
 * this validator runtime-safe against the live Bob database. Callers that
 * need `tenantId` (the Effect `ApiKeys` service, which targets the core
 * schema) enrich it separately.
 */
export interface ValidatedApiKey {
  readonly keyId: string;
  readonly userId: string;
  /**
   * Owner email, or `null` when the caller skipped the users-table join
   * (`usersTable: null`) — required against the deployed Bob DB, whose
   * `api_keys.user_id` FKs the better-auth `"user"` table (text id) and would
   * type-clash the core `users` table (uuid id). Identity is still established
   * by `userId`; callers that need the email resolve it against their own
   * users table.
   */
  readonly email: string | null;
  readonly permissions: readonly ApiKeyPermission[];
}

/** Why a key was rejected. Callers map these to their own error surface. */
export type ApiKeyRejectionReason =
  | "not-an-api-key"
  | "not-found"
  | "revoked"
  | "expired";

export type ApiKeyValidationResult =
  | { readonly ok: true; readonly value: ValidatedApiKey }
  | { readonly ok: false; readonly reason: ApiKeyRejectionReason };

/** Deterministic hash used for the constant-column lookup. */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** True iff `value` is a string carrying one of `prefixes`. */
export function isApiKeyLike(
  value: string | null | undefined,
  prefixes: readonly string[] = API_KEY_PREFIXES,
): value is string {
  return (
    typeof value === "string" && prefixes.some((p) => value.startsWith(p))
  );
}

/**
 * Validate a plaintext API key against the `api_keys` table.
 *
 * Returns a discriminated result so callers can preserve reason-specific
 * error messages (the Effect service maps these to `InvalidApiKeyError`).
 * A missing, revoked, expired, or non-prefixed key ALWAYS fails — there is
 * no bypass. Never logs or returns the plaintext.
 *
 * `db` is any drizzle Postgres client whose schema targets the shared
 * Postgres (the core `GmackoDb` instance and OODA's `db` both qualify —
 * the query uses explicit table refs, so the client's registered schema is
 * irrelevant).
 */
export async function validateApiKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PgDatabase<any, any, any>,
  plaintext: string | null | undefined,
  prefixes: readonly string[] = API_KEY_PREFIXES,
  /**
   * Users table to join for the owner email. Defaults to the core `users`
   * table (uuid id). Pass `null` to SKIP the join and validate against
   * `api_keys` alone — required against the deployed Bob DB, where
   * `api_keys.user_id` is a text FK to the better-auth `"user"` table and the
   * uuid-vs-text comparison against core `users` fails the query outright.
   */
  usersTableForEmail: typeof usersTable | null = usersTable,
): Promise<ApiKeyValidationResult> {
  if (!isApiKeyLike(plaintext, prefixes)) {
    return { ok: false, reason: "not-an-api-key" };
  }

  const keyHash = hashApiKey(plaintext);

  // Columns present in BOTH the core and live-Bob `api_keys` schemas
  // (no `tenant_id`). The owner email is joined only when a compatible users
  // table is supplied (see `usersTableForEmail`).
  const keyCols = {
    keyId: apiKeysTable.id,
    userId: apiKeysTable.userId,
    permissions: apiKeysTable.permissions,
    revokedAt: apiKeysTable.revokedAt,
    expiresAt: apiKeysTable.expiresAt,
  };

  let row:
    | {
        keyId: string;
        userId: string;
        permissions: readonly ApiKeyPermission[];
        revokedAt: Date | null;
        expiresAt: Date | null;
        email: string | null;
      }
    | undefined;

  if (usersTableForEmail) {
    const rows = await db
      .select({ ...keyCols, email: usersTableForEmail.email })
      .from(apiKeysTable)
      .innerJoin(
        usersTableForEmail,
        eq(usersTableForEmail.id, apiKeysTable.userId),
      )
      .where(eq(apiKeysTable.keyHash, keyHash))
      .limit(1);
    row = rows[0] as typeof row;
  } else {
    const rows = await db
      .select(keyCols)
      .from(apiKeysTable)
      .where(eq(apiKeysTable.keyHash, keyHash))
      .limit(1);
    const r = rows[0];
    row = r ? ({ ...r, email: null } as typeof row) : undefined;
  }

  if (!row) {
    return { ok: false, reason: "not-found" };
  }
  if (row.revokedAt) {
    return { ok: false, reason: "revoked" };
  }
  if (row.expiresAt && row.expiresAt <= new Date()) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    value: {
      keyId: row.keyId,
      userId: row.userId,
      email: row.email,
      permissions: row.permissions as readonly ApiKeyPermission[],
    },
  };
}
