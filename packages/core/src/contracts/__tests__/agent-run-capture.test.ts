// Phase 7B-4B Task 1 — Verify AgentRpc includes agent.run + agent.capture RPCs.
//
// After adding 5 new procedures the group should have 10 total (5 existing + 5 new).

import { describe, expect, it } from "vitest";

import {
  AgentRpc,
  AgentRunGetRpc,
  AgentRunListRpc,
  AgentRunListByWorkItemRpc,
  AgentCaptureListTargetsRpc,
  AgentCaptureCaptureRpc,
} from "../groups/agent.js";

describe("AgentRpc group — agent.run + agent.capture (7B-4B Task 1)", () => {
  it("has 57 procedures total (5 original + 5 Task 1 + 28 Task 2 + 19 Task 3)", () => {
    const tags = Array.from(AgentRpc.requests.keys());
    expect(tags.length).toBe(57);
  });

  it("includes the 5 new procedures by tag", () => {
    expect(AgentRpc.requests.get("agent.run.get")).toBe(AgentRunGetRpc);
    expect(AgentRpc.requests.get("agent.run.list")).toBe(AgentRunListRpc);
    expect(AgentRpc.requests.get("agent.run.listByWorkItem")).toBe(
      AgentRunListByWorkItemRpc,
    );
    expect(AgentRpc.requests.get("agent.capture.listTargets")).toBe(
      AgentCaptureListTargetsRpc,
    );
    expect(AgentRpc.requests.get("agent.capture.capture")).toBe(
      AgentCaptureCaptureRpc,
    );
  });

  it("preserves the original 5 procedures", () => {
    expect(AgentRpc.requests.has("agent.createSession")).toBe(true);
    expect(AgentRpc.requests.has("agent.sendTurn")).toBe(true);
    expect(AgentRpc.requests.has("agent.cancelSession")).toBe(true);
    expect(AgentRpc.requests.has("agent.closeSession")).toBe(true);
    expect(AgentRpc.requests.has("agent.getTranscript")).toBe(true);
  });

  it("agent.run.get is not streaming", () => {
    // Import lazily to avoid pulling in the full RpcSchema at module level
    const { RpcSchema } = require("effect/unstable/rpc");
    expect(RpcSchema.isStreamSchema(AgentRunGetRpc.successSchema)).toBe(false);
  });
});
