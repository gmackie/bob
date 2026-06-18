// Memory backend (Task 3) — verifies PubSub-backed in-process fan-out.
//
// Test patterns and rationale:
// - We use `it.effect` for clean Effect-test ergonomics. Tests that require
//   wall-clock timing (e.g. Effect.timeout) work fine under TestClock as long
//   as we're racing a fast publish against a finite timeout — the subscriber's
//   take wins immediately when an event is published, and the timeout branch
//   only fires when no event ever arrives, in which case TestClock's frozen
//   time means we'd hang. To avoid that, the "no event" tests use `it.live`
//   so timeouts actually elapse.
// - PubSub.subscribe is a scoped Effect — once the yield* completes, the
//   subscription is registered with the underlying PubSub, so a subsequent
//   publish is guaranteed to be delivered. This eliminates the subscribe/
//   publish race and removes the need for a sync primitive (Latch/sleep).
// - Test 5 doesn't try to introspect the underlying Subscription (private).
//   Instead it asserts the cross-scope invariant: closing a subscriber's
//   scope and re-subscribing on the same channel still works, which proves
//   the PubSub map in `layerMemory`'s closure outlives individual subscribe
//   scopes.

import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Fiber, Option, Stream } from "effect";

import { makeRealtimeChannelTag } from "../../channel.js";
import { layerMemory } from "../memory.js";

interface TestEvent {
  readonly n: number;
}

const TestChannel = makeRealtimeChannelTag<TestEvent>("realtime/memory-test");
const layer = layerMemory(TestChannel);

describe("layerMemory", () => {
  it.effect("subscriber on same channel sees published event", () =>
    Effect.gen(function* () {
      const ch = yield* TestChannel;
      // Subscribe FIRST. PubSub.subscribe is scoped — once `yield*` returns,
      // the subscription is registered, so the subsequent publish is
      // guaranteed to be delivered.
      const stream = yield* ch.subscribe("ch-1");
      // Fork the consumer so we can publish from the test fiber.
      const fiber = yield* Effect.forkChild(Stream.runHead(stream));
      yield* ch.publish("ch-1", { n: 1 });
      const result = yield* Fiber.join(fiber);
      expect(Option.isSome(result)).toBe(true);
      if (Option.isSome(result)) {
        expect(result.value).toEqual({ n: 1 });
      }
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("two subscribers on same channel both see published event", () =>
    Effect.gen(function* () {
      const ch = yield* TestChannel;
      const streamA = yield* ch.subscribe("ch-fan");
      const streamB = yield* ch.subscribe("ch-fan");
      const fiberA = yield* Effect.forkChild(Stream.runHead(streamA));
      const fiberB = yield* Effect.forkChild(Stream.runHead(streamB));
      yield* ch.publish("ch-fan", { n: 42 });
      const resA = yield* Fiber.join(fiberA);
      const resB = yield* Fiber.join(fiberB);
      expect(Option.isSome(resA)).toBe(true);
      expect(Option.isSome(resB)).toBe(true);
      if (Option.isSome(resA)) expect(resA.value).toEqual({ n: 42 });
      if (Option.isSome(resB)) expect(resB.value).toEqual({ n: 42 });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.live("subscribers on different channels are isolated", () =>
    Effect.gen(function* () {
      const ch = yield* TestChannel;
      // Subscribe to ch-a; publish to ch-b. The ch-a subscriber must NOT
      // receive the ch-b event. Use a 100ms timeout — if the subscriber
      // takes longer than that, treat as "didn't receive".
      const streamA = yield* ch.subscribe("ch-a");
      const fiberA = yield* Effect.forkChild(
        Stream.runHead(streamA).pipe(
          Effect.timeoutOption("100 millis"),
        ),
      );
      yield* ch.publish("ch-b", { n: 99 });
      const result = yield* Fiber.join(fiberA);
      // Outer Option (timeout) should be None — the take never resolved.
      expect(Option.isNone(result)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.live("events published before subscribe are NOT replayed", () =>
    Effect.gen(function* () {
      const ch = yield* TestChannel;
      // Publish FIRST. Without an active subscription, the event is dropped
      // by PubSub.unbounded (no replay buffer configured).
      yield* ch.publish("ch-late", { n: 7 });
      // Subscribe AFTER. The take should hang indefinitely — a 100ms
      // timeout is the way we observe "no event arrived".
      const stream = yield* ch.subscribe("ch-late");
      const result = yield* Stream.runHead(stream).pipe(
        Effect.timeoutOption("100 millis"),
      );
      expect(Option.isNone(result)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect(
    "PubSub state persists across subscribe scope close (re-subscribe works)",
    () =>
      Effect.gen(function* () {
        const ch = yield* TestChannel;
        // First subscribe + scope close. We use Effect.scoped to bound the
        // first subscription's lifetime. Then we subscribe again outside
        // that scope and verify delivery still works — proving the
        // underlying PubSub (in layerMemory's closure) outlived scope close.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const stream = yield* ch.subscribe("ch-rs");
            // Just verify subscribe returned a stream — don't consume.
            // When this Effect.scoped exits, the Subscription is released.
            void stream;
          }),
        );
        // Now subscribe again on the same channel — should work fresh.
        const stream2 = yield* ch.subscribe("ch-rs");
        const fiber = yield* Effect.forkChild(Stream.runHead(stream2));
        yield* ch.publish("ch-rs", { n: 2 });
        const result = yield* Fiber.join(fiber);
        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value).toEqual({ n: 2 });
        }
      }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});
