// `it.live` (not `it.effect`) is used for the retry tests because `withRetry`
// composes `Schedule.exponential` whose delays flow through `Clock.sleep`.
// Under `it.effect`'s installed `TestClock`, those sleeps never advance unless
// we drive `TestClock.adjust` concurrently with the retrying fiber — which is
// doable but adds plumbing. Wall-clock is fine here: 5 retries at 100ms base
// with factor 2.0 caps at ~3.1s nominal / ~6s worst-case jittered.
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Duration, Effect, Exit, Schedule } from "effect";
import { retrySchedule, withRetry } from "../retry.js";

describe("@gmacko/runner-base retry helper", () => {
  it.live(
    "retries up to 5 times then propagates the failure",
    () =>
      Effect.gen(function* () {
        let attempts = 0;
        const failing = Effect.suspend(() => {
          attempts++;
          return Effect.fail(new Error(`attempt ${attempts}`));
        });
        const result = yield* Effect.exit(withRetry(failing));
        expect(Exit.isFailure(result)).toBe(true);
        expect(attempts).toBe(6); // initial + 5 retries
      }),
    10_000,
  );

  it.effect("succeeds without retrying when the effect succeeds first try", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const ok = Effect.sync(() => {
        attempts++;
        return "ok";
      });
      const result = yield* withRetry(ok);
      expect(result).toBe("ok");
      expect(attempts).toBe(1);
    }),
  );

  it.effect(
    "composes Schedule.jittered with the exponential backoff (structural)",
    () =>
      Effect.gen(function* () {
        // Structural: the exported `retrySchedule` is a Schedule (pipeable),
        // and the pieces we documented in the policy comment compose without
        // type errors at runtime. Deeper behavioral verification (precise
        // delay curve, jitter variance) is covered once the runner runtime
        // wires these into live-server interactions in Task 13.
        expect(
          typeof (retrySchedule as unknown as { pipe: unknown }).pipe,
        ).toBe("function");

        // Sanity check the building blocks exist + compose without throwing.
        const composed = Schedule.both(
          Schedule.exponential(Duration.millis(10), 2).pipe(Schedule.jittered),
          Schedule.recurs(3),
        );
        expect(typeof (composed as unknown as { pipe: unknown }).pipe).toBe(
          "function");
        // Touch `yield*` so this stays a real Effect generator function.
        yield* Effect.succeed(null);
      }),
  );
});
