import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Stream } from "effect";

import { makeRealtimeChannelTag } from "../../channel.js";
import { layerWsGateway } from "../ws-gateway.js";

interface TestEvent {
  readonly n: number;
}

const TestChannel = makeRealtimeChannelTag<TestEvent>(
  "realtime/ws-gateway-test",
);
const layer = layerWsGateway(TestChannel);

describe("layerWsGateway (stub)", () => {
  it.effect("publish fails with RealtimeBackendNotImplementedError", () =>
    Effect.gen(function* () {
      const ch = yield* TestChannel;
      const result = yield* Effect.exit(ch.publish("any-channel", { n: 1 }));
      expect(Exit.isFailure(result)).toBe(true);
      // Drift note from 6F: `instanceof` doesn't hold across schema decoding.
      // Inspect the failure via Cause.findErrorOption + _tag matching. (In
      // Effect 4 the helper is `findErrorOption`, not `failureOption`.)
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
            const err = failure.value;
            expect(err._tag).toBe("RealtimeBackendNotImplementedError");
            if (err._tag === "RealtimeBackendNotImplementedError") {
              expect(err.backend).toBe("ws-gateway");
            }
          }
        }
      }).pipe(Effect.provide(layer)),
  );
});
