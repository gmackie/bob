// Phase 7B-4B Task 3 — Verify AgentRpc includes all 19 agent.instance +
// agent.terminal + agent.event RPCs.
//
// After adding 19 new procedures the group should have 57 total
// (5 original + 5 Task 1 + 28 Task 2 + 19 Task 3).

import { describe, expect, it } from "vitest";

import {
  AgentRpc,
  // instance (9)
  AgentInstanceListRpc,
  AgentInstanceByIdRpc,
  AgentInstanceByRepositoryRpc,
  AgentInstanceByWorktreeRpc,
  AgentInstanceStartRpc,
  AgentInstanceStopRpc,
  AgentInstanceRestartRpc,
  AgentInstanceDeleteRpc,
  AgentInstanceUpdateStatusRpc,
  // terminal (5)
  AgentTerminalCreateAgentSessionRpc,
  AgentTerminalCreateDirectorySessionRpc,
  AgentTerminalCreateSystemSessionRpc,
  AgentTerminalListByInstanceRpc,
  AgentTerminalCloseRpc,
  // event (5)
  AgentEventListRpc,
  AgentEventCreateRpc,
  AgentEventRecentActivityRpc,
  AgentEventByWorktreeRpc,
  AgentEventStatsRpc,
} from "../groups/agent.js";

describe("AgentRpc group — agent.instance + terminal + event (7B-4B Task 3)", () => {
  it("has at least 57 procedures (grows as tasks add RPCs)", () => {
    const tags = Array.from(AgentRpc.requests.keys());
    expect(tags.length).toBeGreaterThanOrEqual(57);
  });

  it("includes all 9 agent.instance procedures by tag", () => {
    const instanceTags = Array.from(AgentRpc.requests.keys()).filter((t) =>
      t.startsWith("agent.instance."),
    );
    expect(instanceTags.length).toBe(9);
  });

  it("includes all 5 agent.terminal procedures by tag", () => {
    const terminalTags = Array.from(AgentRpc.requests.keys()).filter((t) =>
      t.startsWith("agent.terminal."),
    );
    expect(terminalTags.length).toBe(5);
  });

  it("includes all 5 agent.event procedures by tag", () => {
    const eventTags = Array.from(AgentRpc.requests.keys()).filter((t) =>
      t.startsWith("agent.event."),
    );
    expect(eventTags.length).toBe(5);
  });

  it("spot-check agent.instance.list is registered", () => {
    expect(AgentRpc.requests.get("agent.instance.list")).toBe(
      AgentInstanceListRpc,
    );
  });

  it("spot-check agent.instance.start is registered", () => {
    expect(AgentRpc.requests.get("agent.instance.start")).toBe(
      AgentInstanceStartRpc,
    );
  });

  it("spot-check agent.terminal.createAgentSession is registered", () => {
    expect(AgentRpc.requests.get("agent.terminal.createAgentSession")).toBe(
      AgentTerminalCreateAgentSessionRpc,
    );
  });

  it("spot-check agent.event.stats is registered", () => {
    expect(AgentRpc.requests.get("agent.event.stats")).toBe(
      AgentEventStatsRpc,
    );
  });

  it("preserves all previous procedures (original 5 + Task 1 + Task 2)", () => {
    // Original 5
    expect(AgentRpc.requests.has("agent.createSession")).toBe(true);
    expect(AgentRpc.requests.has("agent.sendTurn")).toBe(true);
    expect(AgentRpc.requests.has("agent.cancelSession")).toBe(true);
    expect(AgentRpc.requests.has("agent.closeSession")).toBe(true);
    expect(AgentRpc.requests.has("agent.getTranscript")).toBe(true);
    // Task 1
    expect(AgentRpc.requests.has("agent.run.get")).toBe(true);
    expect(AgentRpc.requests.has("agent.run.list")).toBe(true);
    expect(AgentRpc.requests.has("agent.run.listByWorkItem")).toBe(true);
    expect(AgentRpc.requests.has("agent.capture.listTargets")).toBe(true);
    expect(AgentRpc.requests.has("agent.capture.capture")).toBe(true);
    // Task 2 (spot-check a few)
    expect(AgentRpc.requests.has("agent.session.list")).toBe(true);
    expect(AgentRpc.requests.has("agent.session.claimLease")).toBe(true);
    expect(AgentRpc.requests.has("agent.session.handleVoiceTranscript")).toBe(
      true,
    );
  });

  it("all 19 Task 3 RPC exports resolve to defined values", () => {
    const rpcs = [
      AgentInstanceListRpc,
      AgentInstanceByIdRpc,
      AgentInstanceByRepositoryRpc,
      AgentInstanceByWorktreeRpc,
      AgentInstanceStartRpc,
      AgentInstanceStopRpc,
      AgentInstanceRestartRpc,
      AgentInstanceDeleteRpc,
      AgentInstanceUpdateStatusRpc,
      AgentTerminalCreateAgentSessionRpc,
      AgentTerminalCreateDirectorySessionRpc,
      AgentTerminalCreateSystemSessionRpc,
      AgentTerminalListByInstanceRpc,
      AgentTerminalCloseRpc,
      AgentEventListRpc,
      AgentEventCreateRpc,
      AgentEventRecentActivityRpc,
      AgentEventByWorktreeRpc,
      AgentEventStatsRpc,
    ];
    for (const rpc of rpcs) {
      expect(rpc).toBeDefined();
    }
    expect(rpcs.length).toBe(19);
  });
});
