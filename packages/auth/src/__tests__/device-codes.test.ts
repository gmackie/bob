import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { createTestDb } from "@gmacko/db/testing";
import { layerGmackoDb } from "@gmacko/db";
import { users } from "@gmacko/db/schema/auth";
import { tenants, tenantMembers } from "@gmacko/db/schema/tenancy";
import { apiKeys as apiKeysTable } from "@gmacko/db/schema/api-keys";
import { deviceCodes as deviceCodesTable } from "@gmacko/db/schema/device-codes";
import { and, eq, isNull } from "drizzle-orm";
import type { TenantId, UserId } from "@gmacko/core/validators";

import { layerApiKeys } from "../api-keys.js";
import {
  AlreadyApprovedError,
  DeviceCodes,
  InvalidDeviceCodeError,
  InvalidUserCodeError,
  layerDeviceCodes,
} from "../device-codes.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;

const USER_ID = "user_device_abc" as UserId;
const USER_EMAIL = "device-user@example.com";
const TENANT_ID = "22222222-2222-2222-2222-222222222222" as TenantId;

// Crockford base32 minus I/L/O/U, two groups of 4 joined by `-`.
const USER_CODE_REGEX = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let ctx: TestCtx;
let layer: Layer.Layer<DeviceCodes>;

async function seed(ctx: TestCtx) {
  await ctx.db.insert(users).values({
    id: USER_ID,
    name: "Device Flow Test User",
    email: USER_EMAIL,
  });
  await ctx.db.insert(tenants).values({
    id: TENANT_ID,
    name: "Test Tenant",
    slug: "device-test-tenant",
  });
  await ctx.db.insert(tenantMembers).values({
    tenantId: TENANT_ID,
    userId: USER_ID,
    role: "owner",
  });
}

beforeEach(async () => {
  ctx = await createTestDb();
  await seed(ctx);
  // DeviceCodes depends on ApiKeys which depends on GmackoDb. Compose the
  // full graph: provide GmackoDb to ApiKeys, then provide (ApiKeys + GmackoDb)
  // to DeviceCodes.
  const dbLayer = layerGmackoDb(ctx.db);
  const apiKeyLayer = Layer.provide(layerApiKeys(), dbLayer);
  const apiKeysPlusDb = Layer.merge(apiKeyLayer, dbLayer);
  layer = Layer.provide(layerDeviceCodes({}), apiKeysPlusDb);
});

afterEach(async () => {
  await ctx.teardown();
});

describe("@gmacko/auth DeviceCodes service", () => {
  it.effect("start() returns a UUID deviceCode, well-formed userCode, and 600s TTL", () =>
    Effect.gen(function* () {
      const svc = yield* DeviceCodes.asEffect();
      const started = yield* svc.start();
      expect(started.deviceCode).toMatch(UUID_REGEX);
      expect(started.userCode).toMatch(USER_CODE_REGEX);
      expect(started.expiresInSeconds).toBe(600);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("start + approve + poll mints a gmk_ key, second poll returns consumed", () =>
    Effect.gen(function* () {
      const svc = yield* DeviceCodes.asEffect();
      const started = yield* svc.start();

      yield* svc.approve({
        userCode: started.userCode,
        userId: USER_ID,
        tenantId: TENANT_ID,
      });

      const first = yield* svc.poll(started.deviceCode);
      expect(first.status).toBe("approved");
      if (first.status !== "approved") {
        throw new Error("unreachable — narrow for TS");
      }
      expect(first.plaintextApiKey.length).toBeGreaterThan(0);
      expect(first.plaintextApiKey.startsWith("gmk_")).toBe(true);

      const second = yield* svc.poll(started.deviceCode);
      expect(second.status).toBe("consumed");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("approve with unknown userCode fails with InvalidUserCodeError", () =>
    Effect.gen(function* () {
      const svc = yield* DeviceCodes.asEffect();
      const caught = yield* svc
        .approve({
          userCode: "ZZZZ-ZZZZ",
          userId: USER_ID,
          tenantId: TENANT_ID,
        })
        .pipe(
          Effect.catchTag("InvalidUserCodeError", (err) =>
            Effect.succeed(err),
          ),
        );
      expect(caught).toBeInstanceOf(InvalidUserCodeError);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("approve twice returns AlreadyApprovedError on the second call", () =>
    Effect.gen(function* () {
      const svc = yield* DeviceCodes.asEffect();
      const started = yield* svc.start();
      yield* svc.approve({
        userCode: started.userCode,
        userId: USER_ID,
        tenantId: TENANT_ID,
      });
      const caught = yield* svc
        .approve({
          userCode: started.userCode,
          userId: USER_ID,
          tenantId: TENANT_ID,
        })
        .pipe(
          Effect.catchTag("AlreadyApprovedError", (err) =>
            Effect.succeed(err),
          ),
        );
      expect(caught).toBeInstanceOf(AlreadyApprovedError);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("poll with unknown deviceCode fails with InvalidDeviceCodeError", () =>
    Effect.gen(function* () {
      const svc = yield* DeviceCodes.asEffect();
      const caught = yield* svc
        .poll("00000000-0000-0000-0000-000000000000")
        .pipe(
          Effect.catchTag("InvalidDeviceCodeError", (err) =>
            Effect.succeed(err),
          ),
        );
      expect(caught).toBeInstanceOf(InvalidDeviceCodeError);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("expired pending row flips to 'expired' on poll; second poll stays expired", () =>
    Effect.gen(function* () {
      // Insert a pending row directly with expiresAt in the past.
      const inserted = yield* Effect.promise(async () =>
        ctx.db
          .insert(deviceCodesTable)
          .values({
            userCode: "EXPR-0001",
            expiresAt: new Date(Date.now() - 1000),
          })
          .returning(),
      );
      const row = inserted[0]!;

      const svc = yield* DeviceCodes.asEffect();
      const first = yield* svc.poll(row.deviceCode);
      expect(first.status).toBe("expired");

      // Row should now be marked "expired" in the DB.
      const after = yield* Effect.promise(async () =>
        ctx.db
          .select({ status: deviceCodesTable.status })
          .from(deviceCodesTable)
          .where(eq(deviceCodesTable.id, row.id))
          .limit(1),
      );
      expect(after[0]!.status).toBe("expired");

      // A second poll still returns "expired" and does not try to re-flip.
      const second = yield* svc.poll(row.deviceCode);
      expect(second.status).toBe("expired");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("concurrent polls after approval: exactly one 'approved', one 'consumed', one unrevoked key", () =>
    Effect.gen(function* () {
      const svc = yield* DeviceCodes.asEffect();
      const started = yield* svc.start();
      yield* svc.approve({
        userCode: started.userCode,
        userId: USER_ID,
        tenantId: TENANT_ID,
      });

      const results = yield* Effect.all(
        [svc.poll(started.deviceCode), svc.poll(started.deviceCode)],
        { concurrency: 2 },
      );

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual(["approved", "consumed"]);

      const approved = results.find((r) => r.status === "approved");
      if (!approved || approved.status !== "approved") {
        throw new Error("expected exactly one approved result");
      }
      expect(approved.plaintextApiKey.startsWith("gmk_")).toBe(true);

      // Exactly one unrevoked key for this (userId, tenantId). If PGlite
      // serialises the two polls (which it does on a single connection),
      // the loser never enters the claim path and no extra row exists.
      // If the two polls truly race (multi-connection driver) we'd see a
      // revoked row too, but the *unrevoked* count must still be 1.
      const activeKeys = yield* Effect.promise(async () =>
        ctx.db
          .select({ id: apiKeysTable.id })
          .from(apiKeysTable)
          .where(
            and(
              eq(apiKeysTable.userId, USER_ID),
              eq(apiKeysTable.tenantId, TENANT_ID),
              isNull(apiKeysTable.revokedAt),
            ),
          ),
      );
      expect(activeKeys).toHaveLength(1);
    }).pipe(Effect.provide(layer)),
  );
});
