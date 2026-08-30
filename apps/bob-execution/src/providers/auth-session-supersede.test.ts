/**
 * A stale login must never lock an operator out of a provider.
 *
 * `start()` refused when any session existed for the provider — one login per
 * provider, so two PTYs cannot race for the same credential file. That guard
 * is right, but it had no way out: `cancel()` needs the ORIGINAL requestId,
 * and the UI mints a fresh one per click. So an abandoned attempt (page
 * reloaded, browser closed, daemon still holding the session) produced
 *
 *     codex sign-in failed: a login for codex is already in progress
 *
 * forever, with no control anywhere to clear it — reported from production on
 * 2026-08-30, on the very flow this feature exists to provide.
 *
 * Clicking "Sign in" IS the operator saying "start over". So a new start
 * supersedes the old session rather than refusing.
 */
import { describe, expect, it, vi } from "vitest";

import { AuthSessionManager } from "./auth-session.js";
import type { AuthPty } from "./auth-driver.js";

function makeManager() {
  const killed: string[] = [];
  const spawned: string[] = [];
  const results: { requestId: string; status: string }[] = [];

  const manager = new AuthSessionManager({
    spawn: (driver): AuthPty => {
      spawned.push(driver.command);
      return {
        write: () => undefined,
        kill: () => killed.push(driver.command),
        onData: () => undefined,
        onExit: () => undefined,
      };
    },
    onPrompt: () => undefined,
    onResult: (r) => results.push({ requestId: r.requestId, status: r.status }),
  });

  return { manager, killed, spawned, results };
}

describe("AuthSessionManager supersede", () => {
  it("lets a second sign-in take over from an abandoned one", () => {
    const { manager, spawned } = makeManager();

    expect(manager.start("req-1", "codex").ok).toBe(true);
    // The operator gave up, reloaded, and clicked Sign in again.
    expect(manager.start("req-2", "codex").ok).toBe(true);
    expect(spawned).toHaveLength(2);

    manager.shutdown();
  });

  it("kills the superseded process so two PTYs never race the credential file", () => {
    const { manager, killed } = makeManager();

    manager.start("req-1", "codex");
    manager.start("req-2", "codex");

    expect(killed).toHaveLength(1);
    manager.shutdown();
  });

  it("tells the abandoned request it was cancelled, so a stale tab stops waiting", () => {
    const { manager, results } = makeManager();

    manager.start("req-1", "codex");
    manager.start("req-2", "codex");

    expect(results).toContainEqual({ requestId: "req-1", status: "cancelled" });
    manager.shutdown();
  });

  it("leaves a different provider's login running", () => {
    // Superseding must be scoped to the provider being signed into.
    const { manager, killed } = makeManager();

    manager.start("req-1", "claude");
    manager.start("req-2", "codex");

    expect(killed).toHaveLength(0);
    manager.shutdown();
  });

  it("still rejects a genuinely duplicate request id", () => {
    const { manager } = makeManager();

    manager.start("req-1", "codex");
    expect(manager.start("req-1", "codex")).toMatchObject({ ok: false });

    manager.shutdown();
  });
});
