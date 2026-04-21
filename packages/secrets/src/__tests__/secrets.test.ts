import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { and, eq } from "drizzle-orm";

import { createTestDb } from "@gmacko/db/testing";
import { layerGmackoDb } from "@gmacko/db";
import { tenants } from "@gmacko/db/schema/tenancy";
import { sessionSecrets } from "@gmacko/db/schema/secrets";
import type { SessionSecretId, TenantId } from "@gmacko/validators";

import { decryptSecretValue } from "../crypt.js";
import {
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
});

// Type-only assertion — ensure the SecretEnvelope brand types line up.
// (The runtime assertions above cover behavior; this guards signatures.)
const _secretIdShape: SessionSecretId | undefined = undefined;
void _secretIdShape;
