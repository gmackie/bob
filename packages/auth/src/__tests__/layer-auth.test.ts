import { describe, beforeEach, afterEach, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { createTestDb } from "@gmacko/db/testing";
import { layerGmackoDb } from "@gmacko/db";

import { ApiKeys, DeviceCodes, Sessions, Tenancy, layerAuth } from "../index.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;
let ctx: TestCtx;

beforeEach(async () => {
  ctx = await createTestDb();
});

afterEach(async () => {
  await ctx.teardown();
});

describe("@gmacko/auth layerAuth bundle", () => {
  it.effect("provides Sessions + ApiKeys + DeviceCodes + Tenancy when given GmackoDb", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const apiKeys = yield* ApiKeys;
      const deviceCodes = yield* DeviceCodes;
      const tenancy = yield* Tenancy;
      expect(typeof sessions.validateToken).toBe("function");
      expect(typeof apiKeys.issueKey).toBe("function");
      expect(typeof deviceCodes.start).toBe("function");
      expect(typeof tenancy.listMemberships).toBe("function");
    }).pipe(Effect.provide(Layer.provide(layerAuth(), layerGmackoDb(ctx.db)))),
  );

  it.effect("accepts LayerAuthOptions (custom apiKey prefixes propagate to ApiKeys)", () =>
    Effect.gen(function* () {
      const apiKeys = yield* ApiKeys;
      // Custom prefix list is used by isApiKey; default 'gmk_' is no longer accepted.
      expect(apiKeys.isApiKey("zzz_whatever")).toBe(true);
      expect(apiKeys.isApiKey("gmk_ignored")).toBe(false);
    }).pipe(
      Effect.provide(
        Layer.provide(
          layerAuth({ apiKeys: { prefixes: ["zzz_"] } }),
          layerGmackoDb(ctx.db),
        ),
      ),
    ),
  );
});
