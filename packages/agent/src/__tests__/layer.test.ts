import { describe, beforeEach, afterEach, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { createTestDb } from "@gmacko/db/testing";
import { layerGmackoDb } from "@gmacko/db";

import { AgentSession, layerAgent, mockAdapter } from "../index.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;
let ctx: TestCtx;

beforeEach(async () => {
  ctx = await createTestDb();
});

afterEach(async () => {
  await ctx.teardown();
});

describe("@gmacko/agent layerAgent", () => {
  it.effect("resolves AgentSession with all methods callable when provided GmackoDb + adapter", () =>
    Effect.gen(function* () {
      const session = yield* AgentSession;
      expect(typeof session.create).toBe("function");
      expect(typeof session.sendTurn).toBe("function");
      expect(typeof session.cancel).toBe("function");
      expect(typeof session.close).toBe("function");
    }).pipe(
      Effect.provide(Layer.provide(layerAgent(mockAdapter({ events: [] })), layerGmackoDb(ctx.db))),
    ),
  );
});
