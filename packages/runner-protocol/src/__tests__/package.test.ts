import { describe, it, expect } from "vitest";
import { __gmackoRunnerProtocolPhase } from "@gmacko/runner-protocol";

describe("@gmacko/runner-protocol package smoke", () => {
  it("resolves via workspace + exports the 6G sentinel", () => {
    expect(__gmackoRunnerProtocolPhase).toBe("6g");
  });
});
