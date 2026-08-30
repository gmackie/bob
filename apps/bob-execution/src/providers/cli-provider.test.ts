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

describe("probeCliProvider — credit state", () => {
  const authedRun = (_command: string, args: string[]): Promise<CommandResult> =>
    Promise.resolve(args.includes("--version")
      ? { code: 0, stdout: "grok 1.2.3\n", stderr: "" }
      : { code: 0, stdout: "ok", stderr: "" });

  it("reports no_credit for an authenticated provider with an exhausted balance", async () => {
    // The 2026-08-29 regression: grok passed its auth probe and died on every
    // dispatch with 402. `ready` here is what burned the backlog for 8 days.
    const result = await probeCliProvider("grok", authedRun, new Date(), {
      latched: true,
      detail: "402 Payment Required — Grok Build usage balance exhausted",
    });

    expect(result.status).toBe("no_credit");
    expect(result.authenticated).toBe(true);
    expect(result.installed).toBe(true);
    expect(result.detail).toContain("usage balance exhausted");
  });

  it("stays ready when no credit latch is set", async () => {
    expect(await probeCliProvider("grok", authedRun, new Date(), { latched: false })).toMatchObject({
      status: "ready",
    });
  });

  it("prefers unauthenticated over no_credit — you cannot spend what you cannot reach", async () => {
    const run = (_command: string, args: string[]): Promise<CommandResult> =>
      Promise.resolve(args.includes("--version")
        ? { code: 0, stdout: "grok 1.2.3", stderr: "" }
        : { code: 1, stdout: "", stderr: "OAuth token revoked" });

    expect(await probeCliProvider("grok", run, new Date(), { latched: true })).toMatchObject({
      status: "unauthenticated",
    });
  });

  it("surfaces the provider's own wording when auth fails", async () => {
    const run = (_command: string, args: string[]): Promise<CommandResult> =>
      Promise.resolve(args.includes("--version")
        ? { code: 0, stdout: "codex 1.0", stderr: "" }
        : { code: 1, stdout: "", stderr: "OAuth token revoked — re-login required" });

    const result = await probeCliProvider("codex", run);
    expect(result.detail).toContain("re-login required");
  });

  it("does not leak an account identifier from a failing auth probe", async () => {
    const run = (_command: string, args: string[]): Promise<CommandResult> =>
      Promise.resolve(args.includes("--version")
        ? { code: 0, stdout: "claude 2.0", stderr: "" }
        : { code: 1, stdout: "", stderr: "not signed in as secret@example.com" });

    expect(JSON.stringify(await probeCliProvider("claude", run))).not.toContain("secret@example.com");
  });
});
