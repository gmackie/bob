/**
 * Dispatch-starvation detector (pure).
 *
 * "Starved" means: there IS dispatchable work, the dispatcher is NOT
 * legitimately throttled (daily cap reached, or every slot busy), and yet no
 * execute run has started for a long time. Every outage on 2026-08-21 looked
 * exactly like this from the outside (EROFS worktrees, dead git token,
 * permission-parked agents, sessions stuck pending) while the cron counters
 * read as healthy. Throttled-but-quiet is NOT starvation and must not page.
 */
export interface StarvationInput {
  dispatchable: number;
  /** Execute runs started today (the value the daily cap is measured against). */
  executeToday: number;
  dailyCap: number;
  activeSessions: number;
  concurrency: number;
  /** ms since the most recent execute run started; Infinity if none today. */
  msSinceLastExecute: number;
  windowMs: number;
  /** Runs pacing would allow right now (undefined = pacing off). */
  pacedAllowance?: number;
}

export interface StarvationVerdict {
  starved: boolean;
  reason: "no_work" | "cap_reached" | "paced" | "slots_busy" | "recent_dispatch" | "starved";
}

export function detectStarvation(i: StarvationInput): StarvationVerdict {
  if (i.dispatchable <= 0) return { starved: false, reason: "no_work" };
  if (i.executeToday >= i.dailyCap) return { starved: false, reason: "cap_reached" };
  if (i.pacedAllowance !== undefined && i.pacedAllowance <= 0) return { starved: false, reason: "paced" };
  if (i.activeSessions >= i.concurrency) return { starved: false, reason: "slots_busy" };
  if (i.msSinceLastExecute < i.windowMs) return { starved: false, reason: "recent_dispatch" };
  return { starved: true, reason: "starved" };
}
