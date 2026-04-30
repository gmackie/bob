// Phase 7B-4B Task 2 — Verify AgentRpc includes all 28 agent.session RPCs.
//
// After adding 28 new procedures the group should have 38 total
// (5 original + 5 Task 1 + 28 Task 2).

import { describe, expect, it } from "vitest";

import {
  AgentRpc,
  AgentSessionListRpc,
  AgentSessionGetRpc,
  AgentSessionCreateRpc,
  AgentSessionBootstrapForChatRpc,
  AgentSessionUpdateTitleRpc,
  AgentSessionStopRpc,
  AgentSessionDeleteRpc,
  AgentSessionGetEventsRpc,
  AgentSessionGetConnectionsRpc,
  AgentSessionSendHeadlessInputRpc,
  AgentSessionUpdateStatusRpc,
  AgentSessionClaimLeaseRpc,
  AgentSessionReleaseLeaseRpc,
  AgentSessionRecordEventRpc,
  AgentSessionRecordEventBatchRpc,
  AgentSessionGetGatewayWebSocketUrlRpc,
  AgentSessionReportWorkflowStatusRpc,
  AgentSessionReportTaskProgressRpc,
  AgentSessionLinkTaskArtifactRpc,
  AgentSessionMarkTaskReviewReadyRpc,
  AgentSessionRecordVerificationResultRpc,
  AgentSessionCompleteTaskRpc,
  AgentSessionRequestInputRpc,
  AgentSessionResolveAwaitingInputRpc,
  AgentSessionGetWorkflowStateRpc,
  AgentSessionCreateVoiceSessionRpc,
  AgentSessionStopVoiceSessionRpc,
  AgentSessionHandleVoiceTranscriptRpc,
} from "../groups/agent.js";

describe("AgentRpc group — agent.session (7B-4B Task 2)", () => {
  it("has 38 procedures total (5 original + 5 Task 1 + 28 Task 2)", () => {
    const tags = Array.from(AgentRpc.requests.keys());
    expect(tags.length).toBe(38);
  });

  it("includes all 28 agent.session procedures by tag", () => {
    const sessionTags = Array.from(AgentRpc.requests.keys()).filter((t) =>
      t.startsWith("agent.session."),
    );
    expect(sessionTags.length).toBe(28);
  });

  it("spot-check agent.session.list is registered", () => {
    expect(AgentRpc.requests.get("agent.session.list")).toBe(
      AgentSessionListRpc,
    );
  });

  it("spot-check agent.session.create is registered", () => {
    expect(AgentRpc.requests.get("agent.session.create")).toBe(
      AgentSessionCreateRpc,
    );
  });

  it("spot-check agent.session.recordEvent is registered", () => {
    expect(AgentRpc.requests.get("agent.session.recordEvent")).toBe(
      AgentSessionRecordEventRpc,
    );
  });

  it("spot-check agent.session.claimLease is registered", () => {
    expect(AgentRpc.requests.get("agent.session.claimLease")).toBe(
      AgentSessionClaimLeaseRpc,
    );
  });

  it("preserves the original 5 + Task 1 procedures", () => {
    expect(AgentRpc.requests.has("agent.createSession")).toBe(true);
    expect(AgentRpc.requests.has("agent.sendTurn")).toBe(true);
    expect(AgentRpc.requests.has("agent.cancelSession")).toBe(true);
    expect(AgentRpc.requests.has("agent.closeSession")).toBe(true);
    expect(AgentRpc.requests.has("agent.getTranscript")).toBe(true);
    expect(AgentRpc.requests.has("agent.run.get")).toBe(true);
    expect(AgentRpc.requests.has("agent.run.list")).toBe(true);
    expect(AgentRpc.requests.has("agent.run.listByWorkItem")).toBe(true);
    expect(AgentRpc.requests.has("agent.capture.listTargets")).toBe(true);
    expect(AgentRpc.requests.has("agent.capture.capture")).toBe(true);
  });

  it("all 28 session RPC exports resolve to defined values", () => {
    const rpcs = [
      AgentSessionListRpc,
      AgentSessionGetRpc,
      AgentSessionCreateRpc,
      AgentSessionBootstrapForChatRpc,
      AgentSessionUpdateTitleRpc,
      AgentSessionStopRpc,
      AgentSessionDeleteRpc,
      AgentSessionGetEventsRpc,
      AgentSessionGetConnectionsRpc,
      AgentSessionSendHeadlessInputRpc,
      AgentSessionUpdateStatusRpc,
      AgentSessionClaimLeaseRpc,
      AgentSessionReleaseLeaseRpc,
      AgentSessionRecordEventRpc,
      AgentSessionRecordEventBatchRpc,
      AgentSessionGetGatewayWebSocketUrlRpc,
      AgentSessionReportWorkflowStatusRpc,
      AgentSessionReportTaskProgressRpc,
      AgentSessionLinkTaskArtifactRpc,
      AgentSessionMarkTaskReviewReadyRpc,
      AgentSessionRecordVerificationResultRpc,
      AgentSessionCompleteTaskRpc,
      AgentSessionRequestInputRpc,
      AgentSessionResolveAwaitingInputRpc,
      AgentSessionGetWorkflowStateRpc,
      AgentSessionCreateVoiceSessionRpc,
      AgentSessionStopVoiceSessionRpc,
      AgentSessionHandleVoiceTranscriptRpc,
    ];
    for (const rpc of rpcs) {
      expect(rpc).toBeDefined();
    }
    expect(rpcs.length).toBe(28);
  });
});
