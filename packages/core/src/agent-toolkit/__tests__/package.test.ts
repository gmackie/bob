import { describe, it, expect } from "vitest";
import { __gmackoAgentToolkitPhase } from "@gmacko/core/agent-toolkit";

describe("@gmacko/agent-toolkit package smoke", () => {
  it("resolves via workspace + exports the 6L sentinel", () => {
    expect(__gmackoAgentToolkitPhase).toBe("6l");
  });
});
