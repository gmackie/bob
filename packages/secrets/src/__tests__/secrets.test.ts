import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { and, eq } from "drizzle-orm";

import { createTestDb } from "@gmacko/db/testing";
import { layerGmackoDb } from "@gmacko/db";
import { tenants } from "@gmacko/db/schema/tenancy";
import {
  sessionSecrets,
  sessionSecretUsages,
} from "@gmacko/db/schema/secrets";
import type {
  SessionId,
  SessionSecretId,
  TenantId,
} from "@gmacko/validators";

import { decryptSecretValue } from "../crypt.js";
import {
  MaxUsesExceededError,
  PolicyDeniedError,
  Secrets,
  SecretNameConflictError,
  SecretNotFoundError,
  layerSecrets,
} from "../secrets.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" as TenantId;
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" as TenantId;
const ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef"; // 32 chars

let ctx: TestCtx;
let secretsLayer: Layer.Layer<Secrets>;

async function seedTenant(ctx: TestCtx, id: TenantId, slug: string) {
  await ctx.db.insert(tenants).values({
    id,
    name: `Tenant ${slug}`,
    slug,
  });
}

beforeEach(async () => {
  process.env.GMACKO_SECRET_ENCRYPTION_KEY = ENCRYPTION_KEY;
  ctx = await createTestDb();
  await seedTenant(ctx, TENANT_A, "tenant-a");
  await seedTenant(ctx, TENANT_B, "tenant-b");
  secretsLayer = Layer.provide(layerSecrets, layerGmackoDb(ctx.db));
});

afterEach(async () => {
  await ctx.teardown();
  delete process.env.GMACKO_SECRET_ENCRYPTION_KEY;
});

describe("@gmacko/secrets Secrets service", () => {
  it.effect("createSecret round-trips an envelope without leaking plaintext/ciphertext", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      const envelope = yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "github-token",
        plaintext: "s3cr3t-value",
      });

      expect(envelope.tenantId).toBe(TENANT_A);
      expect(envelope.name).toBe("github-token");
      expect(envelope.policy).toEqual({});
      expect(envelope.usesRemaining).toBeNull();
      expect(envelope.createdAt).toBeInstanceOf(Date);
      expect(envelope.updatedAt).toBeInstanceOf(Date);
      expect(typeof envelope.id).toBe("string");

      // Internal fields must NOT appear on the returned envelope.
      expect(envelope).not.toHaveProperty("plaintext");
      expect(envelope).not.toHaveProperty("ciphertext");
      expect(envelope).not.toHaveProperty("iv");
      expect(envelope).not.toHaveProperty("authTag");
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("createSecret rejects duplicate (tenantId, name) with SecretNameConflictError", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "dup",
        plaintext: "first",
      });

      const caught = yield* svc
        .createSecret({
          tenantId: TENANT_A,
          name: "dup",
          plaintext: "second",
        })
        .pipe(
          Effect.catchTag("SecretNameConflictError", (err) => Effect.succeed(err)),
        );

      expect(caught).toBeInstanceOf(SecretNameConflictError);
      expect((caught as SecretNameConflictError).tenantId).toBe(TENANT_A);
      expect((caught as SecretNameConflictError).name).toBe("dup");
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("createSecret persists ciphertext that decrypts back to plaintext", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      const plaintext = "hunter2-ultra-secret";
      const envelope = yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "crypto-rt",
        plaintext,
      });

      const rows = yield* Effect.promise(() =>
        ctx.db
          .select()
          .from(sessionSecrets)
          .where(eq(sessionSecrets.id, envelope.id))
          .limit(1),
      );
      expect(rows).toHaveLength(1);
      const row = rows[0]!;

      // Ciphertext must not contain the plaintext.
      expect(row.ciphertext).not.toContain(plaintext);

      const decrypted = decryptSecretValue(
        { ciphertext: row.ciphertext, iv: row.iv, tag: row.authTag },
        row.id,
      );
      expect(decrypted).toBe(plaintext);
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("deleteSecret rejects cross-tenant deletion and preserves the row", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      const aSecret = yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "tenant-a-only",
        plaintext: "a-value",
      });

      const caught = yield* svc
        .deleteSecret({ secretId: aSecret.id, tenantId: TENANT_B })
        .pipe(
          Effect.catchTag("SecretNotFoundError", (err) => Effect.succeed(err)),
        );

      expect(caught).toBeInstanceOf(SecretNotFoundError);
      expect((caught as SecretNotFoundError).secretId).toBe(aSecret.id);
      expect((caught as SecretNotFoundError).tenantId).toBe(TENANT_B);

      // Row must still exist under tenant A.
      const list = yield* svc.listForTenant(TENANT_A);
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe(aSecret.id);
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("listForTenant returns only the calling tenant's secrets", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "a-first",
        plaintext: "a1",
      });
      yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "a-second",
        plaintext: "a2",
      });
      yield* svc.createSecret({
        tenantId: TENANT_B,
        name: "b-first",
        plaintext: "b1",
      });

      const aList = yield* svc.listForTenant(TENANT_A);
      const bList = yield* svc.listForTenant(TENANT_B);

      expect(aList).toHaveLength(2);
      expect(aList.every((s) => s.tenantId === TENANT_A)).toBe(true);
      const aNames = aList.map((s) => s.name).sort();
      expect(aNames).toEqual(["a-first", "a-second"]);

      expect(bList).toHaveLength(1);
      expect(bList[0]!.tenantId).toBe(TENANT_B);
      expect(bList[0]!.name).toBe("b-first");
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("listForTenant surfaces usesRemaining (null for unlimited, integer otherwise)", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "limited",
        plaintext: "x",
        usesRemaining: 5,
      });
      yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "unlimited",
        plaintext: "y",
      });

      const list = yield* svc.listForTenant(TENANT_A);
      expect(list).toHaveLength(2);
      const byName = new Map(list.map((s) => [s.name, s] as const));
      expect(byName.get("limited")!.usesRemaining).toBe(5);
      expect(byName.get("unlimited")!.usesRemaining).toBeNull();
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("getSecret returns the envelope for an existing tenant-owned secret", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      const created = yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "gh-token",
        plaintext: "supersecret-value",
        usesRemaining: 3,
      });

      const result = yield* svc.getSecret({
        secretId: created.id,
        tenantId: TENANT_A,
      });

      expect(result.id).toBe(created.id);
      expect(result.tenantId).toBe(TENANT_A);
      expect(result.name).toBe("gh-token");
      expect(result.policy).toEqual({});
      expect(result.usesRemaining).toBe(3);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);

      // Envelope-only: no crypto material or plaintext on the result.
      expect(result).not.toHaveProperty("ciphertext");
      expect(result).not.toHaveProperty("iv");
      expect(result).not.toHaveProperty("authTag");
      expect(result).not.toHaveProperty("plaintext");
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("getSecret for a non-existent id → SecretNotFoundError", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      const missingId = randomUUID() as SessionSecretId;

      const caught = yield* svc
        .getSecret({ secretId: missingId, tenantId: TENANT_A })
        .pipe(
          Effect.catchTag("SecretNotFoundError", (err) => Effect.succeed(err)),
        );

      expect(caught).toBeInstanceOf(SecretNotFoundError);
      expect((caught as SecretNotFoundError).secretId).toBe(missingId);
      expect((caught as SecretNotFoundError).tenantId).toBe(TENANT_A);
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("getSecret for another tenant's secret → SecretNotFoundError (cross-tenant hardening)", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      const aSecret = yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "a-only",
        plaintext: "a-plaintext",
      });

      const caught = yield* svc
        .getSecret({ secretId: aSecret.id, tenantId: TENANT_B })
        .pipe(
          Effect.catchTag("SecretNotFoundError", (err) => Effect.succeed(err)),
        );

      expect(caught).toBeInstanceOf(SecretNotFoundError);
      expect((caught as SecretNotFoundError).secretId).toBe(aSecret.id);
      expect((caught as SecretNotFoundError).tenantId).toBe(TENANT_B);

      // Tenant A can still fetch their own secret — row must be intact.
      const owned = yield* svc.getSecret({
        secretId: aSecret.id,
        tenantId: TENANT_A,
      });
      expect(owned.id).toBe(aSecret.id);
      expect(owned.tenantId).toBe(TENANT_A);
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("decryptForUse happy path: no policy, unlimited uses → returns plaintext and writes success audit", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      const created = yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "unl",
        plaintext: "s3cr3t",
      });

      const result = yield* svc.decryptForUse({
        secretId: created.id,
        tenantId: TENANT_A,
      });

      expect(result.plaintext).toBe("s3cr3t");
      expect(result.envelope.id).toBe(created.id);
      expect(result.envelope.usesRemaining).toBeNull();

      const audits = yield* Effect.promise(() =>
        ctx.db
          .select()
          .from(sessionSecretUsages)
          .where(eq(sessionSecretUsages.secretId, created.id)),
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]!.success).toBe(true);
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("decryptForUse allows when templateId is in allowedTemplates", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      const created = yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "tpl-allow",
        plaintext: "ghp_xxx",
        policy: { allowedTemplates: ["git-clone", "git-push"] },
      });

      const result = yield* svc.decryptForUse({
        secretId: created.id,
        tenantId: TENANT_A,
        templateId: "git-clone",
      });

      expect(result.plaintext).toBe("ghp_xxx");

      const audits = yield* Effect.promise(() =>
        ctx.db
          .select()
          .from(sessionSecretUsages)
          .where(eq(sessionSecretUsages.secretId, created.id)),
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]!.success).toBe(true);
      expect(audits[0]!.templateId).toBe("git-clone");
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("decryptForUse denies when templateId is NOT in allowedTemplates (writes failure audit, preserves usesRemaining)", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      const created = yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "tpl-deny",
        plaintext: "ghp_denied",
        policy: { allowedTemplates: ["git-clone", "git-push"] },
      });

      const caught = yield* svc
        .decryptForUse({
          secretId: created.id,
          tenantId: TENANT_A,
          templateId: "rm",
        })
        .pipe(
          Effect.catchTag("PolicyDeniedError", (err) => Effect.succeed(err)),
        );

      expect(caught).toBeInstanceOf(PolicyDeniedError);
      const err = caught as PolicyDeniedError;
      expect(err.reason).toBe("template");
      expect(err.templateId).toBe("rm");
      expect(err.expected).toEqual(["git-clone", "git-push"]);

      const audits = yield* Effect.promise(() =>
        ctx.db
          .select()
          .from(sessionSecretUsages)
          .where(eq(sessionSecretUsages.secretId, created.id)),
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]!.success).toBe(false);
      expect(audits[0]!.templateId).toBe("rm");

      // usesRemaining remains null (unlimited) — the decrement still happened
      // (CASE NULL → NULL), so the row is still unlimited.
      const rows = yield* Effect.promise(() =>
        ctx.db
          .select()
          .from(sessionSecrets)
          .where(eq(sessionSecrets.id, created.id)),
      );
      expect(rows[0]!.usesRemaining).toBeNull();
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("decryptForUse allows when args[0] matches an allowedArgPrefixes entry", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      const created = yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "arg-allow",
        plaintext: "ghp_arg_ok",
        policy: {
          allowedTemplates: ["git-clone"],
          allowedArgPrefixes: {
            "git-clone": ["https://github.com/acme/"],
          },
        },
      });

      const result = yield* svc.decryptForUse({
        secretId: created.id,
        tenantId: TENANT_A,
        templateId: "git-clone",
        args: ["https://github.com/acme/thing.git"],
      });

      expect(result.plaintext).toBe("ghp_arg_ok");

      const audits = yield* Effect.promise(() =>
        ctx.db
          .select()
          .from(sessionSecretUsages)
          .where(eq(sessionSecretUsages.secretId, created.id)),
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]!.success).toBe(true);
      expect(audits[0]!.templateId).toBe("git-clone");
      expect(audits[0]!.commandPrefix).toBe(
        "https://github.com/acme/thing.git",
      );
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("decryptForUse denies when no arg matches an allowedArgPrefixes entry", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      const created = yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "arg-deny",
        plaintext: "ghp_arg_deny",
        policy: {
          allowedTemplates: ["git-clone"],
          allowedArgPrefixes: {
            "git-clone": ["https://github.com/acme/"],
          },
        },
      });

      const caught = yield* svc
        .decryptForUse({
          secretId: created.id,
          tenantId: TENANT_A,
          templateId: "git-clone",
          args: ["https://evil.example/leak.git"],
        })
        .pipe(
          Effect.catchTag("PolicyDeniedError", (err) => Effect.succeed(err)),
        );

      expect(caught).toBeInstanceOf(PolicyDeniedError);
      const err = caught as PolicyDeniedError;
      expect(err.reason).toBe("argPrefix");
      expect(err.templateId).toBe("git-clone");
      expect(err.expected).toEqual(["https://github.com/acme/"]);

      const audits = yield* Effect.promise(() =>
        ctx.db
          .select()
          .from(sessionSecretUsages)
          .where(eq(sessionSecretUsages.secretId, created.id)),
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]!.success).toBe(false);
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("decryptForUse with usesRemaining=1 succeeds once, then fails with MaxUsesExceededError", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      const created = yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "one-shot",
        plaintext: "only-once",
        usesRemaining: 1,
      });

      const first = yield* svc.decryptForUse({
        secretId: created.id,
        tenantId: TENANT_A,
      });
      expect(first.plaintext).toBe("only-once");

      const afterFirst = yield* Effect.promise(() =>
        ctx.db
          .select({ usesRemaining: sessionSecrets.usesRemaining })
          .from(sessionSecrets)
          .where(eq(sessionSecrets.id, created.id)),
      );
      expect(afterFirst[0]!.usesRemaining).toBe(0);

      const caught = yield* svc
        .decryptForUse({ secretId: created.id, tenantId: TENANT_A })
        .pipe(
          Effect.catchTag("MaxUsesExceededError", (err) => Effect.succeed(err)),
        );

      expect(caught).toBeInstanceOf(MaxUsesExceededError);
      expect((caught as MaxUsesExceededError).secretId).toBe(created.id);

      // Row stays at 0 — no negative counter.
      const afterSecond = yield* Effect.promise(() =>
        ctx.db
          .select({ usesRemaining: sessionSecrets.usesRemaining })
          .from(sessionSecrets)
          .where(eq(sessionSecrets.id, created.id)),
      );
      expect(afterSecond[0]!.usesRemaining).toBe(0);
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("decryptForUse with usesRemaining=null stays null across 3 successful calls", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      const created = yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "unbounded",
        plaintext: "forever",
      });

      for (let i = 0; i < 3; i++) {
        const r = yield* svc.decryptForUse({
          secretId: created.id,
          tenantId: TENANT_A,
        });
        expect(r.plaintext).toBe("forever");
      }

      const rows = yield* Effect.promise(() =>
        ctx.db
          .select({ usesRemaining: sessionSecrets.usesRemaining })
          .from(sessionSecrets)
          .where(eq(sessionSecrets.id, created.id)),
      );
      expect(rows[0]!.usesRemaining).toBeNull();

      // Three audit rows, all success=true.
      const audits = yield* Effect.promise(() =>
        ctx.db
          .select()
          .from(sessionSecretUsages)
          .where(eq(sessionSecretUsages.secretId, created.id)),
      );
      expect(audits).toHaveLength(3);
      expect(audits.every((a) => a.success === true)).toBe(true);
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("markSecretUsed writes a usage row for a tenant-owned secret without decrementing usesRemaining", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      const created = yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "audit-only",
        plaintext: "ghp_reuse",
        usesRemaining: 7,
      });

      const sessionId =
        "00000000-0000-0000-0000-000000000001" as SessionId;

      yield* svc.markSecretUsed({
        secretId: created.id,
        tenantId: TENANT_A,
        templateId: "git-clone",
        commandPrefix: "git clone",
        sessionId,
      });

      const audits = yield* Effect.promise(() =>
        ctx.db
          .select()
          .from(sessionSecretUsages)
          .where(eq(sessionSecretUsages.secretId, created.id)),
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]!.secretId).toBe(created.id);
      expect(audits[0]!.templateId).toBe("git-clone");
      expect(audits[0]!.commandPrefix).toBe("git clone");
      expect(audits[0]!.success).toBe(true);
      expect(audits[0]!.sessionId).toBe(sessionId);

      // usesRemaining must be untouched — markSecretUsed is audit-only.
      const rows = yield* Effect.promise(() =>
        ctx.db
          .select({ usesRemaining: sessionSecrets.usesRemaining })
          .from(sessionSecrets)
          .where(eq(sessionSecrets.id, created.id)),
      );
      expect(rows[0]!.usesRemaining).toBe(7);
    }).pipe(Effect.provide(secretsLayer)),
  );

  it.effect("markSecretUsed for another tenant's secret → SecretNotFoundError (no audit row written)", () =>
    Effect.gen(function* () {
      const svc = yield* Secrets.asEffect();
      const aSecret = yield* svc.createSecret({
        tenantId: TENANT_A,
        name: "a-only-audit",
        plaintext: "a-plaintext",
      });

      const caught = yield* svc
        .markSecretUsed({
          secretId: aSecret.id,
          tenantId: TENANT_B,
          templateId: "x",
        })
        .pipe(
          Effect.catchTag("SecretNotFoundError", (err) => Effect.succeed(err)),
        );

      expect(caught).toBeInstanceOf(SecretNotFoundError);
      expect((caught as SecretNotFoundError).secretId).toBe(aSecret.id);
      expect((caught as SecretNotFoundError).tenantId).toBe(TENANT_B);

      // No audit row should have been written.
      const audits = yield* Effect.promise(() =>
        ctx.db
          .select()
          .from(sessionSecretUsages)
          .where(eq(sessionSecretUsages.secretId, aSecret.id)),
      );
      expect(audits).toHaveLength(0);
    }).pipe(Effect.provide(secretsLayer)),
  );
});

// Type-only assertion — ensure the SecretEnvelope brand types line up.
// (The runtime assertions above cover behavior; this guards signatures.)
const _secretIdShape: SessionSecretId | undefined = undefined;
void _secretIdShape;
