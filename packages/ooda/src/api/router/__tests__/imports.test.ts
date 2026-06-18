import { describe, expect, it, vi } from "vitest";

// Mock the db client to avoid needing DATABASE_URL at import time
vi.mock("@gmacko/ooda/db/client", () => ({
  db: {},
}));

const { importsRouter } = await import("../imports");

describe("importsRouter", () => {
  it("exports the router object", () => {
    expect(importsRouter).toBeDefined();
    expect(typeof importsRouter).toBe("object");
  });

  it("has expected mutation procedures", () => {
    expect(importsRouter).toHaveProperty("normalize");
    expect(importsRouter).toHaveProperty("importConversations");
    expect(
      (importsRouter as Record<string, unknown>).normalize,
    ).toBeDefined();
    expect(
      (importsRouter as Record<string, unknown>).importConversations,
    ).toBeDefined();
  });

  it("has exactly the expected procedure count", () => {
    const procedureNames = Object.keys(importsRouter);
    expect(procedureNames).toHaveLength(2);
    expect(procedureNames.sort()).toEqual([
      "importConversations",
      "normalize",
    ]);
  });
});
