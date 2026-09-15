import { describe, expect, it } from "vitest";
import { readDispatchTrace } from "../trace-dispatch";

describe("durable dispatch trace", () => {
  it("survives queue serialization while retaining existing persona metadata", () => {
    const carrier = {
      traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
    };
    const persona = {
      autonomyLevel: "full",
      metadata: { ooda: { id: "source" }, traceCarrier: carrier },
    };
    const restored = JSON.parse(JSON.stringify(persona));
    expect(readDispatchTrace(restored)).toEqual(carrier);
    expect(restored.metadata.ooda).toEqual({ id: "source" });
    expect(
      readDispatchTrace({
        metadata: { traceCarrier: { traceparent: "secret" } },
      }),
    ).toBeUndefined();
  });
});
