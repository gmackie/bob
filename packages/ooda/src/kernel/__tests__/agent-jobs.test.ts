import { describe, expect, it } from "vitest";

import {
  resolveAgentJobPolicy,
  validateAgentJobCapabilities,
} from "../agent-jobs";

describe("agent job policy", () => {
  it("uses bounded server-owned defaults for research and scratch work", () => {
    expect(resolveAgentJobPolicy("read_only_research")).toEqual({
      provider: "codex",
      capabilities: ["project_context.read", "web.read", "scratch.write"],
      budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
    });
    expect(resolveAgentJobPolicy("scratch_prototype")).toEqual({
      provider: "codex",
      capabilities: [
        "process.execute",
        "project_context.read",
        "scratch.read",
        "scratch.write",
        "web.read",
      ],
      budget: { deadlineSeconds: 1_800, aggregateTokens: 250_000 },
    });
  });

  it("allows callers to narrow capabilities but never expand them", () => {
    expect(
      validateAgentJobCapabilities("scratch_prototype", [
        "scratch.write",
        "project_context.read",
      ]),
    ).toEqual(["project_context.read", "scratch.write"]);

    expect(() =>
      validateAgentJobCapabilities("read_only_research", [
        "project_context.read",
        "bob.project.create",
      ]),
    ).toThrow(/not permitted.*bob\.project\.create/i);
  });

  it("never grants durable mutation or inherited credentials", () => {
    for (const jobClass of [
      "read_only_research",
      "scratch_prototype",
      "comparison",
      "synthesis",
      "opportunity_review",
    ] as const) {
      const policy = resolveAgentJobPolicy(jobClass);
      expect(policy.capabilities).not.toContain("bob.task.create");
      expect(policy.capabilities).not.toContain("repository.write");
      expect(policy.capabilities).not.toContain("credentials.inherit");
    }
  });
});
