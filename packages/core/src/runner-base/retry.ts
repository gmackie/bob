import { Duration, Effect, Schedule } from "effect";

/**
 * The gmacko-standard retry policy: exponential backoff starting at 100ms
 * with factor 2.0, jittered, capped at 5 retries. Total worst-case elapsed
 * time before giving up is approximately 100 + 200 + 400 + 800 + 1600 =
 * ~3.1 seconds (or up to ~6s with jitter + clock drift).
 *
 * Used for all server-side calls in @gmacko/runner-base (register,
 * heartbeat, claimWork, reportEvent, unregister) so transient network
 * errors don't break the runtime loop.
 *
 * Composition uses `Schedule.max` (Effect 4.1; formerly `Schedule.both`):
 * it recurs only while every sub-schedule wants to recur and waits the
 * longer of their delays, giving us the cap behavior from
 * `Schedule.recurs(5)`.
 */
export const retrySchedule = Schedule.max([
  Schedule.exponential(Duration.millis(100), 2.0).pipe(Schedule.jittered),
  Schedule.recurs(5),
]);

/**
 * Convenience helper: apply `retrySchedule` to an effect. Returns the effect
 * unchanged in type signature except for the added retry behavior.
 */
export const withRetry = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => Effect.retry(effect, retrySchedule);
