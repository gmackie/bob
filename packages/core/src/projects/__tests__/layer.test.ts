import { describe, beforeEach, afterEach, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { createTestDb } from "@gmacko/core/db/testing";
import { layerGmackoDb } from "@gmacko/core/db";

import { Projects, layerProjects } from "../index.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;
let ctx: TestCtx;

beforeEach(async () => {
  ctx = await createTestDb();
});

afterEach(async () => {
  await ctx.teardown();
});

describe("@gmacko/projects layerProjects", () => {
  it.effect("resolves Projects when provided with GmackoDb", () =>
    Effect.gen(function* () {
      const projects = yield* Projects;
      expect(typeof projects.createProject).toBe("function");
      expect(typeof projects.listForTenant).toBe("function");
      expect(typeof projects.getById).toBe("function");
      expect(typeof projects.getBySlug).toBe("function");
      expect(typeof projects.deleteProject).toBe("function");
    }).pipe(Effect.provide(Layer.provide(layerProjects, layerGmackoDb(ctx.db)))),
  );
});
