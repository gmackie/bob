// Effect service for tenant-scoped API keys backed by the `api_keys` table.
//
// Keys are issued with a configurable prefix list (default `["gmk_"]`) so
// downstream apps (Bob, OODA) can layer in product-specific prefixes at
// composition time. The first prefix in the list is used when minting new
// keys; any prefix in the list is accepted by `isApiKey` / `validateKey`.
//
// `validateKey` returns the owning user's email alongside userId/tenantId so
// downstream auth middleware (Task 15) can produce a CurrentUser in a single
// round-trip instead of re-querying the users table.
//
// NOTE: not exported from the package barrel yet — Task 17 handles the public
// API surface.
import { and, desc, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { Effect, Layer, ServiceMap } from "effect";

import { GmackoDb } from "@gmacko/core/db";
import {
  apiKeys as apiKeysTable,
  type ApiKeyPermission,
} from "@gmacko/core/db/schema/api-keys";
import type { ApiKeyId, TenantId, UserId } from "@gmacko/core/validators";

import { InvalidApiKeyError } from "./errors.js";
import {
  API_KEY_PREFIXES,
  type ApiKeyRejectionReason,
  hashApiKey,
  isApiKeyLike,
  validateApiKey as validateApiKeyPlain,
} from "./validate-api-key.js";
export { InvalidApiKeyError };
export { API_KEY_PREFIXES };

// Reason → message map. Keeps `validateKey`'s public error messages
// byte-identical to the pre-refactor implementation (asserted by the
// existing api-keys unit tests) while sharing the validation algorithm with
// the plain `validateApiKey` used by OODA.
const REJECTION_MESSAGE: Record<ApiKeyRejectionReason, string> = {
  "not-an-api-key": "Not an API key",
  "not-found": "API key not found",
  revoked: "API key revoked",
  expired: "API key expired",
};

export interface IssueKeyInput {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly permissions?: readonly ApiKeyPermission[];
  /** Optional TTL (ms). When set, `expiresAt` = now + ttlMs. Negative → already expired (useful for tests). */
  readonly ttlMs?: number;
}

export interface IssuedKey {
  readonly id: ApiKeyId;
  /** The plaintext key. Returned exactly once from `issueKey` — we only persist a hash. */
  readonly plaintext: string;
  /** Displayable prefix of the key (first 12 chars of plaintext), e.g. `gmk_abcd1234`. */
  readonly keyPrefix: string;
}

export interface ValidatedKey {
  readonly keyId: ApiKeyId;
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly email: string;
  readonly permissions: readonly ApiKeyPermission[];
}

export interface ApiKeyListItem {
  readonly id: ApiKeyId;
  readonly name: string;
  readonly keyPrefix: string;
  readonly permissions: readonly ApiKeyPermission[];
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface ApiKeysShape {
  readonly issueKey: (input: IssueKeyInput) => Effect.Effect<IssuedKey, never>;
  readonly validateKey: (plaintext: string) => Effect.Effect<ValidatedKey, InvalidApiKeyError>;
  readonly isApiKey: (value: string | null | undefined) => value is string;
  readonly revokeKey: (keyId: ApiKeyId) => Effect.Effect<void, never>;
  readonly listForUser: (
    userId: UserId,
    tenantId: TenantId,
  ) => Effect.Effect<readonly ApiKeyListItem[], never>;
}

export class ApiKeys extends ServiceMap.Service<ApiKeys, ApiKeysShape>()(
  "@gmacko/auth/ApiKeys",
) {}

export interface LayerApiKeysOptions {
  /**
   * Plaintext prefix list accepted by `isApiKey` and prepended at issue time.
   * The first entry is used when issuing new keys. Default `["gmk_"]`.
   */
  readonly prefixes?: readonly string[];
}

export const layerApiKeys = (
  opts: LayerApiKeysOptions = {},
): Layer.Layer<ApiKeys, never, GmackoDb> =>
  Layer.effect(ApiKeys)(
    Effect.gen(function* () {
      const db = yield* GmackoDb;
      const prefixes =
        opts.prefixes && opts.prefixes.length > 0
          ? opts.prefixes
          : (["gmk_"] as const);
      const issuePrefix = prefixes[0]!;

      const hashKey = hashApiKey;

      const isApiKey: ApiKeysShape["isApiKey"] = ((
        value: string | null | undefined,
      ): value is string =>
        isApiKeyLike(value, prefixes)) as ApiKeysShape["isApiKey"];

      const issueKey: ApiKeysShape["issueKey"] = ({
        userId,
        tenantId,
        name,
        permissions,
        ttlMs,
      }) =>
        Effect.gen(function* () {
          // 16 random bytes → 32 hex chars → 128 bits of entropy.
          const entropy = randomBytes(16).toString("hex");
          const plaintext = `${issuePrefix}${entropy}`;
          // Stored prefix is the first 12 chars of the plaintext — enough to
          // disambiguate keys in a UI (e.g. "gmk_abcd1234") without leaking
          // the full secret.
          const keyPrefix = plaintext.slice(0, 12);
          const keyHash = hashKey(plaintext);
          const now = new Date();
          const expiresAt = ttlMs != null ? new Date(now.getTime() + ttlMs) : null;

          const inserted = yield* Effect.promise(async () =>
            db
              .insert(apiKeysTable)
              .values({
                tenantId,
                userId,
                name,
                keyHash,
                keyPrefix,
                // Drizzle's jsonb $type infers a mutable array; spread to
                // drop the `readonly` from the caller-supplied tuple.
                permissions: [...(permissions ?? (["read"] as const))],
                expiresAt,
              })
              .returning(),
          );
          const row = inserted[0]!;
          return {
            id: row.id as ApiKeyId,
            plaintext,
            keyPrefix,
          };
        });

      const validateKey: ApiKeysShape["validateKey"] = (plaintext) =>
        Effect.gen(function* () {
          // Delegate the entire hash/lookup/revoked/expired algorithm to the
          // shared plain-async validator (the SAME implementation OODA's
          // tRPC path uses), then map its discriminated result back onto this
          // service's tagged-error + branded-id surface.
          const result = yield* Effect.promise(() =>
            validateApiKeyPlain(db, plaintext, prefixes),
          );
          if (!result.ok) {
            return yield* Effect.fail(
              new InvalidApiKeyError({
                message: REJECTION_MESSAGE[result.reason],
              }),
            );
          }
          const { value } = result;

          // Enrich with `tenantId`. The shared validator deliberately omits it
          // (the live Bob `api_keys` table has no `tenant_id` column); this
          // service targets the gmacko-core schema where it exists, so we read
          // it here on the already-validated row.
          const tenantRows = yield* Effect.promise(() =>
            db
              .select({ tenantId: apiKeysTable.tenantId })
              .from(apiKeysTable)
              .where(eq(apiKeysTable.id, value.keyId))
              .limit(1),
          );
          const tenantId = tenantRows[0]!.tenantId;

          // Fire-and-forget `lastUsedAt` update. We use `forkDetach` (the
          // Effect 4 equivalent of `forkDaemon`) so the caller does not wait
          // on the write. Errors are swallowed to avoid unhandled-rejection
          // noise when the underlying db handle is torn down (e.g. in tests).
          yield* Effect.promise(async () => {
            await db
              .update(apiKeysTable)
              .set({ lastUsedAt: new Date() })
              .where(eq(apiKeysTable.id, value.keyId));
          }).pipe(
            Effect.catchCause(() => Effect.void),
            Effect.forkDetach,
          );

          return {
            keyId: value.keyId as ApiKeyId,
            userId: value.userId as UserId,
            tenantId: tenantId as TenantId,
            // Non-null in practice: this service passes the default (core)
            // users-table join, so the shared validator always returns email.
            email: value.email ?? "",
            permissions: value.permissions,
          };
        });

      const revokeKey: ApiKeysShape["revokeKey"] = (keyId) =>
        Effect.promise(async () => {
          await db
            .update(apiKeysTable)
            .set({ revokedAt: new Date() })
            .where(eq(apiKeysTable.id, keyId));
        });

      const listForUser: ApiKeysShape["listForUser"] = (userId, tenantId) =>
        Effect.promise(async () => {
          const rows = await db
            .select({
              id: apiKeysTable.id,
              name: apiKeysTable.name,
              keyPrefix: apiKeysTable.keyPrefix,
              permissions: apiKeysTable.permissions,
              createdAt: apiKeysTable.createdAt,
              lastUsedAt: apiKeysTable.lastUsedAt,
              expiresAt: apiKeysTable.expiresAt,
              revokedAt: apiKeysTable.revokedAt,
            })
            .from(apiKeysTable)
            .where(
              and(
                eq(apiKeysTable.userId, userId),
                eq(apiKeysTable.tenantId, tenantId),
              ),
            )
            .orderBy(desc(apiKeysTable.createdAt));
          return rows.map((r) => ({
            id: r.id as ApiKeyId,
            name: r.name,
            keyPrefix: r.keyPrefix,
            permissions: r.permissions as readonly ApiKeyPermission[],
            createdAt: r.createdAt,
            lastUsedAt: r.lastUsedAt,
            expiresAt: r.expiresAt,
            revokedAt: r.revokedAt,
          }));
        });

      return { issueKey, validateKey, isApiKey, revokeKey, listForUser };
    }),
  );
