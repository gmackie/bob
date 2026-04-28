// Effect service for tenant-scoped encrypted secrets backed by the
// `session_secrets` table. Stores AES-256-GCM envelopes (ciphertext + iv +
// auth tag) whose row keys are HMAC-derived from a master env-var key; see
// `./crypt.ts` for the envelope crypto.
//
// Phase 6D surface: `createSecret`, `deleteSecret`, `getSecret`,
// `listForTenant`, `decryptForUse`, `markSecretUsed`. NOT exported from the
// package barrel yet — Task 10 owns the public API.
//
// `decryptForUse` is the only entry point that returns plaintext. Flow:
//   1. A race-safe conditional UPDATE decrements `usesRemaining` atomically
//      (guard: `IS NULL OR > 0`). Zero rows returned → disambiguate via a
//      follow-up SELECT: either `SecretNotFoundError` (missing/cross-tenant)
//      or `MaxUsesExceededError` (row exists but counter hit 0).
//   2. Policy checks (`allowedTemplates`, `allowedArgPrefixes`) run on the
//      freshly-decremented row. A failed check still writes an audit row
//      (success=false) and does NOT roll back the decrement — a denied use
//      still counts toward the cap as a hostile-actor signal.
//   3. On success, the envelope is decrypted and a success audit row is
//      written (with sessionId/templateId/commandPrefix).
// We intentionally do NOT wrap this in a drizzle transaction; pglite's
// transaction semantics under drizzle-orm are brittle, and the non-rollback
// behavior is the Bob-flavored semantics we want.
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { Effect, Layer, ServiceMap } from "effect";

import { GmackoDb } from "@gmacko/db";
import {
  sessionSecretUsages,
  sessionSecrets,
  type SessionSecretPolicy,
} from "@gmacko/db/schema/secrets";
import type {
  SessionId as SessionIdT,
  SessionSecretId as SessionSecretIdT,
  TenantId as TenantIdT,
} from "@gmacko/validators";

import { decryptSecretValue, encryptSecretValue } from "./crypt.js";
import {
  MaxUsesExceededError,
  PolicyDeniedError,
  SecretNameConflictError,
  SecretNotFoundError,
} from "./errors.js";

export {
  MaxUsesExceededError,
  PolicyDeniedError,
  SecretNameConflictError,
  SecretNotFoundError,
};

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

export interface DecryptForUseInput {
  readonly secretId: SessionSecretIdT;
  readonly tenantId: TenantIdT;
  readonly templateId?: string;
  readonly args?: readonly string[];
  readonly sessionId?: SessionIdT;
}

export interface DecryptForUseResult {
  readonly plaintext: string;
  readonly envelope: SecretEnvelope;
}

export interface SecretsShape {
  readonly createSecret: (
    input: CreateSecretInput,
  ) => Effect.Effect<SecretEnvelope, SecretNameConflictError>;
  readonly deleteSecret: (input: {
    secretId: SessionSecretIdT;
    tenantId: TenantIdT;
  }) => Effect.Effect<void, SecretNotFoundError>;
  readonly getSecret: (input: {
    secretId: SessionSecretIdT;
    tenantId: TenantIdT;
  }) => Effect.Effect<SecretEnvelope, SecretNotFoundError>;
  readonly listForTenant: (
    tenantId: TenantIdT,
  ) => Effect.Effect<readonly SecretEnvelope[], never>;
  readonly decryptForUse: (
    input: DecryptForUseInput,
  ) => Effect.Effect<
    DecryptForUseResult,
    SecretNotFoundError | PolicyDeniedError | MaxUsesExceededError
  >;
  readonly markSecretUsed: (input: {
    secretId: SessionSecretIdT;
    tenantId: TenantIdT;
    sessionId?: SessionIdT;
    templateId?: string;
    commandPrefix?: string;
    success?: boolean;
  }) => Effect.Effect<void, SecretNotFoundError>;
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

      const getSecret: SecretsShape["getSecret"] = ({ secretId, tenantId }) =>
        Effect.gen(function* () {
          const rows = yield* Effect.promise(async () =>
            db
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
              .where(
                and(
                  eq(sessionSecrets.id, secretId),
                  eq(sessionSecrets.tenantId, tenantId),
                ),
              ),
          );
          if (rows.length === 0) {
            return yield* Effect.fail(
              new SecretNotFoundError({ secretId, tenantId }),
            );
          }
          const r = rows[0]!;
          return {
            id: r.id as SessionSecretIdT,
            tenantId: r.tenantId as TenantIdT,
            name: r.name,
            policy: (r.policy ?? {}) as SessionSecretPolicy,
            usesRemaining: r.usesRemaining,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          };
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

      const toEnvelope = (row: typeof sessionSecrets.$inferSelect): SecretEnvelope => ({
        id: row.id as SessionSecretIdT,
        tenantId: row.tenantId as TenantIdT,
        name: row.name,
        policy: (row.policy ?? {}) as SessionSecretPolicy,
        usesRemaining: row.usesRemaining,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });

      const writeAudit = (args: {
        secretId: SessionSecretIdT;
        sessionId?: SessionIdT;
        templateId?: string;
        commandPrefix?: string;
        success: boolean;
      }) =>
        Effect.promise(async () => {
          await db.insert(sessionSecretUsages).values({
            secretId: args.secretId,
            sessionId: args.sessionId ?? null,
            templateId: args.templateId ?? null,
            commandPrefix: args.commandPrefix ?? null,
            success: args.success,
          });
        });

      const decryptForUse: SecretsShape["decryptForUse"] = ({
        secretId,
        tenantId,
        templateId,
        args,
        sessionId,
      }) =>
        Effect.gen(function* () {
          // Step 1: race-safe conditional UPDATE. The guard `usesRemaining IS
          // NULL OR usesRemaining > 0` ensures two concurrent callers against
          // a `usesRemaining: 1` row cannot both decrement — only the caller
          // whose WHERE matched gets a row back. The CASE expression keeps a
          // NULL row NULL (unlimited) while decrementing concrete integers.
          const updated = yield* Effect.promise(async () =>
            db
              .update(sessionSecrets)
              .set({
                usesRemaining: sql`CASE WHEN ${sessionSecrets.usesRemaining} IS NULL THEN NULL ELSE ${sessionSecrets.usesRemaining} - 1 END`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(sessionSecrets.id, secretId),
                  eq(sessionSecrets.tenantId, tenantId),
                  or(
                    isNull(sessionSecrets.usesRemaining),
                    gt(sessionSecrets.usesRemaining, 0),
                  ),
                ),
              )
              .returning(),
          );

          if (updated.length === 0) {
            // Disambiguate: is the row missing/cross-tenant, or is
            // usesRemaining already 0?
            const existing = yield* Effect.promise(async () =>
              db
                .select()
                .from(sessionSecrets)
                .where(
                  and(
                    eq(sessionSecrets.id, secretId),
                    eq(sessionSecrets.tenantId, tenantId),
                  ),
                )
                .limit(1),
            );
            if (existing.length === 0) {
              return yield* Effect.fail(
                new SecretNotFoundError({ secretId, tenantId }),
              );
            }
            const row = existing[0]!;
            const cap = row.policy?.maxUses ?? 0;
            return yield* Effect.fail(
              new MaxUsesExceededError({ secretId, maxUses: cap }),
            );
          }

          const row = updated[0]!;
          const policy = (row.policy ?? {}) as SessionSecretPolicy;
          const commandPrefix = args?.[0];

          // Step 3a: allowedTemplates check.
          if (
            Array.isArray(policy.allowedTemplates) &&
            policy.allowedTemplates.length > 0
          ) {
            if (!templateId) {
              yield* writeAudit({
                secretId,
                sessionId,
                templateId: undefined,
                commandPrefix,
                success: false,
              });
              return yield* Effect.fail(
                new PolicyDeniedError({
                  reason: "noTemplateId",
                  expected: policy.allowedTemplates,
                }),
              );
            }
            if (!policy.allowedTemplates.includes(templateId)) {
              yield* writeAudit({
                secretId,
                sessionId,
                templateId,
                commandPrefix,
                success: false,
              });
              return yield* Effect.fail(
                new PolicyDeniedError({
                  reason: "template",
                  templateId,
                  expected: policy.allowedTemplates,
                }),
              );
            }
          }

          // Step 3b: allowedArgPrefixes check (only if templateId + entry exist).
          if (templateId) {
            const prefixes = policy.allowedArgPrefixes?.[templateId];
            if (Array.isArray(prefixes) && prefixes.length > 0) {
              const argList = args ?? [];
              const ok = argList.some((a) =>
                prefixes.some((p) => a.startsWith(p)),
              );
              if (!ok) {
                yield* writeAudit({
                  secretId,
                  sessionId,
                  templateId,
                  commandPrefix,
                  success: false,
                });
                return yield* Effect.fail(
                  new PolicyDeniedError({
                    reason: "argPrefix",
                    templateId,
                    expected: prefixes,
                  }),
                );
              }
            }
          }

          // Step 3c: policy passed — decrypt and write success audit.
          const plaintext = decryptSecretValue(
            {
              ciphertext: row.ciphertext,
              iv: row.iv,
              tag: row.authTag,
            },
            secretId,
          );
          yield* writeAudit({
            secretId,
            sessionId,
            templateId,
            commandPrefix,
            success: true,
          });
          return {
            plaintext,
            envelope: toEnvelope(row),
          };
        });

      const markSecretUsed: SecretsShape["markSecretUsed"] = ({
        secretId,
        tenantId,
        sessionId,
        templateId,
        commandPrefix,
        success,
      }) =>
        Effect.gen(function* () {
          // Tenant-scoped existence check — so a cross-tenant or missing id
          // surfaces as SecretNotFoundError without relying on FK driver
          // errors leaking out of Effect.promise.
          const rows = yield* Effect.promise(async () =>
            db
              .select({ id: sessionSecrets.id })
              .from(sessionSecrets)
              .where(
                and(
                  eq(sessionSecrets.id, secretId),
                  eq(sessionSecrets.tenantId, tenantId),
                ),
              ),
          );
          if (rows.length === 0) {
            return yield* Effect.fail(
              new SecretNotFoundError({ secretId, tenantId }),
            );
          }
          yield* writeAudit({
            secretId,
            sessionId,
            templateId,
            commandPrefix,
            success: success ?? true,
          });
        });

      return {
        createSecret,
        deleteSecret,
        getSecret,
        listForTenant,
        decryptForUse,
        markSecretUsed,
      } satisfies SecretsShape;
    }),
  );
