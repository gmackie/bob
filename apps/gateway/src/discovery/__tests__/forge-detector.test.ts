import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForgeDetector } from "../forge-detector.js";

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "child_process";
const mockExecSync = vi.mocked(execSync);

describe("ForgeDetector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects forge CLI when present", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("/home/user/.forgegraph/bin/fg"));
    const detector = new ForgeDetector();
    expect(detector.isAvailable()).toBe(true);
  });

  it("returns unavailable when forge CLI missing", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("command not found");
    });
    const detector = new ForgeDetector();
    expect(detector.isAvailable()).toBe(false);
  });

  it("checks auth status", () => {
    // forge available
    mockExecSync.mockReturnValueOnce(Buffer.from("/home/user/.forgegraph/bin/fg"));
    const detector = new ForgeDetector();

    // forge auth status returns success
    mockExecSync.mockReturnValueOnce(Buffer.from("authenticated as mackieg"));
    expect(detector.isAuthenticated()).toBe(true);
  });

  it("returns unauthenticated when forge auth fails", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("/home/user/.forgegraph/bin/fg"));
    const detector = new ForgeDetector();

    mockExecSync.mockImplementationOnce(() => {
      throw new Error("not authenticated");
    });
    expect(detector.isAuthenticated()).toBe(false);
  });

  it("lists forge apps", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("/home/user/.forgegraph/bin/fg"));
    const detector = new ForgeDetector();

    mockExecSync.mockReturnValueOnce(
      Buffer.from(JSON.stringify([
        { id: "abc", name: "bob", slug: "bob", flakeRef: "git+https://gitea.forge.gmac.io/mackieg/bob.git?ref=main" },
        { id: "def", name: "my-site", slug: "my-site", flakeRef: "git+https://gitea.forge.gmac.io/mackieg/my-site.git?ref=main" },
      ]))
    );

    const apps = detector.listApps();
    expect(apps).toHaveLength(2);
    expect(apps[0]!.name).toBe("bob");
  });

  it("extracts remote URL from flakeRef", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("/home/user/.forgegraph/bin/fg"));
    const detector = new ForgeDetector();
    const url = detector.extractRemoteUrl("git+https://gitea.forge.gmac.io/mackieg/bob.git?ref=main&rev=abc123");
    expect(url).toBe("https://gitea.forge.gmac.io/mackieg/bob.git");
  });

  it("finds app by remote URL", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("/home/user/.forgegraph/bin/fg"));
    const detector = new ForgeDetector();

    // Pre-populate cached apps via listApps
    mockExecSync.mockReturnValueOnce(
      Buffer.from(JSON.stringify([
        { id: "abc", name: "bob", slug: "bob", flakeRef: "git+https://gitea.forge.gmac.io/mackieg/bob.git?ref=main" },
        { id: "def", name: "my-site", slug: "my-site", flakeRef: "git+https://gitea.forge.gmac.io/mackieg/my-site.git?ref=main" },
      ]))
    );
    detector.listApps();

    const app = detector.findAppByRemoteUrl("https://gitea.forge.gmac.io/mackieg/bob.git");
    expect(app).toBeDefined();
    expect(app!.name).toBe("bob");
  });

  it("findAppByRemoteUrl normalizes .git suffix", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("/home/user/.forgegraph/bin/fg"));
    const detector = new ForgeDetector();

    mockExecSync.mockReturnValueOnce(
      Buffer.from(JSON.stringify([
        { id: "abc", name: "bob", slug: "bob", flakeRef: "git+https://gitea.forge.gmac.io/mackieg/bob.git?ref=main" },
      ]))
    );
    detector.listApps();

    // Search without .git suffix should still match
    const app = detector.findAppByRemoteUrl("https://gitea.forge.gmac.io/mackieg/bob");
    expect(app).toBeDefined();
    expect(app!.name).toBe("bob");
  });

  it("returns undefined when no app matches remote URL", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("/home/user/.forgegraph/bin/fg"));
    const detector = new ForgeDetector();

    mockExecSync.mockReturnValueOnce(
      Buffer.from(JSON.stringify([
        { id: "abc", name: "bob", slug: "bob", flakeRef: "git+https://gitea.forge.gmac.io/mackieg/bob.git?ref=main" },
      ]))
    );
    detector.listApps();

    const app = detector.findAppByRemoteUrl("https://github.com/other/repo.git");
    expect(app).toBeUndefined();
  });

  it("returns false for isAuthenticated when CLI unavailable", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("command not found");
    });
    const detector = new ForgeDetector();
    expect(detector.isAuthenticated()).toBe(false);
  });

  it("returns empty array for listApps when CLI unavailable", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("command not found");
    });
    const detector = new ForgeDetector();
    expect(detector.listApps()).toEqual([]);
  });
});
