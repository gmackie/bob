import { describe, it, expect } from "vitest";
import { __gmackoStoragePhase } from "@gmacko/storage";

describe("@gmacko/storage package smoke", () => {
  it("resolves via workspace + exports the 6L sentinel", () => {
    expect(__gmackoStoragePhase).toBe("6l");
  });
});
