import { describe, expect, it, vi } from "vitest";

vi.mock("@gmacko/ooda/db/client", () => ({ db: {} }));
vi.mock("@gmacko/ooda/db/auth", () => ({
  validateSessionToken: vi.fn(),
  extractSessionToken: vi.fn(),
  SessionNotFoundError: class extends Error {},
}));

describe("tRPC OpenAPI meta", () => {
  it("t instance accepts OpenApiMeta on procedures", async () => {
    const { t } = await import("../trpc");
    const proc = t.procedure
      .meta({ openapi: { method: "GET", path: "/test" } })
      .query(() => "ok");
    expect(proc).toBeDefined();
  });

  it("procedures without meta still work", async () => {
    const { publicProcedure } = await import("../trpc");
    const proc = publicProcedure.query(() => "ok");
    expect(proc).toBeDefined();
  });
});
