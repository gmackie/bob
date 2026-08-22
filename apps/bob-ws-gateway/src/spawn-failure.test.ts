import { describe, expect, it } from "vitest";

import { spawnFailureAgent } from "./spawn-failure";

describe("spawnFailureAgent", () => {
  it("extracts the agent from the runner's ENOENT message", () => {
    expect(spawnFailureAgent("Failed to spawn agent: spawn codex ENOENT")).toBe("codex");
    expect(spawnFailureAgent("spawn cursor-agent ENOENT")).toBe("cursor-agent");
  });
  it("ignores unrelated errors", () => {
    expect(spawnFailureAgent("Agent exited with code 1 — rate_limit")).toBeNull();
    expect(spawnFailureAgent("fatal: could not create leading directories")).toBeNull();
    expect(spawnFailureAgent(undefined)).toBeNull();
    expect(spawnFailureAgent("")).toBeNull();
  });
});
