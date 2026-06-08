import { describe, expect, it } from "vitest";

import {
  buildRunningNowRailRows,
  filterRunningNowRuns,
  getRunningNowRunHref,
} from "../running-now-rail-model";

describe("running now rail model", () => {
  it("keeps only in-progress execution sessions in the right rail", () => {
    const runs = filterRunningNowRuns([
      { id: "running", status: "running" },
      { id: "starting", status: "starting" },
      { id: "pending", status: "pending" },
      { id: "awaiting", status: "awaiting-input" },
      { id: "queued", status: "queued" },
      { id: "completed", status: "completed" },
      { id: "failed", status: "failed" },
    ]);

    expect(runs.map((run) => run.id)).toEqual([
      "running",
      "starting",
      "pending",
      "awaiting",
      "queued",
    ]);
  });

  it("opens linked active work items before falling back to the raw run page", () => {
    expect(
      getRunningNowRunHref({
        id: "run-1",
        status: "running",
        workItemId: "BOB-27",
      }),
    ).toBe("/work-items/BOB-27?view=outcome");
    expect(
      getRunningNowRunHref({
        id: "run-2",
        status: "running",
        workItemId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe("/work-items/11111111-1111-4111-8111-111111111111?view=outcome");
    expect(
      getRunningNowRunHref({
        id: "run-3",
        status: "running",
        workItemId: "legacy-title",
      }),
    ).toBe("/runs/run-3");
  });

  it("opens active execution sessions when a run has no resolvable work item", () => {
    expect(
      getRunningNowRunHref({
        id: "run-4",
        status: "running",
        workItemId: "legacy-title",
        sessionId: "session-4",
      }),
    ).toBe("/sessions/session-4");
    expect(
      getRunningNowRunHref({
        id: "run-5",
        status: "running",
        sessionId: "session-5",
      }),
    ).toBe("/sessions/session-5");
  });

  it("preserves workspace when opening running work from the live rail", () => {
    expect(
      getRunningNowRunHref(
        {
          id: "run-1",
          status: "running",
          workItemId: "BOB-27",
        },
        "workspace-1",
      ),
    ).toBe("/work-items/BOB-27?view=outcome&workspace=workspace-1");
    expect(
      getRunningNowRunHref(
        {
          id: "run-2",
          status: "running",
          sessionId: "session-2",
        },
        "workspace-1",
      ),
    ).toBe("/sessions/session-2?workspace=workspace-1");
    expect(
      getRunningNowRunHref(
        {
          id: "run-3",
          status: "running",
          workspaceId: "workspace-2",
        },
      ),
    ).toBe("/runs/run-3?workspace=workspace-2");
  });

  it("builds normalized Running Now rows with status, provider, and last activity", () => {
    const rows = buildRunningNowRailRows({
      runs: [
        {
          id: "run-1",
          title: "Implement queue controls",
          status: "running",
          agentType: "codex",
          workItemId: "BOB-27",
          updatedAt: "2026-05-31T12:00:00.000Z",
        },
        {
          id: "run-2",
          status: "completed",
          agentType: "cursor",
          updatedAt: "2026-05-31T12:01:00.000Z",
        },
        {
          id: "run-3",
          status: "starting",
          agentType: "cursor-agent",
          sessionId: "session-3",
          lastActivityAt: "2026-05-31T12:02:00.000Z",
        },
        {
          id: "run-4",
          status: "queued",
          agentType: "codex",
          sessionId: "session-4",
          lastActivityAt: "2026-05-31T12:01:30.000Z",
        },
      ],
      workspaceId: "workspace-1",
      now: new Date("2026-05-31T12:03:00.000Z"),
    });

    expect(rows).toEqual([
      {
        id: "run-3",
        title: "Cursor Agent",
        statusLabel: "Starting",
        statusTone: "warning",
        agentLabel: "Cursor",
        lastUpdatedLabel: "1m ago",
        href: "/sessions/session-3?workspace=workspace-1",
      },
      {
        id: "run-4",
        title: "Codex",
        statusLabel: "Queued",
        statusTone: "warning",
        agentLabel: "Codex",
        lastUpdatedLabel: "1m ago",
        href: "/sessions/session-4?workspace=workspace-1",
      },
      {
        id: "run-1",
        title: "Implement queue controls",
        statusLabel: "Running",
        statusTone: "success",
        agentLabel: "Codex",
        lastUpdatedLabel: "3m ago",
        href: "/work-items/BOB-27?view=outcome&workspace=workspace-1",
      },
    ]);
  });

  it("projects active task work items into Running Now and deduplicates linked runs", () => {
    const rows = buildRunningNowRailRows({
      workItems: [
        {
          id: "agent-running",
          identifier: "BOB-27",
          title: "Implement queue controls",
          kind: "task",
          status: "ready",
          updatedAt: "2026-05-31T12:01:00.000Z",
          agentStatus: {
            sessionId: "session-27",
            status: "running",
            agentType: "codex",
          },
        },
        {
          id: "running-work",
          identifier: "BOB-28",
          title: "Monitor release",
          kind: "task",
          status: "in_progress",
          updatedAt: "2026-05-31T12:00:00.000Z",
        },
        {
          id: "completed-work",
          identifier: "BOB-29",
          title: "Completed task",
          kind: "task",
          status: "completed",
          updatedAt: "2026-05-31T12:02:00.000Z",
        },
      ],
      runs: [
        {
          id: "linked-run",
          status: "running",
          title: "Duplicate linked run",
          agentType: "codex",
          workItemId: "agent-running",
          sessionId: "session-27",
          lastActivityAt: "2026-05-31T12:03:00.000Z",
        },
        {
          id: "session-only",
          status: "queued",
          title: "Queued session",
          agentType: "cursor",
          sessionId: "session-only",
          lastActivityAt: "2026-05-31T12:04:00.000Z",
        },
      ],
      workspaceId: "workspace-1",
      now: new Date("2026-05-31T12:05:00.000Z"),
    });

    expect(rows.map((row) => [row.id, row.href])).toEqual([
      ["session-only", "/sessions/session-only?workspace=workspace-1"],
      [
        "work-item:agent-running",
        "/work-items/agent-running?view=outcome&workspace=workspace-1",
      ],
      [
        "work-item:running-work",
        "/work-items/running-work?view=outcome&workspace=workspace-1",
      ],
    ]);
    expect(rows.find((row) => row.id === "work-item:agent-running")).toMatchObject({
      title: "BOB-27 · Implement queue controls",
      statusLabel: "Running",
      statusTone: "success",
      agentLabel: "Codex",
      lastUpdatedLabel: "4m ago",
    });
  });
});
