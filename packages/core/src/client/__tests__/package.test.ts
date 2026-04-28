import { describe, it, expect } from "vitest";
import { __gmackoClientPhase } from "@gmacko/core/client";

describe("@gmacko/client package smoke", () => {
  it("resolves via workspace + exports the 6F sentinel", () => {
    expect(__gmackoClientPhase).toBe("6f");
  });
});
