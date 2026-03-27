import { describe, expect, it } from "vitest";

import type { T3DomainEvent } from "../t3code-event-map.js";
import { buildOrchestrationProjection } from "../orchestration-projection.js";

function makeTaskRun(input: {
  id: string;
  sessionId?: string | null;
  parentTaskRunId?: string | null;
  runPhase?: "shape" | "plan" | "execute" | "review" | "ship";
  status?: "starting" | "running" | "blocked" | "completed" | "failed";
}) {
  return {
    id: input.id,
    sessionId: input.sessionId ?? null,
    parentTaskRunId: input.parentTaskRunId ?? null,
    runPhase: input.runPhase ?? "execute",
    status: input.status ?? "running",
  };
}

function makeRunEvent(
  type: "run.started" | "run.updated" | "run.completed" | "run.failed",
  runId: string,
  extra: Record<string, unknown> = {},
): T3DomainEvent {
  return {
    type,
    threadId: "thread-root",
    runId,
    ...extra,
  } as T3DomainEvent;
}

describe("orchestration projection", () => {
  it("creates a root run from planning or execution start", () => {
    const projection = buildOrchestrationProjection({
      taskRuns: [
        makeTaskRun({
          id: "run-root",
          sessionId: "session-root",
          runPhase: "plan",
        }),
      ],
      events: [makeRunEvent("run.started", "run-root", { status: "running" })],
    });

    expect(projection.rootRunIds).toEqual(["run-root"]);
    expect(projection.runsById["run-root"]).toMatchObject({
      id: "run-root",
      sessionId: "session-root",
      phase: "plan",
      status: "running",
      parentRunId: null,
      childRunIds: [],
      agentIds: [],
      taskIds: [],
    });
  });

  it("links a delegated child run to the parent and tracks the spawned agent", () => {
    const projection = buildOrchestrationProjection({
      taskRuns: [
        makeTaskRun({
          id: "run-root",
          sessionId: "session-root",
          runPhase: "execute",
        }),
        makeTaskRun({
          id: "run-child",
          sessionId: "session-child",
          parentTaskRunId: "run-root",
          runPhase: "execute",
        }),
      ],
      events: [
        makeRunEvent("run.started", "run-root", { status: "running" }),
        makeRunEvent("run.started", "run-child", { status: "running" }),
        {
          type: "agent.spawned",
          threadId: "thread-root",
          runId: "run-child",
          agentId: "agent-child",
          label: "researcher",
        },
      ],
    });

    const rootRun = projection.runsById["run-root"];
    const childRun = projection.runsById["run-child"];
    if (!rootRun || !childRun) {
      throw new Error("Expected root and child runs to exist");
    }
    expect(rootRun.childRunIds).toContain("run-child");
    expect(childRun).toMatchObject({
      parentRunId: "run-root",
      sessionId: "session-child",
      status: "running",
    });
    expect(projection.agentsById["agent-child"]).toMatchObject({
      runId: "run-child",
      label: "researcher",
      status: "running",
    });
  });

  it("attaches tasks to agents and marks blockers from dependency or input waits", () => {
    const projection = buildOrchestrationProjection({
      taskRuns: [makeTaskRun({ id: "run-root", sessionId: "session-root" })],
      events: [
        makeRunEvent("run.started", "run-root", { status: "running" }),
        {
          type: "agent.spawned",
          threadId: "thread-root",
          runId: "run-root",
          agentId: "agent-1",
          label: "builder",
        },
        {
          type: "agent.task.assigned",
          threadId: "thread-root",
          runId: "run-root",
          agentId: "agent-1",
          taskId: "task-1",
          title: "Implement the reducer",
        },
        {
          type: "agent.task.blocked",
          threadId: "thread-root",
          runId: "run-root",
          agentId: "agent-1",
          taskId: "task-1",
          blocker: "awaiting dependency",
        },
        {
          type: "user_input.requested",
          threadId: "thread-root",
          runId: "run-root",
          requestId: "input-1",
          question: "Which branch should this target?",
        },
      ],
    });

    expect(projection.tasksById["task-1"]).toMatchObject({
      runId: "run-root",
      agentId: "agent-1",
      title: "Implement the reducer",
      status: "blocked",
      blocker: "awaiting dependency",
    });
    expect(projection.requestsById["input-1"]).toMatchObject({
      runId: "run-root",
      question: "Which branch should this target?",
      status: "open",
    });
    expect(projection.agentsById["agent-1"]).toMatchObject({
      currentTaskId: "task-1",
      status: "blocked",
      pendingRequestIds: ["input-1"],
    });
    expect(projection.runsById["run-root"]).toMatchObject({
      status: "blocked",
      blocker: "Which branch should this target?",
      taskIds: ["task-1"],
    });
  });

  it("records artifacts and their links", () => {
    const projection = buildOrchestrationProjection({
      taskRuns: [makeTaskRun({ id: "run-root", sessionId: "session-root" })],
      events: [
        makeRunEvent("run.started", "run-root", { status: "running" }),
        {
          type: "artifact.produced",
          threadId: "thread-root",
          runId: "run-root",
          artifactId: "artifact-1",
          artifactKind: "plan",
          title: "Integration plan",
        },
        {
          type: "link.created",
          threadId: "thread-root",
          runId: "run-root",
          linkKind: "artifact-to-run",
          sourceId: "artifact-1",
          targetId: "run-root",
        },
      ],
    });

    expect(projection.artifactsById["artifact-1"]).toMatchObject({
      runId: "run-root",
      kind: "plan",
      title: "Integration plan",
      linkedTo: [
        {
          kind: "artifact-to-run",
          sourceId: "artifact-1",
          targetId: "run-root",
        },
      ],
    });
    expect(projection.links).toEqual([
      {
        kind: "artifact-to-run",
        runId: "run-root",
        sourceId: "artifact-1",
        targetId: "run-root",
      },
    ]);
  });

  it("keeps child task runs as child runs in the hierarchy", () => {
    const projection = buildOrchestrationProjection({
      taskRuns: [
        makeTaskRun({
          id: "run-root",
          sessionId: "session-root",
          runPhase: "plan",
        }),
        makeTaskRun({
          id: "run-child",
          sessionId: "session-child",
          parentTaskRunId: "run-root",
          runPhase: "execute",
        }),
      ],
      events: [
        makeRunEvent("run.started", "run-root", { status: "running" }),
        makeRunEvent("run.started", "run-child", { status: "running" }),
        {
          type: "agent.spawned",
          threadId: "thread-child",
          runId: "run-child",
          agentId: "agent-child",
          label: "worker",
        },
        {
          type: "agent.task.assigned",
          threadId: "thread-child",
          runId: "run-child",
          agentId: "agent-child",
          taskId: "task-child",
          title: "Follow up on child work",
        },
      ],
    });

    expect(projection.rootRunIds).toEqual(["run-root"]);
    expect(projection.runsById["run-child"]).toMatchObject({
      parentRunId: "run-root",
      sessionId: "session-child",
      childRunIds: [],
      agentIds: ["agent-child"],
    });
    expect(projection.agentsById["agent-child"]).toMatchObject({
      runId: "run-child",
      currentTaskId: "task-child",
    });
    expect(projection.tasksById["task-child"]).toMatchObject({
      runId: "run-child",
      agentId: "agent-child",
      title: "Follow up on child work",
    });
  });

  it("tracks child task runs on the parent task hierarchy", () => {
    const projection = buildOrchestrationProjection({
      taskRuns: [
        makeTaskRun({
          id: "run-root",
          sessionId: "session-root",
          runPhase: "plan",
        }),
        makeTaskRun({
          id: "run-child",
          sessionId: "session-child",
          parentTaskRunId: "run-root",
          runPhase: "execute",
        }),
      ],
      events: [
        makeRunEvent("run.started", "run-root", { status: "running" }),
        makeRunEvent("run.started", "run-child", { status: "running" }),
        {
          type: "agent.spawned",
          threadId: "thread-root",
          runId: "run-root",
          agentId: "agent-root",
          label: "planner",
        },
        {
          type: "agent.task.assigned",
          threadId: "thread-root",
          runId: "run-root",
          agentId: "agent-root",
          taskId: "task-root",
          title: "Coordinate the delegation",
        },
      ],
    });

    const rootRun = projection.runsById["run-root"];
    if (!rootRun) {
      throw new Error("Expected root run to exist");
    }
    expect(rootRun.childRunIds).toEqual(["run-child"]);
    expect(projection.tasksById["task-root"]).toMatchObject({
      runId: "run-root",
      agentId: "agent-root",
      childTaskRunIds: ["run-child"],
    });
  });

  it("keeps runs blocked until the last pending request resolves and inherited agents retain the pending state", () => {
    const projection = buildOrchestrationProjection({
      taskRuns: [makeTaskRun({ id: "run-root", sessionId: "session-root" })],
      events: [
        makeRunEvent("run.started", "run-root", { status: "running" }),
        {
          type: "agent.spawned",
          threadId: "thread-root",
          runId: "run-root",
          agentId: "agent-1",
          label: "builder",
        },
        {
          type: "user_input.requested",
          threadId: "thread-root",
          runId: "run-root",
          requestId: "input-1",
          question: "Which branch should this target?",
        },
        {
          type: "request.opened",
          threadId: "thread-root",
          runId: "run-root",
          requestId: "request-1",
          detail: "Need approval to continue",
        },
        {
          type: "agent.spawned",
          threadId: "thread-root",
          runId: "run-root",
          agentId: "agent-2",
          label: "reviewer",
        },
        {
          type: "request.resolved",
          threadId: "thread-root",
          runId: "run-root",
          requestId: "request-1",
          decision: "approved",
        },
      ],
    });

    expect(projection.runsById["run-root"]).toMatchObject({
      status: "blocked",
      blocker: "Which branch should this target?",
    });
    expect(projection.agentsById["agent-2"]).toMatchObject({
      pendingRequestIds: ["input-1"],
    });

    const afterUserInputResolution = buildOrchestrationProjection({
      taskRuns: [makeTaskRun({ id: "run-root", sessionId: "session-root" })],
      events: [
        makeRunEvent("run.started", "run-root", { status: "running" }),
        {
          type: "agent.spawned",
          threadId: "thread-root",
          runId: "run-root",
          agentId: "agent-1",
          label: "builder",
        },
        {
          type: "user_input.requested",
          threadId: "thread-root",
          runId: "run-root",
          requestId: "input-1",
          question: "Which branch should this target?",
        },
        {
          type: "request.opened",
          threadId: "thread-root",
          runId: "run-root",
          requestId: "request-1",
          detail: "Need approval to continue",
        },
        {
          type: "agent.spawned",
          threadId: "thread-root",
          runId: "run-root",
          agentId: "agent-2",
          label: "reviewer",
        },
        {
          type: "request.resolved",
          threadId: "thread-root",
          runId: "run-root",
          requestId: "request-1",
          decision: "approved",
        },
        {
          type: "user_input.resolved",
          threadId: "thread-root",
          runId: "run-root",
          requestId: "input-1",
          answers: ["main"],
        },
      ],
    });

    expect(afterUserInputResolution.runsById["run-root"]).toMatchObject({
      status: "running",
      blocker: null,
    });
    expect(afterUserInputResolution.agentsById["agent-1"]).toMatchObject({
      pendingRequestIds: [],
    });
    expect(afterUserInputResolution.agentsById["agent-2"]).toMatchObject({
      pendingRequestIds: [],
    });
  });

  it("removes stale ownership from the previous agent when a task is reassigned", () => {
    const projection = buildOrchestrationProjection({
      taskRuns: [makeTaskRun({ id: "run-root", sessionId: "session-root" })],
      events: [
        makeRunEvent("run.started", "run-root", { status: "running" }),
        {
          type: "agent.spawned",
          threadId: "thread-root",
          runId: "run-root",
          agentId: "agent-old",
          label: "builder",
        },
        {
          type: "agent.spawned",
          threadId: "thread-root",
          runId: "run-root",
          agentId: "agent-new",
          label: "reviewer",
        },
        {
          type: "agent.task.assigned",
          threadId: "thread-root",
          runId: "run-root",
          agentId: "agent-old",
          taskId: "task-1",
          title: "Implement the reducer",
        },
        {
          type: "agent.task.reassigned",
          threadId: "thread-root",
          runId: "run-root",
          agentId: "agent-new",
          taskId: "task-1",
          previousAgentId: "agent-old",
        },
      ],
    });

    expect(projection.tasksById["task-1"]).toMatchObject({
      runId: "run-root",
      agentId: "agent-new",
    });
    expect(projection.agentsById["agent-old"]).toMatchObject({
      currentTaskId: null,
      taskIds: [],
    });
    expect(projection.agentsById["agent-new"]).toMatchObject({
      currentTaskId: "task-1",
      taskIds: ["task-1"],
    });
  });
});
