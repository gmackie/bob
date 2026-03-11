import { describe, expect, it, vi } from "vitest";
import {
  activities,
  agentSessions,
  agentTaskRuns,
  issues,
  issueArtifacts,
} from "@linear-clone/db";

import { agentRouter } from "../src/routers/agent";
import { issueArtifactRouter } from "../src/routers/issue-artifact";

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm",
  );

  return {
    ...actual,
    eq: (left: { name?: string }, right: unknown) => ({
      __kind: "eq",
      fieldName: left?.name,
      right,
    }),
    and: (...clauses: Array<{ __kind?: string }>) => ({
      __kind: "and",
      clauses,
    }),
    desc: (field: { name?: string }) => ({
      __kind: "desc",
      fieldName: field?.name,
    }),
  };
});

type RowState = {
  issues: Array<Record<string, unknown>>;
  agentSessions: Array<Record<string, unknown>>;
  agentTaskRuns: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>>;
  issueArtifacts: Array<Record<string, unknown>>;
};

function createFakeDb(initialState: Partial<RowState>) {
  const state: RowState = {
    issues: [...(initialState.issues ?? [])],
    agentSessions: [...(initialState.agentSessions ?? [])],
    agentTaskRuns: [...(initialState.agentTaskRuns ?? [])],
    activities: [...(initialState.activities ?? [])],
    issueArtifacts: [...(initialState.issueArtifacts ?? [])],
  };

  let idCounter = 0;

  function getRows(table: unknown) {
    if (table === issues) return state.issues;
    if (table === agentSessions) return state.agentSessions;
    if (table === agentTaskRuns) return state.agentTaskRuns;
    if (table === activities) return state.activities;
    if (table === issueArtifacts) return state.issueArtifacts;
    return [];
  }

  function matches(
    row: Record<string, unknown>,
    predicate: unknown,
  ): boolean {
    if (!predicate) return true;
    if (
      typeof predicate === "object" &&
      predicate !== null &&
      "__kind" in predicate
    ) {
      if (predicate.__kind === "eq") {
        const rawFieldName =
          (predicate as { fieldName?: string }).fieldName ?? "id";
        const fieldName =
          rawFieldName in row
            ? rawFieldName
            : rawFieldName.replace(/_([a-z])/g, (_, char: string) =>
                char.toUpperCase(),
              );
        return row[fieldName] === (predicate as { right: unknown }).right;
      }
      if (predicate.__kind === "and") {
        return (predicate as { clauses: unknown[] }).clauses.every((clause) =>
          matches(row, clause),
        );
      }
    }

    return true;
  }

  function createSelectChain(rows: Array<Record<string, unknown>>) {
    let currentRows = rows;

    const chain: {
      where: (predicate: unknown) => typeof chain;
      orderBy: () => typeof chain;
      limit: (count: number) => Promise<Array<Record<string, unknown>>>;
      then: (
        resolve: (value: Array<Record<string, unknown>>) => void,
        reject?: (error: unknown) => void,
      ) => Promise<unknown>;
    } = {} as never;

    chain.where = (predicate) => {
      currentRows = currentRows.filter((row) => matches(row, predicate));
      return chain;
    };
    chain.orderBy = () => chain;
    chain.limit = async (count) => currentRows.slice(0, count);
    chain.then = (resolve, reject) =>
      Promise.resolve(currentRows).then(resolve as never, reject as never);

    return chain;
  }

  return {
    state,
    db: {
      select: vi.fn(() => ({
        from: (table: unknown) => createSelectChain(getRows(table)),
      })),
      update: vi.fn((table: unknown) => ({
        set: (patch: Record<string, unknown>) => ({
          where: (predicate: unknown) => {
            const updated = getRows(table)
              .filter((row) => matches(row, predicate))
              .map((row) => Object.assign(row, patch));

            return {
              returning: async () => updated,
            };
          },
        }),
      })),
      insert: vi.fn((table: unknown) => ({
        values: (value: Record<string, unknown> | Array<Record<string, unknown>>) => {
          const rows = Array.isArray(value) ? value : [value];
          const inserted = rows.map((row) => ({
            ...row,
            id: row.id ?? `generated-${++idCounter}`,
          }));
          getRows(table).push(...inserted);

          return {
            returning: async () => inserted,
          };
        },
      })),
    },
  };
}

const actorId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const taskRunId = "44444444-4444-4444-8444-444444444444";
const promptCommentId = "55555555-5555-4555-8555-555555555555";

describe("Bob agent updates", () => {
  it("syncs Bob run state, persists prompt metadata, and ignores duplicate idempotency keys", async () => {
    const { db, state } = createFakeDb({
      issues: [{ id: issueId, status: "todo" }],
      agentSessions: [
        {
          id: sessionId,
          agentId: actorId,
          workspaceId: "66666666-6666-4666-8666-666666666666",
          executionBackend: "bob",
          status: "working",
          currentIssueId: issueId,
          lastSyncedAt: null,
        },
      ],
      agentTaskRuns: [
        {
          id: taskRunId,
          issueId,
          sessionId,
          agentId: actorId,
          status: "claimed",
          executionBackend: "bob",
          latestSummary: null,
          lastPromptCommentId: null,
          externalSessionId: null,
          externalSessionUrl: null,
          reviewUrl: null,
          completionSource: null,
        },
      ],
    });

    const caller = agentRouter.createCaller({
      userId: actorId,
      user: { id: actorId } as never,
      db,
      scopes: ["read", "write", "admin"],
      authMethod: "session",
    });

    await caller.syncBobRun({
      issueId,
      taskRunId,
      sessionId,
      executionBackend: "bob",
      externalSessionId: "bob-session-123",
      externalSessionUrl: "https://bob.example.internal/chat/session-123",
      sessionStatus: "working",
      workflowStatus: "awaiting_input",
      runStatus: "in_progress",
      latestSummary: "Need a product decision before proceeding",
      lastPromptCommentId: promptCommentId,
      reviewUrl: "https://github.com/acme/repo/pull/123",
      issueStatus: "in_progress",
      idempotencyKey: "idem-1",
    });

    await caller.syncBobRun({
      issueId,
      taskRunId,
      sessionId,
      executionBackend: "bob",
      externalSessionId: "bob-session-123",
      externalSessionUrl: "https://bob.example.internal/chat/session-123",
      sessionStatus: "working",
      workflowStatus: "awaiting_input",
      runStatus: "in_progress",
      latestSummary: "Need a product decision before proceeding",
      lastPromptCommentId: promptCommentId,
      reviewUrl: "https://github.com/acme/repo/pull/123",
      issueStatus: "in_progress",
      idempotencyKey: "idem-1",
    });

    expect(state.agentTaskRuns[0]).toMatchObject({
      status: "in_progress",
      latestSummary: "Need a product decision before proceeding",
      lastPromptCommentId: promptCommentId,
      externalSessionId: "bob-session-123",
      externalSessionUrl: "https://bob.example.internal/chat/session-123",
      reviewUrl: "https://github.com/acme/repo/pull/123",
      executionBackend: "bob",
    });
    expect(state.agentSessions[0]).toMatchObject({
      externalSessionId: "bob-session-123",
      externalSessionUrl: "https://bob.example.internal/chat/session-123",
      workflowStatus: "awaiting_input",
      status: "working",
      currentIssueId: issueId,
    });
    expect(state.issues[0]?.status).toBe("in_progress");
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]?.metadata).toMatchObject({
      idempotencyKey: "idem-1",
      lastPromptCommentId: promptCommentId,
      workflowStatus: "awaiting_input",
    });
  });

  it("creates issue artifacts and keeps only the latest artifact current for a role", async () => {
    const { db, state } = createFakeDb({
      issueArtifacts: [
        {
          id: "existing-artifact",
          issueId,
          agentTaskRunId: taskRunId,
          executionBackend: "bob",
          producerType: "bob",
          producerId: "artifact-1",
          artifactType: "pr",
          artifactRole: "review",
          url: "https://github.com/acme/repo/pull/1",
          title: "Old PR",
          isCurrent: true,
        },
      ],
    });

    const caller = issueArtifactRouter.createCaller({
      userId: actorId,
      user: { id: actorId } as never,
      db,
      scopes: ["read", "write", "admin"],
      authMethod: "session",
    });

    const created = await caller.create({
      issueId,
      agentTaskRunId: taskRunId,
      executionBackend: "bob",
      producerType: "bob",
      producerId: "artifact-2",
      artifactType: "pr",
      artifactRole: "review",
      url: "https://github.com/acme/repo/pull/2",
      title: "New PR",
      summary: "Ready for review",
    });

    expect(created).toMatchObject({
      issueId,
      artifactRole: "review",
      isCurrent: true,
      url: "https://github.com/acme/repo/pull/2",
    });
    expect(state.issueArtifacts).toHaveLength(2);
    expect(state.issueArtifacts[0]?.isCurrent).toBe(false);
    expect(state.issueArtifacts[1]?.isCurrent).toBe(true);
  });

  it("lists Bob run history for an issue with session workflow context", async () => {
    const { db } = createFakeDb({
      agentSessions: [
        {
          id: "session-latest",
          agentId: actorId,
          workspaceId: "77777777-7777-4777-8777-777777777777",
          executionBackend: "bob",
          workflowStatus: "awaiting_input",
          status: "working",
        },
        {
          id: "session-older",
          agentId: actorId,
          workspaceId: "77777777-7777-4777-8777-777777777777",
          executionBackend: "bob",
          workflowStatus: "paused",
          status: "paused",
        },
      ],
      agentTaskRuns: [
        {
          id: "run-latest",
          agentId: actorId,
          issueId,
          sessionId: "session-latest",
          status: "in_progress",
          executionBackend: "bob",
          latestSummary: "Need a final copy edit",
          externalSessionUrl: "https://bob.example/sessions/latest",
          claimedAt: new Date("2026-03-10T12:00:00.000Z"),
        },
        {
          id: "run-older",
          agentId: actorId,
          issueId,
          sessionId: "session-older",
          status: "handed_off",
          executionBackend: "bob",
          latestSummary: "Handed off to design review",
          externalSessionUrl: "https://bob.example/sessions/older",
          claimedAt: new Date("2026-03-09T12:00:00.000Z"),
        },
      ],
    });

    const caller = agentRouter.createCaller({
      userId: actorId,
      user: { id: actorId } as never,
      db,
      scopes: ["read", "write", "admin"],
      authMethod: "session",
    });

    const runs = await caller.listIssueRuns({ issueId, limit: 5 });

    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      id: "run-latest",
      status: "in_progress",
      latestSummary: "Need a final copy edit",
      session: {
        id: "session-latest",
        workflowStatus: "awaiting_input",
      },
    });
    expect(runs[1]).toMatchObject({
      id: "run-older",
      status: "handed_off",
      session: {
        id: "session-older",
        workflowStatus: "paused",
      },
    });
  });
});
