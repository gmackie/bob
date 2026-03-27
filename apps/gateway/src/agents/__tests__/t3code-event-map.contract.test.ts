import { describe, expect, it } from "vitest";

import { bobEventToT3 } from "../t3code-event-map.js";
import type { ServerEvent } from "../../ws/protocol.js";

const THREAD_ID = "thread-compat";

function makeStateEvent(payload: Record<string, unknown>): ServerEvent {
  return {
    type: "event",
    sessionId: "session-compat",
    seq: 1,
    eventType: "state",
    direction: "system",
    payload,
    createdAt: "2026-03-27T00:00:00.000Z",
  };
}

describe("bobEventToT3 canonical v1 contract", () => {
  it.each<
    [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ]
  >([
    [
      "thread.message.started",
      {
        orchestrationType: "thread_message_started",
        runId: "run-1",
        messageId: "message-1",
        role: "assistant",
      },
      {
        type: "thread.message.started",
        threadId: THREAD_ID,
        runId: "run-1",
        messageId: "message-1",
        role: "assistant",
      },
    ],
    [
      "thread.message.delta",
      {
        orchestrationType: "thread_message_delta",
        runId: "run-1",
        messageId: "message-1",
        content: "halfway there",
      },
      {
        type: "thread.message.delta",
        threadId: THREAD_ID,
        runId: "run-1",
        messageId: "message-1",
        content: "halfway there",
      },
    ],
    [
      "thread.message.completed",
      {
        orchestrationType: "thread_message_completed",
        runId: "run-1",
        messageId: "message-1",
        content: "done",
      },
      {
        type: "thread.message.completed",
        threadId: THREAD_ID,
        runId: "run-1",
        messageId: "message-1",
        content: "done",
      },
    ],
    [
      "thread.message.failed",
      {
        orchestrationType: "thread_message_failed",
        runId: "run-1",
        messageId: "message-1",
        errorMessage: "stream interrupted",
      },
      {
        type: "thread.message.failed",
        threadId: THREAD_ID,
        runId: "run-1",
        messageId: "message-1",
        errorMessage: "stream interrupted",
      },
    ],
    [
      "run.started",
      {
        orchestrationType: "run_started",
        runId: "run-1",
        status: "running",
      },
      {
        type: "run.started",
        threadId: THREAD_ID,
        runId: "run-1",
        status: "running",
      },
    ],
    [
      "run.updated",
      {
        orchestrationType: "run_updated",
        runId: "run-1",
        status: "running",
        detail: "waiting for dependencies",
      },
      {
        type: "run.updated",
        threadId: THREAD_ID,
        runId: "run-1",
        status: "running",
        detail: "waiting for dependencies",
      },
    ],
    [
      "run.completed",
      {
        orchestrationType: "run_completed",
        runId: "run-1",
        status: "completed",
        summary: "run finished cleanly",
      },
      {
        type: "run.completed",
        threadId: THREAD_ID,
        runId: "run-1",
        status: "completed",
        summary: "run finished cleanly",
      },
    ],
    [
      "run.failed",
      {
        orchestrationType: "run_failed",
        runId: "run-1",
        status: "failed",
        errorMessage: "child agent crashed",
      },
      {
        type: "run.failed",
        threadId: THREAD_ID,
        runId: "run-1",
        status: "failed",
        errorMessage: "child agent crashed",
      },
    ],
    [
      "agent.spawned",
      {
        orchestrationType: "agent_spawned",
        runId: "run-1",
        agentId: "agent-1",
        label: "researcher",
      },
      {
        type: "agent.spawned",
        threadId: THREAD_ID,
        runId: "run-1",
        agentId: "agent-1",
        label: "researcher",
      },
    ],
    [
      "agent.updated",
      {
        orchestrationType: "agent_updated",
        runId: "run-1",
        agentId: "agent-1",
        status: "blocked",
        detail: "waiting on approval",
      },
      {
        type: "agent.updated",
        threadId: THREAD_ID,
        runId: "run-1",
        agentId: "agent-1",
        status: "blocked",
        detail: "waiting on approval",
      },
    ],
    [
      "agent.completed",
      {
        orchestrationType: "agent_completed",
        runId: "run-1",
        agentId: "agent-1",
        status: "completed",
        summary: "task wrapped up",
      },
      {
        type: "agent.completed",
        threadId: THREAD_ID,
        runId: "run-1",
        agentId: "agent-1",
        status: "completed",
        summary: "task wrapped up",
      },
    ],
    [
      "agent.failed",
      {
        orchestrationType: "agent_failed",
        runId: "run-1",
        agentId: "agent-1",
        status: "failed",
        errorMessage: "tool call timed out",
      },
      {
        type: "agent.failed",
        threadId: THREAD_ID,
        runId: "run-1",
        agentId: "agent-1",
        status: "failed",
        errorMessage: "tool call timed out",
      },
    ],
    [
      "agent.task.assigned",
      {
        orchestrationType: "agent_task_assigned",
        runId: "run-1",
        agentId: "agent-1",
        taskId: "task-1",
        title: "Inspect orchestration flow",
      },
      {
        type: "agent.task.assigned",
        threadId: THREAD_ID,
        runId: "run-1",
        agentId: "agent-1",
        taskId: "task-1",
        title: "Inspect orchestration flow",
      },
    ],
    [
      "agent.task.progressed",
      {
        orchestrationType: "agent_task_progressed",
        runId: "run-1",
        agentId: "agent-1",
        taskId: "task-1",
        detail: "read the router contract",
      },
      {
        type: "agent.task.progressed",
        threadId: THREAD_ID,
        runId: "run-1",
        agentId: "agent-1",
        taskId: "task-1",
        detail: "read the router contract",
      },
    ],
    [
      "agent.task.blocked",
      {
        orchestrationType: "agent_task_blocked",
        runId: "run-1",
        agentId: "agent-1",
        taskId: "task-1",
        blocker: "approval required",
      },
      {
        type: "agent.task.blocked",
        threadId: THREAD_ID,
        runId: "run-1",
        agentId: "agent-1",
        taskId: "task-1",
        blocker: "approval required",
      },
    ],
    [
      "agent.task.completed",
      {
        orchestrationType: "agent_task_completed",
        runId: "run-1",
        agentId: "agent-1",
        taskId: "task-1",
        summary: "implemented the projection",
      },
      {
        type: "agent.task.completed",
        threadId: THREAD_ID,
        runId: "run-1",
        agentId: "agent-1",
        taskId: "task-1",
        summary: "implemented the projection",
      },
    ],
    [
      "agent.task.failed",
      {
        orchestrationType: "agent_task_failed",
        runId: "run-1",
        agentId: "agent-1",
        taskId: "task-1",
        errorMessage: "projection mismatch",
      },
      {
        type: "agent.task.failed",
        threadId: THREAD_ID,
        runId: "run-1",
        agentId: "agent-1",
        taskId: "task-1",
        errorMessage: "projection mismatch",
      },
    ],
    [
      "agent.task.reassigned",
      {
        orchestrationType: "agent_task_reassigned",
        runId: "run-1",
        agentId: "agent-1",
        taskId: "task-1",
        previousAgentId: "agent-0",
      },
      {
        type: "agent.task.reassigned",
        threadId: THREAD_ID,
        runId: "run-1",
        agentId: "agent-1",
        taskId: "task-1",
        previousAgentId: "agent-0",
      },
    ],
    [
      "request.opened",
      {
        orchestrationType: "request_opened",
        runId: "run-1",
        requestId: "request-1",
        requestKind: "command",
        detail: "Need approval for command execution",
      },
      {
        type: "request.opened",
        threadId: THREAD_ID,
        runId: "run-1",
        requestId: "request-1",
        requestKind: "command",
        detail: "Need approval for command execution",
      },
    ],
    [
      "request.resolved",
      {
        orchestrationType: "request_resolved",
        runId: "run-1",
        requestId: "request-1",
        requestKind: "command",
        decision: "accept",
      },
      {
        type: "request.resolved",
        threadId: THREAD_ID,
        runId: "run-1",
        requestId: "request-1",
        requestKind: "command",
        decision: "accept",
      },
    ],
    [
      "user_input.requested",
      {
        orchestrationType: "user_input_requested",
        runId: "run-1",
        requestId: "input-1",
        question: "Which branch should be used?",
      },
      {
        type: "user_input.requested",
        threadId: THREAD_ID,
        runId: "run-1",
        requestId: "input-1",
        question: "Which branch should be used?",
      },
    ],
    [
      "user_input.resolved",
      {
        orchestrationType: "user_input_resolved",
        runId: "run-1",
        requestId: "input-1",
        answers: ["main"],
      },
      {
        type: "user_input.resolved",
        threadId: THREAD_ID,
        runId: "run-1",
        requestId: "input-1",
        answers: ["main"],
      },
    ],
    [
      "artifact.produced",
      {
        orchestrationType: "artifact_produced",
        runId: "run-1",
        artifactId: "artifact-1",
        artifactKind: "plan",
        title: "Integration plan",
      },
      {
        type: "artifact.produced",
        threadId: THREAD_ID,
        runId: "run-1",
        artifactId: "artifact-1",
        artifactKind: "plan",
        title: "Integration plan",
      },
    ],
    [
      "artifact.updated",
      {
        orchestrationType: "artifact_updated",
        runId: "run-1",
        artifactId: "artifact-1",
        artifactKind: "plan",
        title: "Integration plan v2",
      },
      {
        type: "artifact.updated",
        threadId: THREAD_ID,
        runId: "run-1",
        artifactId: "artifact-1",
        artifactKind: "plan",
        title: "Integration plan v2",
      },
    ],
    [
      "artifact.promoted",
      {
        orchestrationType: "artifact_promoted",
        runId: "run-1",
        artifactId: "artifact-1",
        artifactKind: "plan",
        title: "Integration plan",
      },
      {
        type: "artifact.promoted",
        threadId: THREAD_ID,
        runId: "run-1",
        artifactId: "artifact-1",
        artifactKind: "plan",
        title: "Integration plan",
      },
    ],
    [
      "link.created",
      {
        orchestrationType: "link_created",
        runId: "run-1",
        linkKind: "thread-to-run",
        sourceId: "thread-1",
        targetId: "run-1",
      },
      {
        type: "link.created",
        threadId: THREAD_ID,
        runId: "run-1",
        linkKind: "thread-to-run",
        sourceId: "thread-1",
        targetId: "run-1",
      },
    ],
    [
      "session.statusChange fallback",
      {
        status: "stopping",
      },
      {
        type: "session.statusChange",
        threadId: THREAD_ID,
        status: "stopped",
      },
    ],
  ])("maps %s", (_label, payload, expected) => {
    const event = makeStateEvent(payload);
    expect(bobEventToT3(event, THREAD_ID)).toMatchObject(expected);
  });
});
