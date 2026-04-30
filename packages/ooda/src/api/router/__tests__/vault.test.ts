import { describe, expect, it, vi } from "vitest";

// Mock the db client to avoid needing DATABASE_URL at import time
vi.mock("@gmacko/ooda/db/client", () => ({
  db: {},
}));

// Mock @gmacko/ooda/vault to avoid filesystem/git calls
vi.mock("@gmacko/ooda/vault", () => ({
  listFiles: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  commitAndPush: vi.fn(),
  pull: vi.fn(),
  isLocked: vi.fn(),
  hasConflicts: vi.fn(),
}));

const { vaultRouter } = await import("../vault");

describe("vaultRouter", () => {
  it("exports the router object", () => {
    expect(vaultRouter).toBeDefined();
    expect(typeof vaultRouter).toBe("object");
  });

  it("has expected query procedures", () => {
    const expectedQueries = ["list", "read", "health"];
    for (const name of expectedQueries) {
      expect(vaultRouter).toHaveProperty(name);
      expect((vaultRouter as Record<string, unknown>)[name]).toBeDefined();
    }
  });

  it("has expected mutation procedures", () => {
    const expectedMutations = ["write", "promote", "sync"];
    for (const name of expectedMutations) {
      expect(vaultRouter).toHaveProperty(name);
      expect((vaultRouter as Record<string, unknown>)[name]).toBeDefined();
    }
  });

  it("has exactly the expected procedure count", () => {
    const procedureNames = Object.keys(vaultRouter);
    expect(procedureNames).toHaveLength(6);
    expect(procedureNames.sort()).toEqual([
      "health",
      "list",
      "promote",
      "read",
      "sync",
      "write",
    ]);
  });
});
