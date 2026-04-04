import { describe, it, expect, vi, beforeEach } from "vitest";
import { RepoScanner, DiscoveredRepo } from "../repo-scanner.js";

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

import { execFileSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";

const mockExecFileSync = vi.mocked(execFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockStatSync = vi.mocked(statSync);

describe("RepoScanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scans top-level directories and classifies git repos", () => {
    mockReaddirSync.mockReturnValue(["bob", "my-site", "notes"] as any);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

    // bob has .git, my-site has .git, notes does not
    mockExistsSync.mockImplementation((path: any) => {
      if (path === "/dev") return true;
      if (path === "/dev/bob/.git") return true;
      if (path === "/dev/my-site/.git") return true;
      if (path === "/dev/notes/.git") return false;
      // build system checks
      if (path === "/dev/bob/package.json") return true;
      if (path === "/dev/my-site/go.mod") return true;
      return false;
    });

    // git commands via execFileSync(cmd, args, options)
    mockExecFileSync.mockImplementation((_cmd: any, args: any) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("status --porcelain")) return "";
      if (argStr.includes("branch --show-current")) return "main\n";
      if (argStr.includes("remote") && argStr.includes("get-url") && argStr.includes("/dev/bob")) {
        return "https://gitea.forge.gmac.io/mackieg/bob.git\n";
      }
      if (argStr.includes("remote") && argStr.includes("get-url") && argStr.includes("/dev/my-site")) {
        return "https://gitea.forge.gmac.io/mackieg/my-site.git\n";
      }
      return "";
    });

    const scanner = new RepoScanner("/dev");
    const results = scanner.scan();

    expect(results).toHaveLength(3);

    const bob = results.find((r) => r.name === "bob")!;
    expect(bob.isGit).toBe(true);
    expect(bob.remoteUrl).toContain("bob.git");
    expect(bob.buildSystem).toBe("node");

    const notes = results.find((r) => r.name === "notes")!;
    expect(notes.isGit).toBe(false);
  });
});
