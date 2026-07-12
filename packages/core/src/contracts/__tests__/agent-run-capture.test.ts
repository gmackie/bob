// Phase 7B-4B Task 1 — Verify AgentRpc includes agent.run + agent.capture RPCs.
//
// After adding 5 new procedures the group should have 10 total (5 existing + 5 new).

import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  AgentRpc,
  AgentRunGetRpc,
  AgentRunListRpc,
  AgentRunListByWorkItemRpc,
  AgentRunListAllRpc,
  AgentCaptureListTargetsRpc,
  AgentCaptureCaptureRpc,
} from "../groups/agent.js";
import { AgentRunSchema } from "../schemas/agent-run.js";

describe("AgentRpc group — agent.run + agent.capture (7B-4B Task 1)", () => {
  it("has at least 57 procedures (grows as tasks add RPCs)", () => {
    const tags = Array.from(AgentRpc.requests.keys());
    expect(tags.length).toBeGreaterThanOrEqual(57);
  });

  it("includes the 5 new procedures by tag", () => {
    expect(AgentRpc.requests.get("agent.run.get")).toBe(AgentRunGetRpc);
    expect(AgentRpc.requests.get("agent.run.list")).toBe(AgentRunListRpc);
    expect(AgentRpc.requests.get("agent.run.listByWorkItem")).toBe(
      AgentRunListByWorkItemRpc,
    );
    expect(AgentRpc.requests.has("agent.run.listAll")).toBe(true);
    expect(AgentRpc.requests.get("agent.run.listAll")).toBe(
      AgentRunListAllRpc,
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

  it("preserves provider identity and capacity summary on the run wire", () => {
    const run = Schema.decodeUnknownSync(AgentRunSchema)({
      id: "run-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      workItemId: "work-item-1",
      agentType: "grok",
      summary: {
        providerCapacity: {
          observed: { source: "estimated", inputTokens: 10, outputTokens: 2 },
        },
      },
      status: "completed",
      startedAt: "2026-07-12T00:00:00.000Z",
      completedAt: "2026-07-12T00:01:00.000Z",
      createdAt: "2026-07-12T00:00:00.000Z",
    });

    expect(run).toMatchObject({
      agentType: "grok",
      summary: {
        providerCapacity: {
          observed: { source: "estimated", inputTokens: 10, outputTokens: 2 },
        },
      },
    });
  });
});
