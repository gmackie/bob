/**
 * Daily-budget pacing (pure).
 *
 * A flat daily cap is a kill switch: once the N-th run starts, dispatch goes
 * dark until midnight UTC (on 2026-08-21 the cap was hit at 11:20 and nothing
 * moved for 12 hours while 80 items sat in todo). Pacing spends the same cap
 * as a RATE across the day instead: at any moment the allowance is the
 * pro-rata share of the cap for the elapsed fraction of the day, plus a
 * burst so a quiet stretch doesn't stall the next tick. Unused share carries
 * forward within the day (the allowance is cumulative), the cap itself is
 * still the hard ceiling, and the pipe narrows instead of shutting.
 */
export interface PacingInput {
  dailyCap: number;
  executeToday: number;
  /** Minutes since 00:00 UTC. */
  minuteOfDay: number;
  /** Extra runs allowed above the pro-rata line (default = concurrency). */
  burst: number;
}

export interface PacingVerdict {
  /** Runs that may start this tick under pacing (before slot limits). */
  allowance: number;
  /** Pro-rata share of the cap earned so far today (without burst). */
  earned: number;
  /** True when pacing (not the hard cap or slots) is what limits this tick. */
  pacingBinds: boolean;
}

export function paceDailyBudget(i: PacingInput): PacingVerdict {
  const cap = Math.max(0, i.dailyCap);
  const frac = Math.min(1, Math.max(0, i.minuteOfDay / 1440));
  const earned = Math.min(cap, Math.ceil(cap * frac));
  const hardRemaining = Math.max(0, cap - i.executeToday);
  const paced = Math.max(0, earned + Math.max(0, i.burst) - i.executeToday);
  const allowance = Math.min(hardRemaining, paced);
  return { allowance, earned, pacingBinds: allowance < hardRemaining };
}
