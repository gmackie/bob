import { describe, it, expect } from "vitest";
import { __gmackoDesktopShellPhase } from "@gmacko/desktop-shell";

describe("@gmacko/desktop-shell package smoke", () => {
  it("resolves via workspace + exports the 6L sentinel", () => {
    expect(__gmackoDesktopShellPhase).toBe("6l");
  });
});
