import { describe, it, expect } from "vitest";
import { __gmackoRunnerBasePhase } from "@gmacko/runner-base";

describe("@gmacko/runner-base package smoke", () => {
  it("resolves via workspace + exports the 6G sentinel", () => {
    expect(__gmackoRunnerBasePhase).toBe("6g");
  });
});
