import { describe, it, expect } from "vitest";
import { __gmackoAuthPhase } from "@gmacko/auth";

describe("@gmacko/auth package smoke", () => {
  it("resolves via workspace + exports the 6C sentinel", () => {
    expect(__gmackoAuthPhase).toBe("6c");
  });
});
