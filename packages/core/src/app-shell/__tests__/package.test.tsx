import { describe, it, expect } from "vitest";
import { __gmackoAppShellPhase } from "@gmacko/core/app-shell";

describe("@gmacko/app-shell package smoke", () => {
  it("resolves via workspace + exports the 6J sentinel", () => {
    expect(__gmackoAppShellPhase).toBe("6j");
  });
});
