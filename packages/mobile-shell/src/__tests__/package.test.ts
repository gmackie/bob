import { describe, it, expect } from "vitest";
import { __gmackoMobileShellPhase } from "@gmacko/mobile-shell";

describe("@gmacko/mobile-shell package smoke", () => {
  it("resolves via workspace + exports the 6L sentinel", () => {
    expect(__gmackoMobileShellPhase).toBe("6l");
  });
});
