import { describe, expect, it } from "vitest";

import { agentOverrideFromLabels } from "../agentLabel";

describe("agentOverrideFromLabels", () => {
  it("reads agent:<name> in any of the accepted spellings", () => {
    expect(agentOverrideFromLabels(["Bug", "agent:codex"])).toBe("codex");
    expect(agentOverrideFromLabels(["Agent/Grok"])).toBe("grok");
    expect(agentOverrideFromLabels(["agent = cursor"])).toBe("cursor");
  });
  it("ignores unknown agents and unrelated labels", () => {
    expect(agentOverrideFromLabels(["agent:gpt9", "Feature"])).toBeNull();
    expect(agentOverrideFromLabels(["agentic", "urgent"])).toBeNull();
    expect(agentOverrideFromLabels([])).toBeNull();
  });
  it("first valid label wins", () => {
    expect(agentOverrideFromLabels(["agent:nope", "agent:claude", "agent:codex"])).toBe("claude");
  });
});
