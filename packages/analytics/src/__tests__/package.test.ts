import { describe, it, expect } from "vitest";
import { __gmackoAnalyticsPhase } from "@gmacko/analytics";

describe("@gmacko/analytics package smoke", () => {
  it("resolves via workspace + exports the 6L sentinel", () => {
    expect(__gmackoAnalyticsPhase).toBe("6l");
  });
});
