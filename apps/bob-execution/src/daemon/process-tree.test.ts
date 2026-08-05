import { describe, expect, it, vi } from "vitest";
import { killProcessTree } from "./process-tree";

/**
 * Killing an agent session sent SIGTERM to the direct child only — the
 * claude/codex CLI. Everything that CLI had started (`pnpm run lint` →
 * `turbo run lint` → `eslint`) lived on as orphans.
 *
 * On hetzner-bob that left 45 processes under ~/.bob/worktrees older than a
 * day, several of them 7+ days, burning 258% CPU between them. Load average
 * hit 42, swap filled to 5G of 8G, and the node dropped out of the fleet
 * entirely because its agent could not get scheduled to heartbeat.
 *
 * The 30-minute safety timeout was firing correctly the whole time. It just
 * killed one process out of a tree.
 */
describe("killProcessTree", () => {
  it("signals the whole process group, not just the child", () => {
    const kill = vi.fn();
    const child = { pid: 4242, kill: vi.fn() };

    killProcessTree(child, "SIGTERM", { kill });

    // Negative pid = the process group led by that pid.
    expect(kill).toHaveBeenCalledWith(-4242, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("falls back to the child when the group is already gone", () => {
    // ESRCH means nothing in that group is left; the child handle may still
    // be worth signalling, and it must not throw either way.
    const kill = vi.fn(() => {
      const err = new Error("no such process") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
    const child = { pid: 4242, kill: vi.fn() };

    expect(() => killProcessTree(child, "SIGKILL", { kill })).not.toThrow();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("does nothing when the child never got a pid", () => {
    const kill = vi.fn();
    const child = { pid: undefined, kill: vi.fn() };

    killProcessTree(child, "SIGTERM", { kill });

    expect(kill).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("never lets a kill failure escape", () => {
    // Shutdown iterates every active session; one dead session must not stop
    // the rest from being cleaned up.
    const kill = vi.fn(() => {
      throw new Error("EPERM");
    });
    const child = {
      pid: 4242,
      kill: vi.fn(() => {
        throw new Error("EPERM");
      }),
    };

    expect(() => killProcessTree(child, "SIGTERM", { kill })).not.toThrow();
  });
});
