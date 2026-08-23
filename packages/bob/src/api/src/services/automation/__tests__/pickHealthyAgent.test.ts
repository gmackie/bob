import { describe, expect, it } from "vitest";

import { pickHealthyAgent } from "../pickHealthyAgent";

const POOL = ["codex", "claude", "grok", "cursor"];

describe("pickHealthyAgent", () => {
  it("keeps the configured agent when it is healthy", () => {
    const r = pickHealthyAgent("codex", POOL, [{ agent: "codex", completed: 5, errored: 1 }]);
    expect(r).toEqual({ agent: "codex", fellBack: false });
  });

  it("keeps the configured agent when there is no recent data", () => {
    expect(pickHealthyAgent("codex", POOL, []).agent).toBe("codex");
  });

  it("falls back when the configured agent is only erroring (the 2026-08-23 case)", () => {
    const r = pickHealthyAgent("codex", POOL, [
      { agent: "codex", completed: 0, errored: 114 },
      { agent: "claude", completed: 2, errored: 0 },
    ]);
    expect(r.agent).toBe("claude");
    expect(r.fellBack).toBe(true);
    expect(r.reason).toMatch(/codex unhealthy/);
  });

  it("prefers the first healthy candidate in pool order", () => {
    const r = pickHealthyAgent("codex", POOL, [
      { agent: "codex", completed: 0, errored: 5 },
      { agent: "claude", completed: 0, errored: 4 },
      { agent: "grok", completed: 3, errored: 0 },
    ]);
    expect(r.agent).toBe("grok");
  });

  it("sticks with the configured agent when nothing is healthy", () => {
    const r = pickHealthyAgent("codex", POOL, POOL.map((agent) => ({ agent, completed: 0, errored: 6 })));
    expect(r).toMatchObject({ agent: "codex", fellBack: false, reason: "no healthy alternative" });
  });
});
