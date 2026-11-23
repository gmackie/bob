/**
 * Work items that claim to be in progress with nothing behind them.
 *
 * `reapStuckSessions` releases an item through its session, which covers a run
 * that started and died. It cannot see the other two shapes, because there is
 * no session to find:
 *
 *   - claimed but never dispatched — 275 production items had no run at all
 *   - run ended, item never moved — 167 more, all runs terminal
 *
 * Together those were 454 items reading "In Progress" while zero runs were
 * live anywhere in the workspace, the oldest untouched for a month. A status
 * nothing ever retracts is a claim, not a state.
 *
 * The decision is deliberately separated from the query so the policy can be
 * tested without a database, and so it stays conservative: an item is only
 * orphaned when nothing is running AND it has been quiet for a long time.
 */

export interface OrphanedClaimInput {
  status: string;
  /** A session in an active status still holds this item. */
  hasActiveSession: boolean;
  /** A run that has not reached a terminal status. */
  hasActiveRun: boolean;
  /** Whether any run was ever recorded against the item. */
  hasAnyRun: boolean;
  /** Milliseconds since the item was last touched. */
  idleMs: number;
  /** How long an item may sit untouched before it counts as abandoned. */
  thresholdMs: number;
}

export type OrphanedClaimOutcome =
  | { release: false }
  | { release: true; to: "todo"; reason: string };

export function resolveOrphanedClaim(
  input: OrphanedClaimInput,
): OrphanedClaimOutcome {
  if (input.status !== "in_progress") return { release: false };
  // Anything live is someone else's business: the session reaper owns those.
  if (input.hasActiveSession || input.hasActiveRun) return { release: false };
  if (input.idleMs < input.thresholdMs) return { release: false };

  return {
    release: true,
    to: "todo",
    reason: input.hasAnyRun
      ? "every run ended and the item was never reconciled"
      : "claimed but never dispatched — no run was ever recorded",
  };
}

/**
 * Whether the cron sweep runs, and whether it may write.
 *
 *   - "off" (default): the sweep is skipped entirely. Unset, empty or any
 *     unrecognised value means off, so a typo can never turn it on.
 *   - "dry-run": the sweep runs the same query and policy, then only logs how
 *     many items it would release and which ones. Nothing is written.
 *   - "on": released items go back to `todo`, where autoDrain picks them up
 *     and runs them again on the next tick.
 *
 * Set with the `BOB_ORPHAN_RECONCILE_MODE` var (apps/bob/wrangler.jsonc). It
 * is off by default because turning it on requeues every stale claim at once
 * (454 items when this was written), and Bob runs what is in todo.
 */
export type OrphanReconcileMode = "off" | "dry-run" | "on";

export function resolveOrphanReconcileMode(raw: unknown): OrphanReconcileMode {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "on") return "on";
  if (value === "dry-run" || value === "dryrun") return "dry-run";
  return "off";
}

export interface OrphanSweepResult {
  released: number;
  items: { id: string; reason: string }[];
  dryRun: boolean;
}

export type OrphanSweepFn = (opts: {
  idleMs?: number;
  limit?: number;
  dryRun?: boolean;
}) => Promise<OrphanSweepResult>;

export interface OrphanSweepEnv {
  BOB_ORPHAN_RECONCILE_MODE?: unknown;
  BOB_ORPHAN_RECONCILE_IDLE_MS?: unknown;
  BOB_ORPHAN_RECONCILE_LIMIT?: unknown;
}

function optionalNumber(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * The cron entry point. `loadSweep` is only called when the mode is not off,
 * so with the default configuration this does no database work at all.
 */
export async function runOrphanReconcileSweep(
  env: OrphanSweepEnv,
  loadSweep: () => Promise<OrphanSweepFn>,
  log: (line: string) => void = console.log,
): Promise<{ mode: OrphanReconcileMode; result?: OrphanSweepResult }> {
  const mode = resolveOrphanReconcileMode(env.BOB_ORPHAN_RECONCILE_MODE);
  if (mode === "off") return { mode };

  const sweep = await loadSweep();
  const result = await sweep({
    idleMs: optionalNumber(env.BOB_ORPHAN_RECONCILE_IDLE_MS),
    limit: optionalNumber(env.BOB_ORPHAN_RECONCILE_LIMIT),
    dryRun: mode === "dry-run",
  });

  if (mode === "dry-run") {
    // Log every tick in dry-run, including zero, so an operator can read the
    // count before switching it on. The count is capped by the per-sweep limit.
    log(
      `[orphan-reconcile] dry-run: would release ${result.released} item(s)` +
        (result.items.length
          ? `: ${result.items.map((i) => `${i.id}(${i.reason})`).join(", ")}`
          : ""),
    );
  } else if (result.released > 0) {
    log(
      `[orphan-reconcile] released=${result.released} items=${result.items
        .map((i) => i.id.slice(0, 8))
        .join(",")}`,
    );
  }
  return { mode, result };
}
