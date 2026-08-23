import { describe, expect, it } from "vitest";

import { DEFAULT_QUEUE_ORDER, queueOrderForPriority } from "../priority";

describe("queueOrderForPriority", () => {
  it("orders urgent before high before medium", () => {
    expect(queueOrderForPriority(1)).toBeLessThan(queueOrderForPriority(2));
    expect(queueOrderForPriority(2)).toBeLessThan(queueOrderForPriority(3));
  });

  it("treats priority 0 as UNSET, not highest — it must not outrank urgent", () => {
    expect(queueOrderForPriority(0)).toBeGreaterThan(queueOrderForPriority(1));
    expect(queueOrderForPriority(0)).toBe(DEFAULT_QUEUE_ORDER);
  });

  it("puts unset in the normal lane: after medium, before low", () => {
    expect(queueOrderForPriority(3)).toBeLessThan(queueOrderForPriority(0));
    expect(queueOrderForPriority(0)).toBeLessThan(queueOrderForPriority(4));
  });

  it("falls back to the default lane for missing or nonsense values", () => {
    const weird: (number | null | undefined)[] = [null, undefined, NaN, 9, -1];
    for (const v of weird) {
      expect(queueOrderForPriority(v)).toBe(DEFAULT_QUEUE_ORDER);
    }
  });

  it("is stable for float inputs from the API", () => {
    expect(queueOrderForPriority(1.0)).toBe(queueOrderForPriority(1));
  });
});
