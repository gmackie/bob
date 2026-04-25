import { describe, it, expect } from "vitest";
import { __gmackoI18nPhase } from "@gmacko/i18n";

describe("@gmacko/i18n package smoke", () => {
  it("resolves via workspace + exports the 6L sentinel", () => {
    expect(__gmackoI18nPhase).toBe("6l");
  });
});
