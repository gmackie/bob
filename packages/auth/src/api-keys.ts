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
import { createHash, randomBytes } from "node:crypto";
import { Effect, Layer, ServiceMap } from "effect";

import { GmackoDb } from "@gmacko/db";
import {
  apiKeys as apiKeysTable,
  type ApiKeyPermission,
} from "@gmacko/db/schema/api-keys";
import { users as usersTable } from "@gmacko/db/schema/auth";
import type { ApiKeyId, TenantId, UserId } from "@gmacko/core/validators";

import { InvalidApiKeyError } from "./errors.js";
export { InvalidApiKeyError };

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

      const hashKey = (plaintext: string) =>
        createHash("sha256").update(plaintext).digest("hex");

      const isApiKey: ApiKeysShape["isApiKey"] = ((
        value: string | null | undefined,
      ): value is string =>
        typeof value === "string" &&
        prefixes.some((p) => value.startsWith(p))) as ApiKeysShape["isApiKey"];

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
          if (!isApiKey(plaintext)) {
            return yield* Effect.fail(
              new InvalidApiKeyError({ message: "Not an API key" }),
            );
          }
          const keyHash = hashKey(plaintext);
          const rows = yield* Effect.promise(() =>
            db
              .select({
                keyId: apiKeysTable.id,
                userId: apiKeysTable.userId,
                tenantId: apiKeysTable.tenantId,
                email: usersTable.email,
                permissions: apiKeysTable.permissions,
                revokedAt: apiKeysTable.revokedAt,
                expiresAt: apiKeysTable.expiresAt,
              })
              .from(apiKeysTable)
              .innerJoin(usersTable, eq(usersTable.id, apiKeysTable.userId))
              .where(eq(apiKeysTable.keyHash, keyHash))
              .limit(1),
          );
          const row = rows[0];
          if (!row) {
            return yield* Effect.fail(
              new InvalidApiKeyError({ message: "API key not found" }),
            );
          }
          if (row.revokedAt) {
            return yield* Effect.fail(
              new InvalidApiKeyError({ message: "API key revoked" }),
            );
          }
          if (row.expiresAt && row.expiresAt <= new Date()) {
            return yield* Effect.fail(
              new InvalidApiKeyError({ message: "API key expired" }),
            );
          }

          // Fire-and-forget `lastUsedAt` update. We use `forkDetach` (the
          // Effect 4 equivalent of `forkDaemon`) so the caller does not wait
          // on the write. Errors are swallowed to avoid unhandled-rejection
          // noise when the underlying db handle is torn down (e.g. in tests).
          yield* Effect.promise(async () => {
            await db
              .update(apiKeysTable)
              .set({ lastUsedAt: new Date() })
              .where(eq(apiKeysTable.id, row.keyId));
          }).pipe(
            Effect.catchCause(() => Effect.void),
            Effect.forkDetach,
          );

          return {
            keyId: row.keyId as ApiKeyId,
            userId: row.userId as UserId,
            tenantId: row.tenantId as TenantId,
            email: row.email,
            permissions: row.permissions as readonly ApiKeyPermission[],
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
