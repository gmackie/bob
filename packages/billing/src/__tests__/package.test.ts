import { describe, it, expect } from "vitest";
import { __gmackoBillingPhase } from "@gmacko/billing";

describe("@gmacko/billing package smoke", () => {
  it("resolves via workspace + exports the 6L sentinel", () => {
    expect(__gmackoBillingPhase).toBe("6l");
  });
});
