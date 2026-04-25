import { describe, it, expect } from "vitest";
import { __gmackoMonitoringPhase } from "@gmacko/monitoring";

describe("@gmacko/monitoring package smoke", () => {
  it("resolves via workspace + exports the 6L sentinel", () => {
    expect(__gmackoMonitoringPhase).toBe("6l");
  });
});
