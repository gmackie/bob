import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthPrompt, AuthPty, AuthResult } from "./auth-session.js";
import { AuthSessionManager } from "./auth-session.js";

class FakePty implements AuthPty {
  written: string[] = [];
  killed = false;
  private dataCb: ((chunk: string) => void) | null = null;
  private exitCb: ((code: number) => void) | null = null;

  write(data: string): void {
    this.written.push(data);
  }
  kill(): void {
    this.killed = true;
    this.exitCb?.(130);
  }
  onData(cb: (chunk: string) => void): void {
    this.dataCb = cb;
  }
  onExit(cb: (code: number) => void): void {
    this.exitCb = cb;
  }
  emit(chunk: string): void {
    this.dataCb?.(chunk);
  }
  exit(code: number): void {
    this.exitCb?.(code);
  }
}

let pty: FakePty;
let prompts: AuthPrompt[];
let results: AuthResult[];
let manager: AuthSessionManager;

beforeEach(() => {
  vi.useFakeTimers();
  pty = new FakePty();
  prompts = [];
  results = [];
  manager = new AuthSessionManager({
    spawn: () => pty,
    onPrompt: (p) => prompts.push(p),
    onResult: (r) => results.push(r),
    urlTimeoutMs: 15_000,
    idleTimeoutMs: 300_000,
    hardTimeoutMs: 600_000,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AuthSessionManager", () => {
  it("emits the verification URL when the CLI prints one", () => {
    manager.start("req-1", "grok");
    pty.emit("Open https://auth.x.ai/device?code=WXYZ to continue");

    expect(prompts.at(-1)).toMatchObject({
      requestId: "req-1",
      kind: "url",
      url: "https://auth.x.ai/device?code=WXYZ",
    });
  });

  it("writes a submitted code to the CLI's stdin", () => {
    manager.start("req-1", "grok");
    pty.emit("https://auth.x.ai/device");
    manager.submitCode("req-1", "ABCD-1234");

    expect(pty.written.join("")).toContain("ABCD-1234");
  });

  it("reports success and never exposes a token", () => {
    manager.start("req-1", "grok");
    pty.emit("https://auth.x.ai/device");
    manager.submitCode("req-1", "ABCD-1234");
    pty.emit("Successfully signed in");
    pty.exit(0);

    expect(results.at(-1)).toMatchObject({ requestId: "req-1", ok: true });
    expect(JSON.stringify(results)).not.toContain("ABCD-1234");
  });

  it("reports failure with the CLI's own reason", () => {
    manager.start("req-1", "grok");
    pty.emit("Error: device code expired");
    pty.exit(1);

    expect(results.at(-1)).toMatchObject({ requestId: "req-1", ok: false });
    expect(results.at(-1)?.detail).toMatch(/expired/i);
  });

  it("treats a non-zero exit as failure even with no matched message", () => {
    manager.start("req-1", "grok");
    pty.exit(1);
    expect(results.at(-1)).toMatchObject({ ok: false });
  });

  it("FAILS OPEN: streams the raw tail when no URL is matched in time", () => {
    // The single most important behaviour here. If a CLI rewords its output and
    // the matcher goes stale, the operator must still see what it said — a dead
    // end would send them back to SSH, defeating the entire feature.
    manager.start("req-1", "grok");
    pty.emit("Some unrecognised prompt the matcher has never seen");
    vi.advanceTimersByTime(15_000);

    expect(prompts.at(-1)).toMatchObject({ requestId: "req-1", kind: "raw" });
    expect(prompts.at(-1)?.tail).toContain("unrecognised prompt");
  });

  it("lets a second sign-in supersede the first for the same provider", () => {
    // Changed 2026-08-30. This used to expect a rejection, which locked an
    // operator out: cancel() needs the ORIGINAL requestId and the UI mints a
    // fresh one per click, so an abandoned attempt produced "a login for codex
    // is already in progress" forever with no way to clear it. Clicking Sign
    // in is the operator saying "start over". The one-login-per-provider rule
    // still holds — the old PTY is killed first, so two never race the same
    // credential file. See auth-session-supersede.test.ts.
    manager.start("req-1", "codex");

    expect(manager.start("req-2", "codex").ok).toBe(true);
    // The abandoned request is told it was cancelled so a stale tab stops
    // waiting on a prompt that will never arrive.
    expect(results.some((r) => r.requestId === "req-1" && r.status === "cancelled")).toBe(true);
  });

  it("allows a different provider concurrently", () => {
    expect(manager.start("req-1", "grok").ok).toBe(true);
    expect(manager.start("req-2", "codex").ok).toBe(true);
  });

  it("allows a retry after the first attempt finishes", () => {
    manager.start("req-1", "grok");
    pty.exit(1);
    expect(manager.start("req-2", "grok").ok).toBe(true);
  });

  it("kills the PTY on the hard timeout", () => {
    manager.start("req-1", "grok");
    vi.advanceTimersByTime(600_000);

    expect(pty.killed).toBe(true);
    expect(results.at(-1)).toMatchObject({ ok: false, status: "expired" });
  });

  it("kills the PTY when idle too long", () => {
    manager.start("req-1", "grok");
    pty.emit("https://auth.x.ai/device");
    vi.advanceTimersByTime(300_000);

    expect(pty.killed).toBe(true);
  });

  it("idle timeout resets on activity", () => {
    manager.start("req-1", "grok");
    vi.advanceTimersByTime(200_000);
    pty.emit("still working");
    vi.advanceTimersByTime(200_000);

    expect(pty.killed).toBe(false);
  });

  it("ignores a code submitted for an unknown request", () => {
    expect(manager.submitCode("nope", "ABCD")).toBe(false);
  });

  it("cancels a pending session", () => {
    manager.start("req-1", "grok");
    manager.cancel("req-1");

    expect(pty.killed).toBe(true);
    expect(manager.pending()).toHaveLength(0);
  });

  it("clears everything on shutdown so nothing is left running", () => {
    manager.start("req-1", "grok");
    manager.shutdown();

    expect(pty.killed).toBe(true);
    expect(manager.pending()).toHaveLength(0);
  });

  it("redacts secrets from the raw tail it streams", () => {
    manager.start("req-1", "grok");
    pty.emit("debug token sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    vi.advanceTimersByTime(15_000);

    expect(prompts.at(-1)?.tail).not.toContain("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("reports which providers are pending", () => {
    manager.start("req-1", "grok");
    expect(manager.pending()).toEqual([{ requestId: "req-1", provider: "grok", phase: "awaiting_url" }]);
  });
});
