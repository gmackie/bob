// Effect service for tenant-scoped encrypted secrets backed by the
// `session_secrets` table. Stores AES-256-GCM envelopes (ciphertext + iv +
// auth tag) whose row keys are HMAC-derived from a master env-var key; see
// `./crypt.ts` for the envelope crypto.
//
// Phase 6D surface: `createSecret`, `deleteSecret`, `listForTenant`. The
// `getSecret` / `decryptForUse` / `markSecretUsed` methods land in Tasks 7-9.
// NOT exported from the package barrel yet — Task 10 owns the public API.
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Effect, Layer, Schema, ServiceMap } from "effect";

import { GmackoDb } from "@gmacko/db";
import {
  sessionSecrets,
  type SessionSecretPolicy,
} from "@gmacko/db/schema/secrets";
import type {
  SessionSecretId as SessionSecretIdT,
  TenantId as TenantIdT,
} from "@gmacko/validators";

import { encryptSecretValue } from "./crypt.js";

export class SecretNotFoundError extends Schema.TaggedErrorClass<SecretNotFoundError>()(
  "SecretNotFoundError",
  { secretId: Schema.String, tenantId: Schema.String },
) {}

export class SecretNameConflictError extends Schema.TaggedErrorClass<SecretNameConflictError>()(
  "SecretNameConflictError",
  { tenantId: Schema.String, name: Schema.String },
) {}

export interface SecretEnvelope {
  readonly id: SessionSecretIdT;
  readonly tenantId: TenantIdT;
  readonly name: string;
  readonly policy: SessionSecretPolicy;
  readonly usesRemaining: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateSecretInput {
  readonly tenantId: TenantIdT;
  readonly name: string;
  readonly plaintext: string;
  readonly policy?: SessionSecretPolicy;
  readonly usesRemaining?: number | null;
}

export interface SecretsShape {
  readonly createSecret: (
    input: CreateSecretInput,
  ) => Effect.Effect<SecretEnvelope, SecretNameConflictError>;
  readonly deleteSecret: (input: {
    secretId: SessionSecretIdT;
    tenantId: TenantIdT;
  }) => Effect.Effect<void, SecretNotFoundError>;
  readonly listForTenant: (
    tenantId: TenantIdT,
  ) => Effect.Effect<readonly SecretEnvelope[], never>;
}

export class Secrets extends ServiceMap.Service<Secrets, SecretsShape>()(
  "@gmacko/secrets/Secrets",
) {}

export const layerSecrets: Layer.Layer<Secrets, never, GmackoDb> =
  Layer.effect(Secrets)(
    Effect.gen(function* () {
      const db = yield* GmackoDb;

      const createSecret: SecretsShape["createSecret"] = ({
        tenantId,
        name,
        plaintext,
        policy,
        usesRemaining,
      }) =>
        Effect.gen(function* () {
          // Pre-check for existing (tenantId, name) to surface
          // SecretNameConflictError cleanly. We still hit the unique index if
          // a concurrent insert races past us — but under test conditions and
          // typical serial call patterns the pre-check keeps the failure path
          // inside Effect's error channel instead of forcing us to catch a
          // driver-level exception (which leaks as a logged defect through
          // @effect/vitest's runPromise even when caught structurally).
          const existing = yield* Effect.promise(() =>
            db
              .select({ id: sessionSecrets.id })
              .from(sessionSecrets)
              .where(
                and(
                  eq(sessionSecrets.tenantId, tenantId),
                  eq(sessionSecrets.name, name),
                ),
              )
              .limit(1),
          );
          if (existing.length > 0) {
            return yield* Effect.fail(
              new SecretNameConflictError({ tenantId, name }),
            );
          }
          const id = randomUUID();
          const envelope = encryptSecretValue(plaintext, id);
          const inserted = yield* Effect.promise(() =>
            db
              .insert(sessionSecrets)
              .values({
                id,
                tenantId,
                name,
                ciphertext: envelope.ciphertext,
                iv: envelope.iv,
                authTag: envelope.tag,
                policy: policy ?? {},
                usesRemaining: usesRemaining ?? null,
              })
              .returning(),
          );
          const row = inserted[0]!;
          return {
            id: row.id as SessionSecretIdT,
            tenantId: row.tenantId as TenantIdT,
            name: row.name,
            policy: (row.policy ?? {}) as SessionSecretPolicy,
            usesRemaining: row.usesRemaining,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
        });

      const deleteSecret: SecretsShape["deleteSecret"] = ({
        secretId,
        tenantId,
      }) =>
        Effect.gen(function* () {
          const deleted = yield* Effect.promise(async () =>
            db
              .delete(sessionSecrets)
              .where(
                and(
                  eq(sessionSecrets.id, secretId),
                  eq(sessionSecrets.tenantId, tenantId),
                ),
              )
              .returning(),
          );
          if (deleted.length === 0) {
            return yield* Effect.fail(
              new SecretNotFoundError({ secretId, tenantId }),
            );
          }
        });

      const listForTenant: SecretsShape["listForTenant"] = (tenantId) =>
        Effect.promise(async () => {
          const rows = await db
            .select({
              id: sessionSecrets.id,
              tenantId: sessionSecrets.tenantId,
              name: sessionSecrets.name,
              policy: sessionSecrets.policy,
              usesRemaining: sessionSecrets.usesRemaining,
              createdAt: sessionSecrets.createdAt,
              updatedAt: sessionSecrets.updatedAt,
            })
            .from(sessionSecrets)
            .where(eq(sessionSecrets.tenantId, tenantId))
            .orderBy(desc(sessionSecrets.createdAt));
          return rows.map((r) => ({
            id: r.id as SessionSecretIdT,
            tenantId: r.tenantId as TenantIdT,
            name: r.name,
            policy: (r.policy ?? {}) as SessionSecretPolicy,
            usesRemaining: r.usesRemaining,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          }));
        });

      return { createSecret, deleteSecret, listForTenant } satisfies SecretsShape;
    }),
  );
