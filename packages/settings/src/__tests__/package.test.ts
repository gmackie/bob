import { describe, it, expect } from "vitest";
import { __gmackoSettingsPhase } from "@gmacko/settings";

describe("@gmacko/settings package smoke", () => {
  it("resolves via workspace + exports the 6L sentinel", () => {
    expect(__gmackoSettingsPhase).toBe("6l");
  });
});
