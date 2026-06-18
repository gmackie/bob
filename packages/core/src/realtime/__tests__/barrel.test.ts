// Barrel smoke test (Task 9) — verifies that the `@gmacko/realtime` public
// surface is wired through `src/index.ts` correctly.
//
// Round-trip behaviour for `layerRealtime("memory", ...)` is already covered
// in `layer.test.ts` (Task 6) — keep this file focused on "every documented
// symbol resolves through the barrel" rather than re-exercising backend
// behaviour. If a new symbol is added to the public surface, add a smoke
// assertion here.

import { describe, expect, it } from "vitest";

import {
  __gmackoRealtimePhase,
  RealtimeBackendNotImplementedError,
  RealtimePublishError,
  layerRealtime,
  makeRealtimeChannelTag,
} from "../index.js";

interface Evt {
  readonly n: number;
}

describe("@gmacko/realtime barrel", () => {
  it("exports the 6H phase sentinel", () => {
    expect(__gmackoRealtimePhase).toBe("6h");
  });

  it("re-exports makeRealtimeChannelTag, layerRealtime, and tagged errors", () => {
    // Tag factory is callable and produces a `ServiceMap.Service` tag (a
    // callable / function-shaped value in Effect 4). Identity / `.key`
    // semantics are exercised in `channel.test.ts`; here we only assert the
    // symbol resolves through the barrel.
    expect(typeof makeRealtimeChannelTag).toBe("function");
    const tag = makeRealtimeChannelTag<Evt>("realtime/barrel-smoke");
    expect(tag).toBeDefined();

    // `layerRealtime` is callable through the barrel and yields a Layer.
    // Real behaviour is exercised in `layer.test.ts`.
    expect(typeof layerRealtime).toBe("function");
    const layer = layerRealtime("memory", tag);
    expect(layer).toBeDefined();

    // Tagged errors construct + carry their `_tag` discriminants.
    const pubErr = new RealtimePublishError({ channel: "ch", reason: "test" });
    expect(pubErr._tag).toBe("RealtimePublishError");

    const beErr = new RealtimeBackendNotImplementedError({
      backend: "redis",
      reason: "test",
    });
    expect(beErr._tag).toBe("RealtimeBackendNotImplementedError");
  });
});
