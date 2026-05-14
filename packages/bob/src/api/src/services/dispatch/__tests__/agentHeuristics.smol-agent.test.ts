import { describe, expect, it } from "vitest";

import { suggestAgent } from "../agentHeuristics";

describe("suggestAgent", () => {
  it("recommends claude for implementation-oriented task execution", () => {
    expect(
      suggestAgent({
        kind: "task",
        title: "Implement ACP bridge for smol-agent runtime",
        description:
          "Build the gateway adapter and task execution wiring for smol-agent",
      }),
    ).toBe("claude");
  });
});
