import { lstat, symlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  ScratchSandboxManager,
  buildIsolatedAgentEnvironment,
} from "../scratch-sandbox";

const roots: string[] = [];

describe("ScratchSandboxManager", () => {
  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => new ScratchSandboxManager(root).cleanupRoot()),
    );
  });

  it("creates a private disposable directory beneath a real root", async () => {
    const root = join(tmpdir(), `ooda-scratch-test-${crypto.randomUUID()}`);
    roots.push(root);
    const manager = new ScratchSandboxManager(root);
    const sandbox = await manager.create("job-123");

    expect(sandbox.path.startsWith(`${root}/job-123-`)).toBe(true);
    expect((await lstat(sandbox.path)).mode & 0o777).toBe(0o700);
    await sandbox.cleanup();
    await expect(lstat(sandbox.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects traversal ids and symlinked scratch roots", async () => {
    const realRoot = join(tmpdir(), `ooda-scratch-real-${crypto.randomUUID()}`);
    const linkedRoot = join(
      tmpdir(),
      `ooda-scratch-link-${crypto.randomUUID()}`,
    );
    roots.push(realRoot, linkedRoot);
    const real = new ScratchSandboxManager(realRoot);
    await real.ensureRoot();
    await symlink(realRoot, linkedRoot);

    await expect(real.create("../escape")).rejects.toThrow(/invalid job id/i);
    await expect(
      new ScratchSandboxManager(linkedRoot).create("job-1"),
    ).rejects.toThrow(/symlink/i);
  });

  it("passes only execution basics and the selected provider credential", () => {
    const environment = buildIsolatedAgentEnvironment({
      provider: "claude",
      sandboxPath: "/tmp/ooda-job",
      source: {
        PATH: "/usr/bin",
        LANG: "en_US.UTF-8",
        ANTHROPIC_API_KEY: "allowed",
        OPENAI_API_KEY: "not-selected",
        AWS_SECRET_ACCESS_KEY: "must-not-leak",
        DATABASE_URL: "must-not-leak",
      },
    });

    expect(environment).toMatchObject({
      PATH: "/usr/bin",
      LANG: "en_US.UTF-8",
      HOME: "/tmp/ooda-job/.home",
      ANTHROPIC_API_KEY: "allowed",
    });
    expect(environment).not.toHaveProperty("OPENAI_API_KEY");
    expect(environment).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(environment).not.toHaveProperty("DATABASE_URL");
  });

  it("removes retained scratch artifacts after seven days", async () => {
    const root = join(tmpdir(), `ooda-scratch-expiry-${crypto.randomUUID()}`);
    roots.push(root);
    const manager = new ScratchSandboxManager(root);
    const sandbox = await manager.create("job-expired");
    const eightDaysAgo = new Date("2026-07-30T12:00:00.000Z");
    await utimes(sandbox.path, eightDaysAgo, eightDaysAgo);

    await expect(
      manager.cleanupExpired(new Date("2026-08-07T12:00:00.000Z")),
    ).resolves.toBe(1);
    await expect(lstat(sandbox.path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
