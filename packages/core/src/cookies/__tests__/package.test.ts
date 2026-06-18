import { describe, it, expect } from "vitest";
import { __gmackoCookiesPhase } from "@gmacko/core/cookies";

describe("@gmacko/cookies package smoke", () => {
  it("resolves via workspace + exports the 6L sentinel", () => {
    expect(__gmackoCookiesPhase).toBe("6l");
  });
});
