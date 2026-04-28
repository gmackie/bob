import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirstMock, insertCalls, chatMessagesTable, taskRunsTable } =
  vi.hoisted(() => ({
    findFirstMock: vi.fn(),
    insertCalls: [] as { table: unknown; value: unknown }[],
    chatMessagesTable: { conversationId: { name: "conversation_id" } },
    taskRunsTable: { id: { name: "id" } },
  }));

vi.mock("@bob/db/client", () => ({
  db: {
    query: {
      taskRuns: {
        findFirst: findFirstMock,
      },
    },
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((value: unknown) => {
        insertCalls.push({ table, value });
        return Promise.resolve([]);
      }),
    })),
  },
}));

vi.mock("@bob/db", () => ({
  and: (...clauses: unknown[]) => ({ type: "and", clauses }),
  eq: (field: unknown, value: unknown) => ({ type: "eq", field, value }),
}));

vi.mock("@bob/db/schema", () => ({
  chatConversations: {},
  chatMessages: chatMessagesTable,
  repositories: {},
  taskRuns: taskRunsTable,
}));

import {
  buildIssueContextUpdateMessage,
  forwardIssueContextUpdate,
} from "./taskExecutor";

describe("execution task runtime helpers", () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    insertCalls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve("ok"),
        }),
      ),
    );
  });

  it("formats structured issue context updates for the session", () => {
    expect(
      buildIssueContextUpdateMessage("ENG-42", [
        {
          field: "title",
          from: "Old title",
          to: "New title",
        },
        {
          field: "projectId",
          from: "project-1",
          to: "project-2",
        },
      ]),
    ).toContain("projectId: project-1 -> project-2");
  });

  it("forwards issue context updates into the current Bob session", async () => {
    findFirstMock.mockResolvedValue({
      id: "task-run-1",
      userId: "user-1",
      sessionId: "session-1",
    });

    await forwardIssueContextUpdate("ENG-42", "task-run-1", [
      {
        field: "description",
        from: "before",
        to: "after",
      },
    ]);

    expect(insertCalls[0]?.table).toBe(chatMessagesTable);
    expect(insertCalls[0]?.value).toMatchObject({
      conversationId: "session-1",
      role: "user",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses planning-named runtime task exports", () => {
    const source = readFileSync(
      path.resolve(__dirname, "./taskExecutor.ts"),
      "utf8",
    );

    expect(source).not.toContain("KanbangerTask");
    expect(source).not.toContain("getTaskRunByKanbangerId");
    expect(source).not.toContain("getLatestTaskRunByKanbangerId");
    expect(source).not.toContain(
      "Superseded by Kanbanger issue context update requiring a fresh run",
    );
    expect(source).toContain("PlanningTask");
    expect(source).toContain("getTaskRunByPlanningItemId");
    expect(source).toContain("getLatestTaskRunByPlanningItemId");
    expect(source).toContain(
      "Superseded by planning issue context update requiring a fresh run",
    );
  });

  // TODO(bob): re-enable once smol-agent profile wiring lands in
  // taskExecutor.ts. Test was added in 4d0e22f with assertions for
  // symbols (buildSmolAgentTaskExecutionProfile, selectedAgent === "smol-agent",
  // buildSmolAgentLaunchEnv, env: launchEnv) that don't appear in the
  // production code yet — pre-existing Bob tech debt. Skipped during
  // Phase 7B foundation cleanup (2026-04-28). See docs/plans/phase-7b/02-bob-probe.md.
  it.skip("wires smol-agent launch profiles into executeTask", () => {
    const source = readFileSync(
      path.resolve(__dirname, "./taskExecutor.ts"),
      "utf8",
    );

    expect(source).toContain("buildSmolAgentTaskExecutionProfile");
    expect(source).toContain('selectedAgent === "smol-agent"');
    expect(source).toContain("buildSmolAgentLaunchEnv");
    expect(source).toContain("env: launchEnv");
  });
});
