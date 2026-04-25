import { describe, expect, it } from "vitest";
import {
  RealtimeBackendNotImplementedError,
  RealtimePublishError,
  makeRealtimeChannelTag,
  type RealtimeChannelShape,
} from "../channel.js";

describe("@gmacko/realtime tagged errors", () => {
  it("construct and carry their fields under the right _tag", () => {
    const pub = new RealtimePublishError({
      channel: "tenant-x:agent:conv-1",
      reason: "queue full",
    });
    expect(pub._tag).toBe("RealtimePublishError");
    expect(pub.channel).toBe("tenant-x:agent:conv-1");
    expect(pub.reason).toBe("queue full");

    const notImpl = new RealtimeBackendNotImplementedError({
      backend: "redis",
      reason: "deferred",
    });
    expect(notImpl._tag).toBe("RealtimeBackendNotImplementedError");
    expect(notImpl.backend).toBe("redis");
    expect(notImpl.reason).toBe("deferred");
  });
});

describe("@gmacko/realtime makeRealtimeChannelTag", () => {
  it("returns a usable ServiceMap.Service tag whose key includes the name", () => {
    interface TestEvent {
      readonly count: number;
    }
    const TestCh = makeRealtimeChannelTag<TestEvent>("TestCh");
    // ServiceMap.Service exposes the identifier as `.key` (Effect 4) — the
    // string we passed at construction. Keep this assertion loose enough to
    // tolerate either `.key` or `.toString()` carrying the name.
    const repr =
      (TestCh as unknown as { key?: string }).key ?? String(TestCh);
    expect(repr).toContain("TestCh");

    // Type-level check: shape generic is preserved. This is a pure type
    // assertion — `_shape` is never read at runtime.
    const _shape: RealtimeChannelShape<TestEvent> | undefined = undefined;
    void _shape;
  });
});
