import { describe, expect, it } from "vitest";

import {
  buildRecentOutcomeItems,
  buildRecentlyCompletedItems,
  buildProviderCapacitySummaries,
  extractProviderCapacitySnapshotsFromRuns,
  getProviderCapacityHref,
  getProviderCapacityStatusLine,
  getRecentlyCompletedRowModel,
  getRecentlyCompletedWorkItemHref,
  getRunningNowScope,
  getWorkLaneRowModel,
  getWorkLaneTableHeaderModel,
  getWorkLaneEntryHref,
  getWorkLaneWorkItemHref,
  getWorkPipelineHeaderModel,
  getWorkPipelineSectionOrder,
  buildWorkLaneSummaries,
  buildWorkLaneSummariesFromCounts,
  filterWorkLaneItems,
  groupWorkPipelineItems,
} from "../work-pipeline-model";

describe("buildWorkLaneSummariesFromCounts", () => {
  it("maps uncapped per-status counts to the four lanes (fixes the starved firehose)", () => {
    // The exact shape that read 0 in the UI: 329 in_review saturating a
    // capped list, hiding 25 backlog + 8 in_progress. From counts, they show.
    const summaries = buildWorkLaneSummariesFromCounts({
      in_review: 329,
      backlog: 25,
      todo: 4,
      draft: 1,
      in_progress: 8,
      running: 0,
      blocked: 2,
      done: 25,
    });
    const byKey = Object.fromEntries(summaries.map((s) => [s.key, s.count]));
    expect(byKey["ready"]).toBe(30); // backlog 25 + todo 4 + draft 1
    expect(byKey["active"]).toBe(8); // in_progress 8 + running 0
    expect(byKey["review"]).toBe(329); // uncapped, not clamped to 100
    expect(byKey["needs-attention"]).toBe(2); // blocked
  });

  it("returns all four lanes at zero for an empty workspace", () => {
    const summaries = buildWorkLaneSummariesFromCounts({});
    expect(summaries.map((s) => s.key)).toEqual([
      "needs-attention",
      "ready",
      "active",
      "review",
    ]);
    expect(summaries.every((s) => s.count === 0)).toBe(true);
  });
});

describe("work pipeline model", () => {
  it("labels the dashboard summary boxes as Operations without explanatory copy", () => {
    expect(getWorkPipelineHeaderModel()).toEqual({
      title: "Operations",
      subtitle: null,
    });
  });

  it("labels lane drilldown tables without implementation-speak subtitles", () => {
    expect(getWorkLaneTableHeaderModel("needs-attention")).toEqual({
      title: "Needs Attention",
      subtitle: null,
    });
    expect(getWorkLaneTableHeaderModel("ready")).toEqual({
      title: "Ready",
      subtitle: null,
    });
  });

  it("groups work by lifecycle lane instead of recency", () => {
    const lanes = groupWorkPipelineItems([
      {
        id: "ready",
        identifier: "BOB-1",
        title: "Ready task",
        kind: "task",
        status: "ready",
      },
      {
        id: "active",
        identifier: "BOB-2",
        title: "Active task",
        kind: "task",
        status: "in_progress",
        agentStatus: { sessionId: "session-2", status: "running", agentType: "claude" },
      },
      {
        id: "review",
        identifier: "BOB-3",
        title: "Review task",
        kind: "task",
        status: "blocked",
      },
      {
        id: "done",
        identifier: "BOB-4",
        title: "Done task",
        kind: "task",
        status: "done",
      },
    ]);

    expect(lanes.active.map((item) => item.id)).toEqual(["active"]);
    expect(lanes.queued.map((item) => item.id)).toEqual(["ready"]);
    expect(lanes.review.map((item) => item.id)).toEqual(["review"]);
    expect(lanes.done.map((item) => item.id)).toEqual(["done"]);
  });

  it("builds summary-only operational lane cards", () => {
    const summaries = buildWorkLaneSummaries([
      {
        id: "blocked",
        identifier: "P1-1",
        title: "Blocked task",
        kind: "task",
        status: "blocked",
        queueSortOrder: 2,
      },
      {
        id: "ready",
        identifier: "P1-2",
        title: "Ready task",
        kind: "task",
        status: "ready",
        queueSortOrder: 1,
      },
      {
        id: "active",
        identifier: "P1-4",
        title: "Active task",
        kind: "task",
        status: "in_progress",
        queueSortOrder: 4,
      },
      {
        id: "review",
        identifier: "P1-3",
        title: "Review task",
        kind: "task",
        status: "in_review",
        queueSortOrder: 3,
      },
    ]);

    expect(summaries.map((lane) => [lane.key, lane.count])).toEqual([
      ["needs-attention", 1],
      ["ready", 1],
      ["active", 1],
      ["review", 1],
    ]);
    expect(summaries).toHaveLength(4);
    expect(summaries.some((lane) => "topReason" in lane)).toBe(false);
    expect(summaries.find((lane) => lane.key === "needs-attention")?.tone).toBe("danger");
  });

  it("filters the work items behind each operational summary box", () => {
    const items = [
      {
        id: "blocked",
        identifier: "P1-1",
        title: "Blocked task",
        kind: "task",
        status: "blocked",
      },
      {
        id: "failed",
        identifier: "P1-2",
        title: "Failed agent task",
        kind: "task",
        status: "ready",
        agentStatus: { sessionId: "s1", status: "failed", agentType: "codex" },
      },
      {
        id: "active-agent",
        identifier: "P1-9",
        title: "Ready task with running agent",
        kind: "task",
        status: "ready",
        agentStatus: { sessionId: "s2", status: "running", agentType: "codex" },
      },
      {
        id: "pending-agent",
        identifier: "P1-10",
        title: "Ready task with pending agent",
        kind: "task",
        status: "ready",
        agentStatus: { sessionId: "s3", status: "pending", agentType: "codex" },
      },
      {
        id: "queued-agent",
        identifier: "P1-11",
        title: "Ready task with queued agent",
        kind: "task",
        status: "ready",
        agentStatus: { sessionId: "s4", status: "queued", agentType: "cursor" },
      },
      {
        id: "errored",
        identifier: "P1-6",
        title: "Errored task",
        kind: "task",
        status: "error",
      },
      {
        id: "interrupted",
        identifier: "P1-7",
        title: "Interrupted task",
        kind: "task",
        status: "interrupted",
      },
      {
        id: "ready",
        identifier: "P1-3",
        title: "Ready task",
        kind: "task",
        status: "ready",
      },
      {
        id: "active",
        identifier: "P1-4",
        title: "Active task",
        kind: "task",
        status: "in_progress",
      },
      {
        id: "review",
        identifier: "P1-5",
        title: "Review task",
        kind: "task",
        status: "in_review",
      },
    ];

    expect(filterWorkLaneItems(items, "needs-attention").map((item) => item.id)).toEqual([
      "blocked",
      "failed",
      "errored",
      "interrupted",
    ]);
    expect(filterWorkLaneItems(items, "ready").map((item) => item.id)).toEqual([
      "ready",
    ]);
    expect(filterWorkLaneItems(items, "active").map((item) => item.id)).toEqual([
      "pending-agent",
      "queued-agent",
      "active",
      "active-agent",
    ]);
    expect(filterWorkLaneItems(items, "review").map((item) => item.id)).toEqual([
      "review",
    ]);
  });

  it("labels lane table rows from the authoritative lane state", () => {
    expect(
      getWorkLaneRowModel(
        {
          id: "failed-agent",
          identifier: "P1-8",
          title: "Ready task with failed agent",
          status: "ready",
          kind: "task",
          agentStatus: {
            sessionId: "session-8",
            status: "failed",
            agentType: "codex",
          },
        },
        "needs-attention",
      ),
    ).toMatchObject({
      status: "failed",
      statusLabel: "Failed",
      statusTone: "danger",
    });

    expect(
      getWorkLaneRowModel(
        {
          id: "active-agent",
          identifier: "P1-7",
          title: "Ready task with running agent",
          status: "ready",
          kind: "task",
          agentStatus: {
            sessionId: "session-7",
            status: "running",
            agentType: "codex",
          },
        },
        "active",
      ),
    ).toMatchObject({
      status: "running",
      statusLabel: "Running",
      statusTone: "success",
    });

    expect(
      getWorkLaneRowModel(
        {
          id: "pending-agent",
          identifier: "P1-10",
          title: "Ready task with pending agent",
          status: "ready",
          kind: "task",
          agentStatus: {
            sessionId: "session-10",
            status: "pending",
            agentType: "codex",
          },
        },
        "active",
      ),
    ).toMatchObject({
      status: "pending",
      statusLabel: "Pending",
      statusTone: "warning",
    });
  });

  it("keeps operational summary boxes scoped to task work", () => {
    const items = [
      {
        id: "blocked-task",
        identifier: "P1-1",
        title: "Blocked task",
        kind: "task",
        status: "blocked",
      },
      {
        id: "ready-task",
        identifier: "P1-2",
        title: "Ready task",
        kind: "task",
        status: "ready",
      },
      {
        id: "active-task",
        identifier: "P1-3",
        title: "Active task",
        kind: "task",
        status: "in_progress",
      },
      {
        id: "review-task",
        identifier: "P1-4",
        title: "Review task",
        kind: "task",
        status: "in_review",
      },
      {
        id: "blocked-project",
        identifier: "P1-5",
        title: "Blocked project",
        kind: "project",
        status: "blocked",
      },
      {
        id: "ready-issue",
        identifier: "P1-6",
        title: "Ready issue",
        kind: "issue",
        status: "ready",
      },
      {
        id: "active-issue",
        identifier: "P1-7",
        title: "Active issue",
        kind: "issue",
        status: "in_progress",
      },
      {
        id: "review-project",
        identifier: "P1-8",
        title: "Review project",
        kind: "project",
        status: "in_review",
      },
    ];

    expect(buildWorkLaneSummaries(items).map((lane) => [lane.key, lane.count])).toEqual([
      ["needs-attention", 1],
      ["ready", 1],
      ["active", 1],
      ["review", 1],
    ]);
    expect(filterWorkLaneItems(items, "needs-attention").map((item) => item.id)).toEqual([
      "blocked-task",
    ]);
    expect(filterWorkLaneItems(items, "ready").map((item) => item.id)).toEqual([
      "ready-task",
    ]);
    expect(filterWorkLaneItems(items, "active").map((item) => item.id)).toEqual([
      "active-task",
    ]);
    expect(filterWorkLaneItems(items, "review").map((item) => item.id)).toEqual([
      "review-task",
    ]);
  });

  it("routes failed needs-attention rows to outcome-forward detail", () => {
    expect(
      getWorkLaneEntryHref(
        {
          id: "failed-work",
          identifier: "P1-8",
          title: "Failed work",
          kind: "task",
          status: "failed",
        },
        "needs-attention",
      ),
    ).toBe("/work-items/failed-work?view=outcome");
  });

  it("includes review-ready work in recent outcomes without treating blocked work as reviewed", () => {
    const outcomes = buildRecentOutcomeItems([
      {
        id: "review",
        identifier: "BOB-1",
        title: "Ready for review",
        kind: "task",
        status: "in_review",
        updatedAt: "2026-05-31T11:00:00.000Z",
      },
      {
        id: "blocked",
        identifier: "BOB-2",
        title: "Blocked task",
        kind: "task",
        status: "blocked",
        updatedAt: "2026-05-31T12:00:00.000Z",
      },
      {
        id: "completed",
        identifier: "BOB-3",
        title: "Completed task",
        kind: "task",
        status: "completed",
        completedAt: "2026-05-31T10:00:00.000Z",
      },
    ]);

    expect(outcomes.map((item) => item.id)).toEqual(["review", "completed"]);
  });

  it("keeps recent outcomes scoped to task execution work", () => {
    const outcomes = buildRecentOutcomeItems([
      {
        id: "completed-task",
        identifier: "BOB-1",
        title: "Completed task",
        kind: "task",
        status: "completed",
        completedAt: "2026-05-31T10:00:00.000Z",
      },
      {
        id: "failed-task",
        identifier: "BOB-2",
        title: "Failed task",
        kind: "task",
        status: "failed",
        updatedAt: "2026-05-31T11:00:00.000Z",
      },
      {
        id: "review-project",
        identifier: "BOB-3",
        title: "Review project",
        kind: "project",
        status: "in_review",
        updatedAt: "2026-05-31T12:00:00.000Z",
      },
      {
        id: "completed-issue",
        identifier: "BOB-4",
        title: "Completed issue",
        kind: "issue",
        status: "completed",
        completedAt: "2026-05-31T13:00:00.000Z",
      },
      {
        id: "failed-project-agent",
        identifier: "BOB-5",
        title: "Failed project agent",
        kind: "project",
        status: "ready",
        updatedAt: "2026-05-31T14:00:00.000Z",
        agentStatus: { sessionId: "session-5", status: "failed", agentType: "codex" },
      },
    ]);

    expect(outcomes.map((item) => item.id)).toEqual(["failed-task", "completed-task"]);
  });

  it("includes terminal agent sessions in recent outcomes even when the task status is still ready", () => {
    const outcomes = buildRecentOutcomeItems([
      {
        id: "cancelled-agent",
        identifier: "BOB-10",
        title: "Cancelled execution",
        kind: "task",
        status: "ready",
        updatedAt: "2026-05-31T11:00:00.000Z",
        agentStatus: {
          sessionId: "session-cancelled",
          status: "cancelled",
          agentType: "codex",
        },
      },
      {
        id: "stopped-agent",
        identifier: "BOB-11",
        title: "Stopped execution",
        kind: "task",
        status: "ready",
        updatedAt: "2026-05-31T12:00:00.000Z",
        agentStatus: {
          sessionId: "session-stopped",
          status: "stopped",
          agentType: "cursor",
        },
      },
      {
        id: "ready",
        identifier: "BOB-12",
        title: "Ready task",
        kind: "task",
        status: "ready",
        updatedAt: "2026-05-31T13:00:00.000Z",
      },
    ]);

    expect(outcomes.map((item) => item.id)).toEqual([
      "stopped-agent",
      "cancelled-agent",
    ]);
  });

  it("summarizes Claude, Codex, Grok, and Cursor capacity from active sessions", () => {
    const cards = buildProviderCapacitySummaries({
      sessions: [
        { id: "codex-1", status: "running", agentType: "codex" },
        { id: "codex-2", status: "pending", agentType: "codex" },
        { id: "codex-3", status: "awaiting-input", agentType: "codex" },
        { id: "cursor-1", status: "failed", agentType: "cursor" },
        { id: "claude-1", status: "running", agentType: "claude" },
        { id: "grok-1", status: "pending", agentType: "grok" },
      ],
      workItems: [
        {
          id: "ready",
          identifier: "P1-2",
          title: "Ready task",
          kind: "task",
          status: "ready",
        },
        {
          id: "project",
          identifier: "P1-3",
          title: "Project setup",
          kind: "project",
          status: "ready",
        },
      ],
    });

    expect(cards.map((card) => card.provider)).toEqual([
      "claude",
      "codex",
      "grok",
      "cursor-agent",
    ]);
    expect(cards.find((card) => card.provider === "codex")).toMatchObject({
      label: "Codex",
      activeCount: 3,
      queuedOrStartingCount: 2,
      statusLabel: "Normal",
      usageLimits: [
        { label: "5 hour usage limit", remainingPercent: null },
        { label: "Weekly usage limit", remainingPercent: null },
      ],
    });
    expect(cards.find((card) => card.provider === "cursor-agent")).toMatchObject({
      label: "Cursor",
      activeCount: 0,
      queuedOrStartingCount: 0,
      statusLabel: "Recent failure",
      tone: "danger",
      usageLimits: [
        { label: "Included usage", remainingPercent: null },
        { label: "On-demand spend", remainingPercent: null },
      ],
    });
  });

  it("shows Bob-observed usage without inventing remaining allowance", () => {
    const snapshots = extractProviderCapacitySnapshotsFromRuns([{
      id: "grok-run",
      agentType: "grok",
      summary: {
        providerCapacity: {
          provider: "grok",
          collectedAt: "2026-07-11T18:00:00.000Z",
          allowance: { status: "unavailable", source: "provider" },
          observed: { source: "bob_metered", inputTokens: 120, outputTokens: 30 },
        },
      },
    }]);

    const card = buildProviderCapacitySummaries({
      sessions: [],
      workItems: [],
      capacitySnapshots: snapshots,
    }).find((entry) => entry.provider === "grok");

    expect(card).toMatchObject({
      limitLabel: "Capacity connected",
      usageLimits: [{
        label: "Bob observed usage",
        remainingPercent: null,
        valueLabel: "150 tokens",
      }],
    });
  });

  it("uses provider capacity snapshots from run summaries when available", () => {
    const snapshots = extractProviderCapacitySnapshotsFromRuns([
      {
        id: "run-1",
        agentType: "codex",
        summary: {
          providerCapacity: {
            usageLimits: [
              {
                label: "5 hour usage limit",
                remainingPercent: 42,
                resetLabel: "Resets May 31, 2026 12:11 AM",
              },
              {
                label: "Weekly usage limit",
                remainingPercent: 79,
                resetLabel: "Resets Jun 6, 2026 2:57 PM",
              },
            ],
          },
        },
      },
    ]);
    const cards = buildProviderCapacitySummaries({
      sessions: [],
      workItems: [],
      capacitySnapshots: snapshots,
    });

    expect(cards.find((card) => card.provider === "codex")).toMatchObject({
      limitLabel: "Capacity connected",
      usageLimits: [
        {
          label: "5 hour usage limit",
          remainingPercent: 42,
          resetLabel: "Resets May 31, 2026 12:11 AM",
        },
        {
          label: "Weekly usage limit",
          remainingPercent: 79,
          resetLabel: "Resets Jun 6, 2026 2:57 PM",
        },
      ],
    });
  });

  it("supports provider capacity snapshots that report current usage instead of remaining capacity", () => {
    const snapshots = extractProviderCapacitySnapshotsFromRuns([
      {
        id: "run-1",
        agentType: "cursor",
        summary: {
          providerCapacity: {
            usageLimits: [
              {
                label: "Included usage",
                usedPercent: 12,
                resetLabel: "Resets Jun 22, 2026",
              },
              {
                label: "On-demand spend",
                usedPercent: 0,
                valueLabel: "Disabled",
              },
            ],
          },
        },
      },
    ]);
    const cards = buildProviderCapacitySummaries({
      sessions: [],
      workItems: [],
      capacitySnapshots: snapshots,
    });

    expect(cards.find((card) => card.provider === "cursor-agent")).toMatchObject({
      limitLabel: "Capacity connected",
      usageLimits: [
        {
          label: "Included usage",
          remainingPercent: null,
          usedPercent: 12,
          barPercent: 12,
          valueLabel: "12% used",
          resetLabel: "Resets Jun 22, 2026",
        },
        {
          label: "On-demand spend",
          remainingPercent: null,
          usedPercent: 0,
          barPercent: 0,
          valueLabel: "Disabled",
        },
      ],
    });
  });

  it("formats provider capacity connection and health as a visible status line", () => {
    const card = buildProviderCapacitySummaries({
      sessions: [{ id: "codex-1", status: "running", agentType: "codex" }],
      workItems: [],
      capacitySnapshots: [
        {
          provider: "codex",
          usageLimits: [
            {
              label: "5 hour usage limit",
              remainingPercent: 42,
              resetLabel: null,
            },
          ],
        },
      ],
    }).find((entry) => entry.provider === "codex");

    if (!card) throw new Error("Expected Codex capacity card");
    expect(getProviderCapacityStatusLine(card)).toBe("Capacity connected · Normal");
  });

  it("keeps provider drilldowns and running rail scoped to the selected workspace", () => {
    expect(getProviderCapacityHref("codex", "workspace-1")).toBe(
      "/runs?provider=codex&workspace=workspace-1",
    );
    expect(getProviderCapacityHref("cursor-agent", null)).toBe("/runs?provider=cursor-agent");
    expect(getRunningNowScope("workspace-1")).toEqual({
      mode: "workspace",
      workspaceId: "workspace-1",
    });
    expect(getRunningNowScope(undefined)).toEqual({ mode: "all" });
  });

  it("lists recently completed work underneath the summary boxes", () => {
    const completed = buildRecentlyCompletedItems([
      {
        id: "old",
        identifier: "P1-1",
        title: "Old done task",
        kind: "task",
        status: "done",
        updatedAt: "2026-05-31T10:00:00.000Z",
      },
      {
        id: "new",
        identifier: "P1-2",
        title: "New done task",
        kind: "task",
        status: "completed",
        completedAt: "2026-05-31T11:00:00.000Z",
      },
      {
        id: "active",
        identifier: "P1-3",
        title: "Active task",
        kind: "task",
        status: "in_progress",
      },
      {
        id: "stopped",
        identifier: "P1-4",
        title: "Stopped task",
        kind: "task",
        status: "stopped",
        completedAt: "2026-05-31T12:00:00.000Z",
      },
    ]);

    expect(completed.map((item) => item.id)).toEqual(["stopped", "new", "old"]);
  });

  it("keeps recently completed scoped to task work", () => {
    const completed = buildRecentlyCompletedItems([
      {
        id: "completed-task",
        identifier: "BOB-1",
        title: "Completed task",
        kind: "task",
        status: "completed",
        completedAt: "2026-05-31T10:00:00.000Z",
      },
      {
        id: "completed-project",
        identifier: "BOB-2",
        title: "Completed project",
        kind: "project",
        status: "completed",
        completedAt: "2026-05-31T12:00:00.000Z",
      },
      {
        id: "stopped-task",
        identifier: "BOB-3",
        title: "Stopped task",
        kind: "task",
        status: "stopped",
        completedAt: "2026-05-31T11:00:00.000Z",
      },
    ]);

    expect(completed.map((item) => item.id)).toEqual(["stopped-task", "completed-task"]);
  });

  it("includes stale tasks with terminal agent status in recently completed work", () => {
    const completed = buildRecentlyCompletedItems([
      {
        id: "completed",
        identifier: "BOB-1",
        title: "Completed task",
        kind: "task",
        status: "completed",
        completedAt: "2026-05-31T10:00:00.000Z",
      },
      {
        id: "stale-stopped",
        identifier: "BOB-2",
        title: "Stopped stale task",
        kind: "task",
        status: "ready",
        updatedAt: "2026-05-31T11:00:00.000Z",
        agentStatus: {
          sessionId: "session-2",
          status: "stopped",
          agentType: "codex",
        },
      },
    ]);

    expect(completed.map((item) => item.id)).toEqual(["stale-stopped", "completed"]);
  });

  it("labels recently completed rows from terminal agent outcomes when task status is stale", () => {
    expect(
      getRecentlyCompletedRowModel({
        id: "stale-stopped",
        identifier: "BOB-2",
        title: "Stopped stale task",
        kind: "task",
        status: "ready",
        agentStatus: {
          sessionId: "session-2",
          status: "stopped",
          agentType: "codex",
        },
      }),
    ).toMatchObject({
      status: "stopped",
      statusLabel: "Stopped",
      statusTone: "default",
    });
  });

  it("places recently completed directly beneath the four summary boxes", () => {
    expect(getWorkPipelineSectionOrder()).toEqual([
      "summary-boxes",
      "recently-completed",
    ]);
  });

  it("routes recently completed rows into outcome-forward work item details", () => {
    expect(getRecentlyCompletedWorkItemHref("task-1")).toBe("/work-items/task-1?view=outcome");
    expect(getRecentlyCompletedWorkItemHref("task-1", "workspace-1")).toBe(
      "/work-items/task-1?view=outcome&workspace=workspace-1",
    );
  });

  it("routes lane table rows into task-forward work item details", () => {
    expect(getWorkLaneWorkItemHref("task-1")).toBe("/work-items/task-1?view=queue");
    expect(getWorkLaneWorkItemHref("task-1", "workspace-1")).toBe(
      "/work-items/task-1?view=queue&workspace=workspace-1",
    );
  });

  it("routes active and review lane rows into outcome-forward details", () => {
    const item = {
      id: "task-1",
      identifier: "BOB-1",
      title: "Active task",
      kind: "task",
      status: "in_progress",
    };

    expect(getWorkLaneEntryHref(item, "active")).toBe("/work-items/task-1?view=outcome");
    expect(getWorkLaneEntryHref(item, "active", "workspace-1")).toBe(
      "/work-items/task-1?view=outcome&workspace=workspace-1",
    );
    expect(getWorkLaneEntryHref({ ...item, status: "review" }, "review")).toBe(
      "/work-items/task-1?view=outcome",
    );
    expect(getWorkLaneEntryHref({ ...item, status: "ready" }, "ready")).toBe(
      "/work-items/task-1?view=queue",
    );
  });

  it("routes session-backed attention rows into outcome-forward details", () => {
    expect(
      getWorkLaneEntryHref(
        {
          id: "task-1",
          identifier: "BOB-1",
          title: "Failed task",
          kind: "task",
          status: "ready",
          agentStatus: {
            sessionId: "session-1",
            status: "failed",
            agentType: "codex",
          },
        },
        "needs-attention",
      ),
    ).toBe("/work-items/task-1?view=outcome");
  });
});
