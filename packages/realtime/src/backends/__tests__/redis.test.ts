import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Stream } from "effect";

import { makeRealtimeChannelTag } from "../../channel.js";
import { layerRedis } from "../redis.js";

interface TestEvent {
  readonly n: number;
}

const TestChannel = makeRealtimeChannelTag<TestEvent>("realtime/redis-test");
const layer = layerRedis(TestChannel);

describe("layerRedis (stub)", () => {
  it.effect("publish fails with RealtimeBackendNotImplementedError", () =>
    Effect.gen(function* () {
      const ch = yield* TestChannel;
      const result = yield* Effect.exit(ch.publish("any-channel", { n: 1 }));
      expect(Exit.isFailure(result)).toBe(true);
      // Drift note from 6F: `instanceof` doesn't hold across schema decoding.
      // Inspect the failure via Cause.findErrorOption + _tag matching instead.
      // Effect 4.0 dropped `Cause.failureOption` (was Effect 3.x); the
      // replacement is `Cause.findErrorOption` returning `Option<E>`.
      if (Exit.isFailure(result)) {
        const failure = Cause.findErrorOption(result.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          const err = failure.value;
          expect(err._tag).toBe("RealtimeBackendNotImplementedError");
          if (err._tag === "RealtimeBackendNotImplementedError") {
            expect(err.backend).toBe("redis");
          }
        }
      }
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "subscribe stream first pull fails with RealtimeBackendNotImplementedError",
    () =>
      Effect.gen(function* () {
        const ch = yield* TestChannel;
        const stream = yield* Effect.scoped(ch.subscribe("any-channel"));
        const result = yield* Effect.exit(Stream.runHead(stream));
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const failure = Cause.findErrorOption(result.cause);
          expect(failure._tag).toBe("Some");
          if (failure._tag === "Some") {
            expect(failure.value._tag).toBe(
              "RealtimeBackendNotImplementedError",
            );
            expect(failure.value.backend).toBe("redis");
          }
        }
      }).pipe(Effect.provide(layer)),
  );
});
