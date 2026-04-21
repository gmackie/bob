import { describe, beforeEach, afterEach, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { createTestDb } from "@gmacko/db/testing";
import { layerGmackoDb } from "@gmacko/db";

import { Secrets, layerSecrets } from "../index.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;
let ctx: TestCtx;

beforeEach(async () => {
  process.env.GMACKO_SECRET_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  ctx = await createTestDb();
});

afterEach(async () => {
  await ctx.teardown();
  delete process.env.GMACKO_SECRET_ENCRYPTION_KEY;
});

describe("@gmacko/secrets layerSecrets", () => {
  it.effect("resolves Secrets when provided with GmackoDb, with all methods callable", () =>
    Effect.gen(function* () {
      const secrets = yield* Secrets;
      expect(typeof secrets.createSecret).toBe("function");
      expect(typeof secrets.deleteSecret).toBe("function");
      expect(typeof secrets.listForTenant).toBe("function");
      expect(typeof secrets.getSecret).toBe("function");
      expect(typeof secrets.decryptForUse).toBe("function");
      expect(typeof secrets.markSecretUsed).toBe("function");
    }).pipe(Effect.provide(Layer.provide(layerSecrets, layerGmackoDb(ctx.db)))),
  );
});
