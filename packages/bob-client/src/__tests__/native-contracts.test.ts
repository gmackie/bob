import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { WorkItemRecordSchema } from "../../../bob/src/contracts/schemas/work-item-core.js";
import { TaskRunRecordSchema } from "../../../bob/src/contracts/schemas/work-item-sub.js";
import {
  SessionSchema,
  WorkflowStateSchema,
} from "../../../core/src/contracts/schemas/agent-session.js";

describe("native execution contract parity", () => {
  it("preserves active execution, queue order, dependencies and agent choice", () => {
    const item = {
      id: "work",
      kind: "task" as const,
      status: "in_progress",
      title: "Build",
      identifier: "BOB-1",
      queueSortOrder: 4,
      updatedAt: null,
      agentTypeOverride: "codex",
      externalId: "LIN-1",
      agentStatus: {
        sessionId: "session",
        status: "running",
        agentType: "codex",
      },
      dependencies: [
        { id: "parent", identifier: "BOB-2", title: "Prepare", status: "done" },
      ],
      dependents: [],
      project: { id: "p", key: "BOB", name: "Bob", defaultAgentType: "claude" },
    };
    expect(Schema.encodeSync(WorkItemRecordSchema)(item)).toEqual(item);
  });
  it("keeps the execution branch available to the review screen", () => {
    const run = {
      id: "run",
      userId: "u",
      status: "running",
      branch: "work/bob-1",
      updatedAt: null,
    };
    expect(Schema.encodeSync(TaskRunRecordSchema)(run)).toEqual(run);
  });
  it("accepts queued and blocked sessions returned by the live runtime", () => {
    const session = {
      id: "s",
      title: null,
      repositoryId: null,
      worktreeId: null,
      workingDirectory: null,
      agentType: "codex",
      status: "blocked",
      nextSeq: 1,
      lastActivityAt: null,
      lastError: null,
      workItemId: "work",
      workItemIdentifierSnapshot: "BOB-1",
      planningTaskId: null,
      createdAt: "2026-09-16",
      updatedAt: "2026-09-16",
    };
    expect(Schema.decodeUnknownSync(SessionSchema)(session)).toEqual(session);
    expect(
      Schema.decodeUnknownSync(SessionSchema)({ ...session, status: "queued" })
        .status,
    ).toBe("queued");
  });
  it("encodes the workflow service's awaiting-input result", () => {
    const state = {
      workflowStatus: "awaiting_input",
      statusMessage: "Need a decision",
      awaitingInput: {
        question: "Proceed?",
        options: ["yes", "no"],
        defaultAction: "no",
        expiresAt: "2026-09-16T12:00:00Z",
      },
    };
    expect(Schema.decodeUnknownSync(WorkflowStateSchema)(state)).toEqual(state);
  });
});

it("encodes a freshly inserted planning session before updatedAt is set", async () => {
  const { PlanSessionRecordSchema } =
    await import("../../../bob/src/contracts/schemas/planning-session.js");
  const fresh = {
    id: "s",
    userId: "u",
    agentType: "claude",
    workingDirectory: "/tmp",
    title: "Plan",
    sessionType: "planning",
    status: "provisioning",
    updatedAt: null,
  };
  expect(Schema.encodeSync(PlanSessionRecordSchema)(fresh)).toEqual(fresh);
  const session = {
    id: "s",
    title: null,
    repositoryId: null,
    worktreeId: null,
    workingDirectory: null,
    agentType: "claude",
    status: "provisioning",
    nextSeq: 1,
    lastActivityAt: null,
    lastError: null,
    workItemId: null,
    workItemIdentifierSnapshot: null,
    planningTaskId: null,
    createdAt: "2026-09-16",
    updatedAt: null,
  };
  expect(Schema.encodeSync(SessionSchema)(session)).toEqual(session);
});
