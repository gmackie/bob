/** The slice of ChildProcess this needs — keeps it testable without a real spawn. */
interface KillableChild {
  pid?: number;
  kill(signal: NodeJS.Signals): unknown;
}

interface KillDeps {
  kill: (pid: number, signal: NodeJS.Signals) => unknown;
}

/**
 * Signals an agent process and everything it started.
 *
 * `child.kill()` reaches only the direct child — the claude/codex CLI. Anything
 * that CLI spawned (`pnpm run lint` → `turbo run lint` → `eslint`) survived it,
 * and on a long-lived daemon those orphans accumulate: hetzner-bob collected 45
 * of them under ~/.bob/worktrees, several 7+ days old, until load average hit
 * 42 and the node fell out of the fleet.
 *
 * Signalling the negative pid delivers to the whole process group, which is why
 * the spawn side must set `detached: true` — without its own group, a negative
 * pid would signal the daemon's group and take the daemon down with it.
 *
 * Never throws: callers include shutdown, which iterates every active session,
 * and one already-dead session must not abort cleanup of the rest.
 */
export function killProcessTree(
  child: KillableChild,
  signal: NodeJS.Signals,
  // Wrapped rather than passed bare: `process.kill` detached from `process`
  // loses its `this`, which is what unbound-method flags.
  deps: KillDeps = { kill: (pid, sig) => process.kill(pid, sig) },
): void {
  if (!child.pid) return;

  try {
    deps.kill(-child.pid, signal);
    return;
  } catch {
    // The group is gone, or we may not signal it. Fall through to the child
    // handle, which is still worth a try.
  }

  try {
    child.kill(signal);
  } catch {
    // Nothing left to kill.
  }
}
