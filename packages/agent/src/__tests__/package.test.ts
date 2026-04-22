import { describe, it, expect } from "vitest";
import { __gmackoAgentPhase } from "@gmacko/agent";

describe("@gmacko/agent package smoke", () => {
  it("resolves via workspace + exports the 6E sentinel", () => {
    expect(__gmackoAgentPhase).toBe("6e");
  });
});
