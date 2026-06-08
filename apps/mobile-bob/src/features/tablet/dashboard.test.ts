import { describe, expect, it } from "vitest";

import {
  buildActiveWorkItems,
  buildRunningNowEntries,
  buildRecentOutcomeWorkItems,
  buildRecentlyCompletedWorkItems,
  buildProviderCapacityCards,
  getTabletDashboardSectionOrder,
  getProviderRunsScope,
  getRunningNowWorkItemTarget,
  buildProviderRunGroups,
  buildProviderRunRowModel,
  buildProviderRunSectionModels,
  getMobileProviderRunHref,
  getProviderRunTarget,
  getProviderRunHref,
  getRecentOutcomeRowModel,
  getRecentlyCompletedRowModel,
  getProviderCapacityStatusLine,
  extractProviderCapacitySnapshotsFromRuns,
  getRecentOutcomeWorkItemStatus,
  getTaskLaneRowModel,
  getTaskLaneWorkItemTarget,
  buildTaskLaneSummaries,
  getTaskDashboardHeaderModel,
  getTaskDashboardLayout,
  formatProviderRunTitle,
  filterTaskLaneWorkItems,
  filterProviderRuns,
  normalizeProviderKey,
} from "./dashboard";
import type {
  TabletDashboardSession,
  TabletDashboardWorkItem,
} from "./dashboard";

const sessions: TabletDashboardSession[] = [
  {
    sessionId: "codex-running",
    status: "running",
    agentType: "codex",
    lastActivityAt: "2026-05-31T11:00:00.000Z",
  },
  {
    sessionId: "codex-awaiting",
    status: "awaiting-input",
    agentType: "codex",
    lastActivityAt: "2026-05-31T11:02:00.000Z",
  },
  {
    sessionId: "cursor-starting",
    status: "starting",
    agentType: "cursor",
    lastActivityAt: "2026-05-31T11:01:00.000Z",
  },
  {
    sessionId: "cursor-failed",
    status: "error",
    agentType: "cursor",
    lastActivityAt: "2026-05-31T10:00:00.000Z",
  },
];

const workItems: TabletDashboardWorkItem[] = [
  {
    id: "blocked",
    identifier: "P1-1",
    title: "Blocked task",
    status: "blocked",
    kind: "task",
    queueSortOrder: 10,
  },
  {
    id: "review",
    identifier: "P1-2",
    title: "Review task",
    status: "in_review",
    kind: "task",
    queueSortOrder: 20,
  },
  {
    id: "ready",
    identifier: "P1-3",
    title: "Ready task",
    status: "ready",
    kind: "task",
    queueSortOrder: 1,
  },
  {
    id: "active",
    identifier: "P1-4",
    title: "Active task",
    status: "in_progress",
    kind: "task",
    queueSortOrder: 4,
  },
];

describe("tablet task dashboard model", () => {
  it("keeps the Tasks dashboard header free of explanatory copy", () => {
    expect(getTaskDashboardHeaderModel()).toEqual({
      title: "Tasks",
      subtitle: null,
    });
  });

  it("builds first-class Codex and Cursor capacity cards", () => {
    const cards = buildProviderCapacityCards({
      sessions,
      workItems: [
        ...workItems,
        {
          id: "project",
          identifier: "P1-9",
          title: "Project setup",
          status: "ready",
          kind: "project",
        },
      ],
    });

    expect(cards.map((card) => card.provider)).toEqual(["codex", "cursor"]);
    expect(cards[0]).toMatchObject({
      label: "Codex",
      activeCount: 2,
      queuedOrStartingCount: 1,
      statusLabel: "Normal",
      usageLimits: [
        { label: "5 hour usage limit", remainingPercent: null },
        { label: "Weekly usage limit", remainingPercent: null },
      ],
    });
    expect(cards[1]).toMatchObject({
      label: "Cursor",
      activeCount: 1,
      queuedOrStartingCount: 1,
      statusLabel: "Recent failure",
      tone: "danger",
      usageLimits: [
        { label: "Included usage", remainingPercent: null },
        { label: "On-demand spend", remainingPercent: null },
      ],
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
    const cards = buildProviderCapacityCards({
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
    const cards = buildProviderCapacityCards({
      sessions: [],
      workItems: [],
      capacitySnapshots: snapshots,
    });

    expect(cards.find((card) => card.provider === "cursor")).toMatchObject({
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
    const [card] = buildProviderCapacityCards({
      sessions: [{ sessionId: "codex-1", status: "running", agentType: "codex", lastActivityAt: "2026-05-31T12:00:00.000Z" }],
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
    });

    if (!card) throw new Error("Expected Codex capacity card");
    expect(getProviderCapacityStatusLine(card)).toBe("Capacity connected · Normal");
  });

  it("scopes provider run history to the selected workspace when available", () => {
    expect(getProviderRunsScope("workspace-1")).toEqual({
      mode: "workspace",
      workspaceId: "workspace-1",
    });
    expect(getProviderRunsScope(null)).toEqual({ mode: "all" });
  });

  it("summarizes operational boxes without exposing task lists by default", () => {
    const lanes = buildTaskLaneSummaries(workItems);

    expect(lanes.map((lane) => [lane.key, lane.count])).toEqual([
      ["needs-attention", 1],
      ["ready", 1],
      ["active", 1],
      ["review", 1],
    ]);
    expect(lanes).toHaveLength(4);
    expect(lanes.some((lane) => "topReason" in lane)).toBe(false);
    expect(lanes.find((lane) => lane.key === "needs-attention")?.tone).toBe("danger");
  });

  it("keeps tablet landscape operation boxes in one row", () => {
    expect(getTaskDashboardLayout(1133)).toMatchObject({
      showRightRail: true,
      liveRailPresentation: "rail",
      laneWrap: "nowrap",
      laneCardMinWidth: 0,
      providerFooterDirection: "column",
    });
  });

  it("presents the live rail as a sheet control on phone widths", () => {
    expect(getTaskDashboardLayout(390)).toMatchObject({
      showRightRail: false,
      liveRailPresentation: "sheet",
      laneWrap: "wrap",
      laneCardMinWidth: 132,
      providerFooterDirection: "row",
    });
  });

  it("filters the work items behind each operational summary box", () => {
    const laneItems = filterTaskLaneWorkItems(
      [
        ...workItems,
        {
          id: "failed-status",
          identifier: "P1-5",
          title: "Failed status task",
          status: "failed",
          kind: "task",
          queueSortOrder: 30,
        },
        {
          id: "interrupted-status",
          identifier: "P1-6",
          title: "Interrupted status task",
          status: "interrupted",
          kind: "task",
          queueSortOrder: 40,
        },
        {
          id: "active-agent",
          identifier: "P1-7",
          title: "Ready task with running agent",
          status: "ready",
          kind: "task",
          queueSortOrder: 5,
          agentStatus: {
            sessionId: "session-7",
            status: "running",
            agentType: "codex",
          },
        },
        {
          id: "failed-agent",
          identifier: "P1-8",
          title: "Ready task with failed agent",
          status: "ready",
          kind: "task",
          queueSortOrder: 6,
          agentStatus: {
            sessionId: "session-8",
            status: "failed",
            agentType: "codex",
          },
        },
      ],
      "needs-attention",
    );

    expect(laneItems.map((item) => item.id)).toEqual([
      "failed-agent",
      "blocked",
      "failed-status",
      "interrupted-status",
    ]);
    const mixedItems = [
      ...workItems,
      {
        id: "active-agent",
        identifier: "P1-7",
        title: "Ready task with running agent",
        status: "ready",
        kind: "task",
        queueSortOrder: 5,
        agentStatus: {
          sessionId: "session-7",
          status: "running",
          agentType: "codex",
        },
      },
      {
        id: "failed-agent",
        identifier: "P1-8",
        title: "Ready task with failed agent",
        status: "ready",
        kind: "task",
        queueSortOrder: 6,
        agentStatus: {
          sessionId: "session-8",
          status: "failed",
          agentType: "codex",
        },
      },
    ];
    expect(filterTaskLaneWorkItems(mixedItems, "ready").map((item) => item.id)).toEqual([
      "ready",
    ]);
    expect(filterTaskLaneWorkItems(mixedItems, "active").map((item) => item.id)).toEqual([
      "active",
      "active-agent",
    ]);
    expect(filterTaskLaneWorkItems(workItems, "review").map((item) => item.id)).toEqual([
      "review",
    ]);
  });

  it("labels task lane table rows from the authoritative lane state", () => {
    expect(
      getTaskLaneRowModel(
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
    });

    expect(
      getTaskLaneRowModel(
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
    });
  });

  it("keeps operation boxes scoped to task work", () => {
    const mixedWorkItems: TabletDashboardWorkItem[] = [
      ...workItems,
      {
        id: "blocked-project",
        identifier: "P1-5",
        title: "Blocked project",
        status: "blocked",
        kind: "project",
      },
      {
        id: "ready-issue",
        identifier: "P1-6",
        title: "Ready issue",
        status: "ready",
        kind: "issue",
      },
      {
        id: "active-issue",
        identifier: "P1-7",
        title: "Active issue",
        status: "in_progress",
        kind: "issue",
      },
      {
        id: "review-project",
        identifier: "P1-8",
        title: "Review project",
        status: "in_review",
        kind: "project",
      },
    ];

    expect(buildTaskLaneSummaries(mixedWorkItems).map((lane) => [lane.key, lane.count])).toEqual([
      ["needs-attention", 1],
      ["ready", 1],
      ["active", 1],
      ["review", 1],
    ]);
    expect(filterTaskLaneWorkItems(mixedWorkItems, "needs-attention").map((item) => item.id)).toEqual([
      "blocked",
    ]);
    expect(filterTaskLaneWorkItems(mixedWorkItems, "ready").map((item) => item.id)).toEqual([
      "ready",
    ]);
    expect(filterTaskLaneWorkItems(mixedWorkItems, "active").map((item) => item.id)).toEqual([
      "active",
    ]);
    expect(filterTaskLaneWorkItems(mixedWorkItems, "review").map((item) => item.id)).toEqual([
      "review",
    ]);
  });

  it("filters provider detail runs", () => {
    const runs = [
      { id: "codex", agentType: "codex" },
      { id: "cursor", agentType: "cursor-agent" },
      { id: "claude", agentType: "claude" },
    ];

    expect(normalizeProviderKey("codex")).toBe("codex");
    expect(normalizeProviderKey("cursor")).toBe("cursor");
    expect(normalizeProviderKey("bad")).toBe("codex");
    expect(filterProviderRuns(runs, "codex").map((run) => run.id)).toEqual([
      "codex",
      "claude",
    ]);
    expect(filterProviderRuns(runs, "cursor").map((run) => run.id)).toEqual([
      "cursor",
    ]);
  });

  it("groups provider detail runs into active, failed, and completed sections", () => {
    const groups = buildProviderRunGroups([
      { id: "queued", status: "queued", agentType: "codex" },
      { id: "pending", status: "pending", agentType: "codex" },
      { id: "running", status: "running", agentType: "codex" },
      { id: "failed", status: "failed", agentType: "codex" },
      { id: "error", status: "error", agentType: "codex" },
      { id: "completed", status: "completed", agentType: "codex" },
      { id: "done", status: "done", agentType: "codex" },
    ]);

    expect(groups.active.map((run) => run.id)).toEqual(["queued", "pending", "running"]);
    expect(groups.failed.map((run) => run.id)).toEqual(["failed", "error"]);
    expect(groups.completed.map((run) => run.id)).toEqual(["completed", "done"]);
    expect(groups.metrics).toEqual({
      total: 7,
      active: 3,
      failed: 2,
      completed: 2,
    });
  });

  it("builds readable provider detail sections for the tablet provider pane", () => {
    const sections = buildProviderRunSectionModels(
      [
        {
          id: "awaiting",
          status: "awaiting_input",
          agentType: "cursor-agent",
          sessionId: "session-awaiting",
          lastActivityAt: "2026-05-31T11:58:00.000Z",
          session: { title: "Awaiting approval" },
        },
        {
          id: "failed",
          status: "failed",
          agentType: "codex",
          workItemId: "BOB-27",
          updatedAt: "2026-05-31T11:45:00.000Z",
        },
        {
          id: "done",
          status: "completed",
          agentType: "codex",
          workItemId: "BOB-28",
          completedAt: "2026-05-31T11:00:00.000Z",
        },
      ],
      { now: new Date("2026-05-31T12:00:00.000Z") },
    );

    expect(sections.map((section) => [section.key, section.title, section.count])).toEqual([
      ["active", "Active Sessions", 1],
      ["failed", "Failed Tasks", 1],
      ["completed", "Completed Tasks", 1],
    ]);
    expect(sections[0]?.rows[0]).toMatchObject({
      id: "awaiting",
      title: "Awaiting approval",
      statusLabel: "Awaiting Input",
      statusTone: "warning",
      agentLabel: "Cursor",
      lastUpdatedLabel: "2m ago",
    });
    expect(sections[1]?.rows[0]).toMatchObject({
      id: "failed",
      title: "BOB-27",
      statusLabel: "Failed",
      statusTone: "danger",
      agentLabel: "Codex",
      lastUpdatedLabel: "15m ago",
    });
  });

  it("formats provider run titles from linked session or work item data", () => {
    expect(
      formatProviderRunTitle({
        id: "run-1",
        status: "completed",
        workItemId: "task-1",
        session: { title: "Run provider detail" },
      }),
    ).toBe("Run provider detail");
    expect(formatProviderRunTitle({ id: "run-2", status: "completed", workItemId: "task-2" })).toBe("task-2");
    expect(formatProviderRunTitle({ id: "run-3", status: "completed" })).toBe("run-3");
  });

  it("routes linked provider runs into outcome-forward work item details", () => {
    expect(
      getProviderRunHref({
        id: "run-1",
        status: "completed",
        workItemId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe("/work-items/11111111-1111-4111-8111-111111111111?view=outcome");
    expect(getProviderRunHref({ id: "run-2", status: "completed", workItemId: "BOB-27" })).toBe(
      "/work-items/BOB-27?view=outcome",
    );
    expect(getProviderRunHref({ id: "run-2", status: "completed", workItemId: "legacy-title" })).toBe(
      "/runs/run-2",
    );
    expect(
      getProviderRunHref(
        { id: "run-3", status: "completed", workItemId: "BOB-27" },
        "workspace-1",
      ),
    ).toBe("/work-items/BOB-27?view=outcome&workspace=workspace-1");
    expect(getProviderRunHref({ id: "run-4", status: "completed" }, "workspace-1")).toBe(
      "/runs/run-4?workspace=workspace-1",
    );
  });

  it("targets provider run drilldowns inside the tablet shell when possible", () => {
    expect(
      getProviderRunTarget({
        id: "run-1",
        status: "completed",
        workItemId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toEqual({
      type: "work-item",
      workItemId: "11111111-1111-4111-8111-111111111111",
      view: "outcome",
    });
    expect(
      getProviderRunTarget({
        id: "run-2",
        status: "completed",
        workItemId: "BOB-27",
      }),
    ).toEqual({
      type: "work-item",
      workItemId: "BOB-27",
      view: "outcome",
    });
    expect(
      getProviderRunTarget({
        id: "run-2",
        status: "running",
        sessionId: "session-1",
      }),
    ).toEqual({ type: "execution-session", sessionId: "session-1" });
    expect(getProviderRunTarget({ id: "run-3", status: "completed" })).toEqual({
      type: "none",
    });
  });

  it("targets active provider rows to the live session before linked work item outcomes", () => {
    expect(
      getProviderRunTarget({
        id: "run-1",
        status: "running",
        sessionId: "session-1",
        workItemId: "BOB-27",
      }),
    ).toEqual({ type: "execution-session", sessionId: "session-1" });
  });

  it("routes mobile provider run drilldowns to native work item or session output screens", () => {
    expect(
      getMobileProviderRunHref({
        id: "run-1",
        status: "completed",
        workItemId: "BOB-1001",
      }, "workspace-1"),
    ).toBe("/work-items/BOB-1001?view=outcome&workspace=workspace-1");

    expect(
      getMobileProviderRunHref({
        id: "run-2",
        status: "running",
        sessionId: "session-2",
      }, "workspace-1"),
    ).toBe("/sessions/session-2?workspace=workspace-1");

    expect(
      getMobileProviderRunHref({
        id: "run-3",
        status: "completed",
      }),
    ).toBeNull();
  });

  it("builds readable mobile provider run rows with status, provider, and activity", () => {
    expect(
      buildProviderRunRowModel(
        {
          id: "run-1",
          status: "awaiting_input",
          agentType: "cursor-agent",
          session: { title: "Awaiting approval" },
          completedAt: "2026-05-31T11:55:00.000Z",
          updatedAt: "2026-05-31T11:58:00.000Z",
          createdAt: "2026-05-31T11:00:00.000Z",
        },
        { now: new Date("2026-05-31T12:00:00.000Z") },
      ),
    ).toEqual({
      title: "Awaiting approval",
      statusLabel: "Awaiting Input",
      statusTone: "warning",
      agentLabel: "Cursor",
      lastUpdatedLabel: "2m ago",
      accessibilityLabel: "Awaiting approval, Awaiting Input, Cursor, 2m ago",
    });
    expect(buildProviderRunRowModel({ id: "review", status: "in_review" })).toMatchObject({
      statusLabel: "In Review",
      statusTone: "warning",
    });
  });

  it("lists recently completed work under the summary boxes", () => {
    const completed = buildRecentlyCompletedWorkItems([
      {
        id: "old",
        identifier: "P1-1",
        title: "Old done task",
        status: "done",
        kind: "task",
        updatedAt: "2026-05-31T10:00:00.000Z",
      },
      {
        id: "new",
        identifier: "P1-2",
        title: "New completed task",
        status: "completed",
        kind: "task",
        completedAt: "2026-05-31T11:00:00.000Z",
      },
      {
        id: "active",
        identifier: "P1-3",
        title: "Active task",
        status: "in_progress",
        kind: "task",
      },
      {
        id: "stopped",
        identifier: "P1-4",
        title: "Stopped task",
        status: "stopped",
        kind: "task",
        completedAt: "2026-05-31T12:00:00.000Z",
      },
    ]);

    expect(completed.map((item) => item.id)).toEqual(["stopped", "new", "old"]);
  });

  it("keeps recently completed scoped to task work", () => {
    const completed = buildRecentlyCompletedWorkItems([
      {
        id: "completed-task",
        identifier: "P1-1",
        title: "Completed task",
        status: "completed",
        kind: "task",
        completedAt: "2026-05-31T10:00:00.000Z",
      },
      {
        id: "completed-project",
        identifier: "P1-2",
        title: "Completed project",
        status: "completed",
        kind: "project",
        completedAt: "2026-05-31T12:00:00.000Z",
      },
      {
        id: "stopped-task",
        identifier: "P1-3",
        title: "Stopped task",
        status: "stopped",
        kind: "task",
        completedAt: "2026-05-31T11:00:00.000Z",
      },
    ]);

    expect(completed.map((item) => item.id)).toEqual(["stopped-task", "completed-task"]);
  });

  it("includes stale tasks with terminal agent status in recently completed work", () => {
    const completed = buildRecentlyCompletedWorkItems([
      {
        id: "completed",
        identifier: "P1-1",
        title: "Completed task",
        status: "completed",
        kind: "task",
        completedAt: "2026-05-31T10:00:00.000Z",
      },
      {
        id: "stale-stopped",
        identifier: "P1-2",
        title: "Stopped stale task",
        status: "ready",
        kind: "task",
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
        identifier: "P1-2",
        title: "Stopped stale task",
        status: "ready",
        kind: "task",
        agentStatus: {
          sessionId: "session-2",
          status: "stopped",
          agentType: "codex",
        },
      }),
    ).toMatchObject({
      status: "stopped",
      statusLabel: "Stopped",
      badgeVariant: "accent",
    });
  });

  it("projects recent outcomes from completed, reviewed, and failed work items", () => {
    const outcomes = buildRecentOutcomeWorkItems([
      {
        id: "ready",
        identifier: "P1-1",
        title: "Ready task",
        kind: "task",
        status: "ready",
        updatedAt: "2026-05-31T12:00:00.000Z",
      },
      {
        id: "review",
        identifier: "P1-2",
        title: "Review task",
        kind: "task",
        status: "in_review",
        updatedAt: "2026-05-31T11:00:00.000Z",
      },
      {
        id: "failed-agent",
        identifier: "P1-3",
        title: "Failed agent task",
        kind: "task",
        status: "ready",
        updatedAt: "2026-05-31T11:30:00.000Z",
        agentStatus: { sessionId: "s1", status: "failed", agentType: "codex" },
      },
      {
        id: "completed",
        identifier: "P1-4",
        title: "Completed task",
        kind: "task",
        status: "completed",
        completedAt: "2026-05-31T10:00:00.000Z",
      },
    ]);

    expect(outcomes.map((item) => item.id)).toEqual([
      "failed-agent",
      "review",
      "completed",
    ]);
  });

  it("keeps recent outcomes scoped to task execution work", () => {
    const outcomes = buildRecentOutcomeWorkItems([
      {
        id: "completed-task",
        identifier: "P1-1",
        title: "Completed task",
        kind: "task",
        status: "completed",
        completedAt: "2026-05-31T10:00:00.000Z",
      },
      {
        id: "failed-task",
        identifier: "P1-2",
        title: "Failed task",
        kind: "task",
        status: "failed",
        updatedAt: "2026-05-31T11:00:00.000Z",
      },
      {
        id: "review-project",
        identifier: "P1-3",
        title: "Review project",
        kind: "project",
        status: "in_review",
        updatedAt: "2026-05-31T12:00:00.000Z",
      },
      {
        id: "completed-issue",
        identifier: "P1-4",
        title: "Completed issue",
        kind: "issue",
        status: "completed",
        completedAt: "2026-05-31T13:00:00.000Z",
      },
      {
        id: "failed-project-agent",
        identifier: "P1-5",
        title: "Failed project agent",
        kind: "project",
        status: "ready",
        updatedAt: "2026-05-31T14:00:00.000Z",
        agentStatus: { sessionId: "session-5", status: "failed", agentType: "codex" },
      },
    ]);

    expect(outcomes.map((item) => item.id)).toEqual(["failed-task", "completed-task"]);
  });

  it("projects cancelled and stopped agent sessions into recent outcomes", () => {
    const outcomes = buildRecentOutcomeWorkItems([
      {
        id: "cancelled-agent",
        identifier: "P1-10",
        title: "Cancelled execution",
        kind: "task",
        status: "ready",
        updatedAt: "2026-05-31T11:00:00.000Z",
        agentStatus: { sessionId: "s-cancelled", status: "cancelled", agentType: "codex" },
      },
      {
        id: "stopped-agent",
        identifier: "P1-11",
        title: "Stopped execution",
        kind: "task",
        status: "ready",
        updatedAt: "2026-05-31T12:00:00.000Z",
        agentStatus: { sessionId: "s-stopped", status: "stopped", agentType: "cursor" },
      },
      {
        id: "ready",
        identifier: "P1-12",
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

  it("labels mobile recent outcomes from the authoritative outcome state", () => {
    expect(
      getRecentOutcomeWorkItemStatus({
        id: "completed",
        identifier: "P1-13",
        title: "Completed execution",
        kind: "task",
        status: "completed",
        agentStatus: { sessionId: "s-stopped", status: "stopped", agentType: "codex" },
      }),
    ).toBe("completed");

    expect(
      getRecentOutcomeWorkItemStatus({
        id: "stopped-agent",
        identifier: "P1-14",
        title: "Stopped execution",
        kind: "task",
        status: "ready",
        agentStatus: { sessionId: "s-stopped", status: "stopped", agentType: "codex" },
      }),
    ).toBe("stopped");
  });

  it("builds phone recent outcome rows from the authoritative outcome state", () => {
    expect(
      getRecentOutcomeRowModel(
        {
          id: "completed",
          identifier: "P1-15",
          title: "Completed execution",
          kind: "task",
          status: "completed",
          completedAt: "2026-05-31T11:58:00.000Z",
          agentStatus: { sessionId: "s-stopped", status: "stopped", agentType: "codex" },
        },
        { now: new Date("2026-05-31T12:00:00.000Z") },
      ),
    ).toEqual({
      status: "completed",
      statusLabel: "Completed",
      badgeVariant: "accent",
      agentLabel: "codex",
      lastUpdatedLabel: "2m ago",
      accessibilityLabel: "P1-15 Completed execution, Completed",
    });

    expect(
      getRecentOutcomeRowModel({
        id: "interrupted",
        identifier: "P1-16",
        title: "Interrupted execution",
        kind: "task",
        status: "ready",
        agentStatus: {
          sessionId: "s-interrupted",
          status: "interrupted",
          agentType: "cursor",
        },
      }),
    ).toMatchObject({
      status: "interrupted",
      statusLabel: "Interrupted",
      badgeVariant: "danger",
    });
  });

  it("places recently completed directly beneath the four summary boxes", () => {
    expect(getTabletDashboardSectionOrder()).toEqual([
      "summary-boxes",
      "recently-completed",
    ]);
  });

  it("keeps the right rail scoped to active work", () => {
    const active = buildActiveWorkItems([
      {
        id: "ready",
        identifier: "P1-1",
        title: "Ready task",
        status: "ready",
        kind: "task",
      },
      {
        id: "running",
        identifier: "P1-2",
        title: "Running task",
        status: "in_progress",
        kind: "task",
        queueSortOrder: 2,
      },
      {
        id: "active-issue",
        identifier: "P1-4",
        title: "Active issue",
        status: "in_progress",
        kind: "issue",
        queueSortOrder: 0,
      },
      {
        id: "agent-running",
        identifier: "P1-3",
        title: "Agent task",
        status: "ready",
        kind: "task",
        queueSortOrder: 1,
        agentStatus: {
          sessionId: "session-1",
          status: "running",
          agentType: "codex",
        },
      },
    ]);

    expect(active.map((item) => item.id)).toEqual(["agent-running", "running"]);
  });

  it("includes active execution sessions without linked work items in Running Now", () => {
    const entries = buildRunningNowEntries({
      workItems: [
        {
          id: "agent-running",
          identifier: "P1-3",
          title: "Agent task",
          status: "ready",
          kind: "task",
          agentStatus: {
            sessionId: "session-1",
            status: "running",
            agentType: "codex",
          },
        },
      ],
      sessions: [
        {
          sessionId: "session-1",
          status: "running",
          agentType: "codex",
          lastActivityAt: "2026-05-31T12:00:00.000Z",
          workItemId: "agent-running",
        },
        {
          sessionId: "session-only",
          status: "running",
          agentType: "cursor",
          title: "Investigate production logs",
          lastActivityAt: "2026-05-31T12:01:00.000Z",
        },
        {
          sessionId: "awaiting",
          status: "awaiting-input",
          agentType: "codex",
          title: "Needs approval",
          lastActivityAt: "2026-05-31T12:02:00.000Z",
        },
        {
          sessionId: "queued",
          status: "queued",
          agentType: "cursor",
          title: "Queued production fix",
          lastActivityAt: "2026-05-31T12:03:00.000Z",
        },
        {
          sessionId: "completed",
          status: "completed",
          agentType: "codex",
          title: "Done",
          lastActivityAt: "2026-05-31T11:00:00.000Z",
        },
      ],
    });

    expect(entries.map((entry) => [entry.id, entry.target])).toEqual(
      expect.arrayContaining([
        ["work-item:agent-running", { type: "work-item", workItemId: "agent-running", view: "outcome" }],
        ["session:session-only", { type: "execution-session", sessionId: "session-only" }],
        ["session:awaiting", { type: "execution-session", sessionId: "awaiting" }],
        ["session:queued", { type: "execution-session", sessionId: "queued" }],
      ]),
    );
    expect(entries.find((entry) => entry.id === "session:session-only")).toMatchObject({
      title: "Investigate production logs",
      statusLabel: "Running",
      detailLabel: "cursor",
    });
  });

  it("orders Running Now rows by latest activity and exposes last-updated labels", () => {
    const entries = buildRunningNowEntries({
      now: new Date("2026-05-31T12:05:00.000Z"),
      workItems: [
        {
          id: "older-task",
          identifier: "P1-3",
          title: "Older active task",
          status: "ready",
          kind: "task",
          updatedAt: "2026-05-31T12:00:00.000Z",
          agentStatus: {
            sessionId: "session-older-task",
            status: "running",
            agentType: "codex",
          },
        },
      ],
      sessions: [
        {
          sessionId: "fresh-session",
          status: "running",
          agentType: "cursor",
          title: "Fresh live session",
          lastActivityAt: "2026-05-31T12:04:00.000Z",
        },
        {
          sessionId: "stale-session",
          status: "queued",
          agentType: "codex",
          title: "Stale queued session",
          lastActivityAt: "2026-05-31T11:05:00.000Z",
        },
      ],
    });

    expect(entries.map((entry) => [entry.id, entry.lastUpdatedLabel])).toEqual([
      ["session:fresh-session", "1m ago"],
      ["work-item:older-task", "5m ago"],
      ["session:stale-session", "1h ago"],
    ]);
    expect(entries[0]?.accessibilityLabel).toBe(
      "Fresh live session, Running, cursor, updated 1m ago",
    );
  });

  it("opens Running Now work items in outcome-forward detail", () => {
    expect(
      getRunningNowWorkItemTarget({
        id: "active",
        identifier: "P1-9",
        title: "Active task",
        status: "in_progress",
        kind: "task",
      }),
    ).toEqual({
      workItemId: "active",
      view: "outcome",
    });
  });

  it("treats pending agent work as active dashboard work", () => {
    const item = {
      id: "pending",
      identifier: "P1-10",
      title: "Pending task",
      status: "ready",
      kind: "task",
      agentStatus: {
        sessionId: "session-10",
        status: "pending",
        agentType: "codex",
      },
    };

    expect(buildActiveWorkItems([item]).map((workItem) => workItem.id)).toEqual(["pending"]);
    expect(filterTaskLaneWorkItems([item], "ready")).toEqual([]);
    expect(filterTaskLaneWorkItems([item], "active").map((workItem) => workItem.id)).toEqual([
      "pending",
    ]);
  });

  it("treats queued agent work as active dashboard work", () => {
    const item = {
      id: "queued",
      identifier: "P1-11",
      title: "Queued task",
      status: "ready",
      kind: "task",
      agentStatus: {
        sessionId: "session-11",
        status: "queued",
        agentType: "cursor",
      },
    };

    expect(buildActiveWorkItems([item]).map((workItem) => workItem.id)).toEqual(["queued"]);
    expect(filterTaskLaneWorkItems([item], "ready")).toEqual([]);
    expect(filterTaskLaneWorkItems([item], "active").map((workItem) => workItem.id)).toEqual([
      "queued",
    ]);
    expect(getTaskLaneRowModel(item, "active")).toMatchObject({
      status: "queued",
      statusLabel: "Queued",
    });
  });

  it("routes active and review lane rows into outcome-forward detail", () => {
    const item = {
      id: "active",
      identifier: "P1-9",
      title: "Active task",
      status: "in_progress",
      kind: "task",
    };

    expect(getTaskLaneWorkItemTarget(item, "active")).toEqual({
      workItemId: "active",
      view: "outcome",
    });
    expect(getTaskLaneWorkItemTarget({ ...item, status: "review" }, "review")).toEqual({
      workItemId: "active",
      view: "outcome",
    });
    expect(getTaskLaneWorkItemTarget({ ...item, status: "failed" }, "needs-attention")).toEqual({
      workItemId: "active",
      view: "outcome",
    });
    expect(getTaskLaneWorkItemTarget({ ...item, status: "ready" }, "ready")).toEqual({
      workItemId: "active",
      view: "queue",
    });
  });
});
