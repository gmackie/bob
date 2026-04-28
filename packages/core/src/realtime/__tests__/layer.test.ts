// `layerRealtime` factory (Task 6) — verifies the backend literal selects the
// correct underlying Layer.
//
// Tag identity matters: each test's outer layer is built with a tag declared
// at the `describe` top level (NOT inside the `Effect.gen`), so the layer's
// `Layer.effect(tag)(...)` / `Layer.succeed(tag, ...)` registration and the
// inside-gen `yield* tag` lookup hit the same tag instance. Building the tag
// twice (once for the layer, once inside the gen) would produce two distinct
// service identities and the runtime would fail to find the service.
//
// We use distinct tag names per test (`realtime/factory-mem`,
// `realtime/factory-redis`, `realtime/factory-ws`) to keep the three
// runtimes isolated from each other.

import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Option, Stream } from "effect";

import { makeRealtimeChannelTag } from "../channel.js";
import { layerRealtime } from "../layer.js";

interface Evt {
  readonly n: number;
}

const MemTag = makeRealtimeChannelTag<Evt>("realtime/factory-mem");
const RedisTag = makeRealtimeChannelTag<Evt>("realtime/factory-redis");
const WsTag = makeRealtimeChannelTag<Evt>("realtime/factory-ws");

describe("layerRealtime backend selection", () => {
  it.effect(
    '"memory" produces a working Layer (publish + subscribe round-trip)',
    () =>
      Effect.gen(function* () {
        const ch = yield* MemTag;
        const stream = yield* ch.subscribe("ch");
        const fiber = yield* Effect.forkChild(Stream.runHead(stream));
        yield* ch.publish("ch", { n: 7 });
        const result = yield* Fiber.join(fiber);
        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value).toEqual({ n: 7 });
        }
      }).pipe(Effect.scoped, Effect.provide(layerRealtime("memory", MemTag))),
  );

  it.effect(
    '"redis" — publish fails with RealtimeBackendNotImplementedError',
    () =>
      Effect.gen(function* () {
        const ch = yield* RedisTag;
        const result = yield* Effect.exit(ch.publish("any-channel", { n: 1 }));
        expect(Exit.isFailure(result)).toBe(true);
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
      }).pipe(Effect.provide(layerRealtime("redis", RedisTag))),
  );

  it.effect(
    '"ws-gateway" — publish fails with RealtimeBackendNotImplementedError',
    () =>
      Effect.gen(function* () {
        const ch = yield* WsTag;
        const result = yield* Effect.exit(ch.publish("any-channel", { n: 1 }));
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const failure = Cause.findErrorOption(result.cause);
          expect(failure._tag).toBe("Some");
          if (failure._tag === "Some") {
            const err = failure.value;
            expect(err._tag).toBe("RealtimeBackendNotImplementedError");
            if (err._tag === "RealtimeBackendNotImplementedError") {
              expect(err.backend).toBe("ws-gateway");
            }
          }
        }
      }).pipe(Effect.provide(layerRealtime("ws-gateway", WsTag))),
  );
});
