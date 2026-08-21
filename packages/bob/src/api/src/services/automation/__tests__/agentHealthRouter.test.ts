import { describe, expect, it } from "vitest";

import { assessAgentHealth, chooseAgent } from "../agentHealthRouter";

const ROT = ["claude", "codex", "grok", "cursor"];

describe("assessAgentHealth", () => {
  it("treats agents with no recent data as healthy", () => {
    expect(assessAgentHealth(ROT, []).every((v) => v.healthy)).toBe(true);
  });
  it("marks an agent unhealthy after repeated errors with zero completions (dead auth / rate limit)", () => {
    const v = assessAgentHealth(ROT, [{ agent: "codex", completed: 0, errored: 3 }]);
    expect(v.find((x) => x.agent === "codex")).toMatchObject({ healthy: false, reason: "3 errors, 0 completions" });
  });
  it("does not trip on a couple of errors when the agent also completes work", () => {
    const v = assessAgentHealth(ROT, [{ agent: "claude", completed: 4, errored: 2 }]);
    expect(v.find((x) => x.agent === "claude")?.healthy).toBe(true);
  });
  it("trips on a high error ratio once there are enough samples", () => {
    const v = assessAgentHealth(ROT, [{ agent: "grok", completed: 1, errored: 9 }]);
    expect(v.find((x) => x.agent === "grok")?.healthy).toBe(false);
    const few = assessAgentHealth(ROT, [{ agent: "grok", completed: 1, errored: 3 }]);
    expect(few.find((x) => x.agent === "grok")?.healthy).toBe(true);
  });
});

describe("chooseAgent", () => {
  it("round-robins over the healthy subset only", () => {
    const verdicts = assessAgentHealth(ROT, [{ agent: "codex", completed: 0, errored: 5 }]);
    const picks = [0, 1, 2, 3, 4, 5].map((i) => chooseAgent(ROT, verdicts, i).agent);
    expect(picks).toEqual(["claude", "grok", "cursor", "claude", "grok", "cursor"]);
    expect(chooseAgent(ROT, verdicts, 0).skipped.map((s) => s.agent)).toEqual(["codex"]);
  });
  it("falls back to the full rotation when every agent looks unhealthy", () => {
    const verdicts = assessAgentHealth(ROT, ROT.map((agent) => ({ agent, completed: 0, errored: 4 })));
    const picks = [0, 1, 2, 3].map((i) => chooseAgent(ROT, verdicts, i).agent);
    expect(picks).toEqual(ROT);
    expect(chooseAgent(ROT, verdicts, 0).skipped).toEqual([]);
  });
  it("preserves the plain rotation when all are healthy", () => {
    const verdicts = assessAgentHealth(ROT, []);
    expect([0, 1, 2, 3].map((i) => chooseAgent(ROT, verdicts, i).agent)).toEqual(ROT);
  });
});
