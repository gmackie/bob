import { describe, expect, it } from "vitest";

import type { CommandResult } from "./cli-provider.js";
import { probeCliProvider } from "./cli-provider.js";

describe("probeCliProvider", () => {
  it("reports a ready authenticated provider without exposing command output", async () => {
    const run = (_command: string, args: string[]): Promise<CommandResult> =>
      Promise.resolve(args.includes("--version")
        ? { code: 0, stdout: "grok 1.2.3\n", stderr: "" }
        : { code: 0, stdout: "signed in as secret@example.com", stderr: "" });

    const result = await probeCliProvider("grok", run, new Date("2026-07-11T18:00:00Z"));

    expect(result).toMatchObject({
      provider: "grok",
      command: "grok",
      installed: true,
      authenticated: true,
      version: "grok 1.2.3",
      status: "ready",
    });
    expect(JSON.stringify(result)).not.toContain("secret@example.com");
  });

  it("distinguishes an installed but unauthenticated Cursor CLI", async () => {
    const run = (_command: string, args: string[]): Promise<CommandResult> =>
      Promise.resolve(args.includes("--version")
        ? { code: 0, stdout: "cursor-agent 0.9", stderr: "" }
        : { code: 1, stdout: "Not authenticated", stderr: "" });

    expect(await probeCliProvider("cursor-agent", run)).toMatchObject({
      installed: true,
      authenticated: false,
      status: "unauthenticated",
    });
  });

  it("reports a missing CLI as unavailable", async () => {
    const run = (): Promise<CommandResult> =>
      Promise.reject(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));

    expect(await probeCliProvider("codex", run)).toMatchObject({
      installed: false,
      authenticated: false,
      status: "unavailable",
    });
  });
});
