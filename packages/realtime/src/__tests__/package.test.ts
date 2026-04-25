import { describe, expect, it } from "vitest";
import { __gmackoRealtimePhase } from "../index.js";

describe("@gmacko/realtime package sentinel", () => {
  it("exports the 6H phase marker", () => {
    expect(__gmackoRealtimePhase).toBe("6h");
  });
});
