import { describe, it, expect } from "vitest";
import { __gmackoEmailPhase } from "@gmacko/core/email";

describe("@gmacko/email package smoke", () => {
  it("resolves via workspace + exports the 6L sentinel", () => {
    expect(__gmackoEmailPhase).toBe("6l");
  });
});
