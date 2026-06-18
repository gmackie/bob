import { describe, expect, it, vi } from "vitest";

// Mock the db client to avoid needing DATABASE_URL at import time
vi.mock("@gmacko/ooda/db/client", () => ({
  db: {},
}));

// Mock @gmacko/ooda/vault to avoid filesystem/git calls
vi.mock("@gmacko/ooda/vault", () => ({
  publishDraft: vi.fn().mockResolvedValue("_drafts/test-post.md"),
  listFiles: vi.fn().mockResolvedValue(["draft-one.md", "draft-two.md"]),
  listFile: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  commitAndPush: vi.fn(),
  pull: vi.fn(),
  isLocked: vi.fn(),
  hasConflicts: vi.fn(),
}));

const { publishRouter } = await import("../publish");

describe("publishRouter", () => {
  it("exports the router object", () => {
    expect(publishRouter).toBeDefined();
    expect(typeof publishRouter).toBe("object");
  });

  it("has expected mutation procedures", () => {
    expect(publishRouter).toHaveProperty("draft");
    expect((publishRouter as Record<string, unknown>).draft).toBeDefined();
  });

  it("has expected query procedures", () => {
    expect(publishRouter).toHaveProperty("listDrafts");
    expect(
      (publishRouter as Record<string, unknown>).listDrafts,
    ).toBeDefined();
  });

  it("has exactly the expected procedure count", () => {
    const procedureNames = Object.keys(publishRouter);
    expect(procedureNames).toHaveLength(2);
    expect(procedureNames.sort()).toEqual(["draft", "listDrafts"]);
  });
});
