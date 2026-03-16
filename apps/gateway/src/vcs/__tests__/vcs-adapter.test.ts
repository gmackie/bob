import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

// Import after mock so the mock takes effect
import { existsSync } from "node:fs";
import { detectVcs, getVcsAdapter } from "../vcs-adapter.js";
import { JjAdapter } from "../jj-adapter.js";
import { GitAdapter } from "../git-adapter.js";

const existsSyncMock = vi.mocked(existsSync);

describe("detectVcs", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
  });

  it("returns 'jj' when .jj directory exists", () => {
    existsSyncMock.mockImplementation((path) => {
      if (typeof path === "string" && path.endsWith(".jj")) return true;
      return false;
    });

    expect(detectVcs("/repo")).toBe("jj");
  });

  it("returns 'git' when only .git exists (no .jj)", () => {
    existsSyncMock.mockImplementation((path) => {
      if (typeof path === "string" && path.endsWith(".git")) return true;
      return false;
    });

    expect(detectVcs("/repo")).toBe("git");
  });

  it("returns 'git' when neither .jj nor .git exists (default)", () => {
    existsSyncMock.mockReturnValue(false);

    expect(detectVcs("/repo")).toBe("git");
  });
});

describe("getVcsAdapter", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
  });

  it("returns JjAdapter for jj repos", () => {
    existsSyncMock.mockImplementation((path) => {
      if (typeof path === "string" && path.endsWith(".jj")) return true;
      return false;
    });

    const adapter = getVcsAdapter("/repo");
    expect(adapter).toBeInstanceOf(JjAdapter);
    expect(adapter.type).toBe("jj");
  });

  it("returns GitAdapter for git repos", () => {
    existsSyncMock.mockReturnValue(false);

    const adapter = getVcsAdapter("/repo");
    expect(adapter).toBeInstanceOf(GitAdapter);
    expect(adapter.type).toBe("git");
  });
});
