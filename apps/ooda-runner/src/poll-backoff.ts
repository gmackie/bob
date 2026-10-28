/**
 * Idle backoff for the runner's work poll (BOB-60).
 *
 * The poll used to run on a fixed 2s interval, idle or not: about 43k
 * listSessionsByRunner calls plus 36k jobs.claim calls a day per runner, every
 * one a Worker invocation and a Hyperdrive query against ooda-blder-bot.
 *
 * The delay stays at `activeMs` while work is visible or was seen within
 * `graceMs`, then doubles each idle tick up to `idleMaxMs`. Any activity resets
 * it to `activeMs` on the next tick. With the defaults an idle runner polls at
 * 2s for the first minute, then 4s, 8s, 16s, and 20s from then on, so work
 * arriving on an idle runner waits at most `idleMaxMs` plus one request.
 */
export const POLL_ACTIVE_INTERVAL_MS = 2_000;
export const POLL_ACTIVE_GRACE_MS = 60_000;
export const POLL_IDLE_MAX_INTERVAL_MS = 20_000;

export class PollBackoff {
  private lastActivityAt: number;
  private idleTicks = 0;

  constructor(
    private readonly options: {
      activeMs?: number;
      graceMs?: number;
      idleMaxMs?: number;
      now?: number;
    } = {},
  ) {
    this.lastActivityAt = options.now ?? Date.now();
  }

  private get activeMs(): number {
    return this.options.activeMs ?? POLL_ACTIVE_INTERVAL_MS;
  }

  private get idleMaxMs(): number {
    return Math.max(
      this.activeMs,
      this.options.idleMaxMs ?? POLL_IDLE_MAX_INTERVAL_MS,
    );
  }

  /** Record that work was seen, so the next delay is the active interval. */
  recordActivity(now: number = Date.now()): void {
    this.lastActivityAt = now;
    this.idleTicks = 0;
  }

  /** Delay before the next poll, given whether the tick that just ran saw work. */
  next(active: boolean, now: number = Date.now()): number {
    if (active) this.recordActivity(now);
    const graceMs = this.options.graceMs ?? POLL_ACTIVE_GRACE_MS;
    if (now - this.lastActivityAt < graceMs) return this.activeMs;
    this.idleTicks += 1;
    // Cap the exponent: past ~2^10 the ceiling has long since been reached.
    const factor = 2 ** Math.min(this.idleTicks, 10);
    return Math.min(this.idleMaxMs, this.activeMs * factor);
  }
}
