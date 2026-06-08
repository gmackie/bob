import { describe, expect, it } from "vitest";

import {
  buildProviderRunGroups,
  buildProviderRunRow,
  getProviderRunsEmptyState,
  getProviderRunsFilterHref,
  getProviderRunsHeaderModel,
  formatProviderRunTitle,
  filterRecentOutcomeRuns,
  filterRunsByProvider,
  getProviderRunsHeading,
  getRunDetailBackHref,
  getRunDetailWorkItemHref,
  getProviderRunHref,
  normalizeProviderParam,
} from "../provider-runs-model";

describe("provider runs model", () => {
  it("normalizes provider query params", () => {
    expect(normalizeProviderParam("codex")).toBe("codex");
    expect(normalizeProviderParam("cursor")).toBe("cursor");
    expect(normalizeProviderParam("grok")).toBe("grok");
    expect(normalizeProviderParam("bad")).toBe("all");
    expect(normalizeProviderParam(null)).toBe("all");
  });

  it("filters run history by provider", () => {
    const runs = [
      { id: "codex", agentType: "codex" },
      { id: "cursor", agentType: "cursor-agent" },
      { id: "grok", agentType: "grok" },
      { id: "claude", agentType: "claude" },
    ];

    expect(filterRunsByProvider(runs, "codex").map((run) => run.id)).toEqual([
      "codex",
      "claude",
    ]);
    expect(filterRunsByProvider(runs, "cursor").map((run) => run.id)).toEqual([
      "cursor",
    ]);
    expect(filterRunsByProvider(runs, "grok").map((run) => run.id)).toEqual([
      "grok",
    ]);
    expect(filterRunsByProvider(runs, "all").map((run) => run.id)).toEqual([
      "codex",
      "cursor",
      "grok",
      "claude",
    ]);
  });

  it("names provider detail headings", () => {
    expect(getProviderRunsHeading("codex")).toBe("Codex Runs");
    expect(getProviderRunsHeading("cursor")).toBe("Cursor Runs");
    expect(getProviderRunsHeading("grok")).toBe("Grok Runs");
    expect(getProviderRunsHeading("all")).toBe("Recent Outcomes");
  });

  it("labels grok runs from the grok agent type", () => {
    expect(
      buildProviderRunRow({ id: "run-1", agentType: "grok" }).agentLabel,
    ).toBe("Grok");
    expect(getProviderRunsEmptyState("grok")).toEqual({
      title: "No grok runs yet",
      subtitle: null,
    });
  });

  it("keeps provider run page headers and empty states free of explanatory copy", () => {
    expect(getProviderRunsHeaderModel("all")).toEqual({
      title: "Recent Outcomes",
      subtitle: null,
    });
    expect(getProviderRunsHeaderModel("codex")).toEqual({
      title: "Codex Runs",
      subtitle: null,
    });
    expect(getProviderRunsEmptyState("all")).toEqual({
      title: "No recent outcomes yet",
      subtitle: null,
    });
    expect(getProviderRunsEmptyState("cursor")).toEqual({
      title: "No cursor runs yet",
      subtitle: null,
    });
  });

  it("preserves provider and workspace filters when changing provider detail controls", () => {
    expect(
      getProviderRunsFilterHref("workspace=workspace-1&provider=codex", {
        provider: "cursor",
      }),
    ).toBe("/runs?provider=cursor&workspace=workspace-1");
    expect(
      getProviderRunsFilterHref("workspace=workspace-1&provider=cursor", {
        provider: "all",
      }),
    ).toBe("/runs?workspace=workspace-1");
    expect(
      getProviderRunsFilterHref("workspace=workspace-1&provider=codex", {
        workspaceId: "workspace-2",
      }),
    ).toBe("/runs?provider=codex&workspace=workspace-2");
    expect(
      getProviderRunsFilterHref("workspace=workspace-1&provider=codex", {
        workspaceId: null,
      }),
    ).toBe("/runs?provider=codex");
  });

  it("groups provider runs into active, completed, and failed history buckets", () => {
    const groups = buildProviderRunGroups([
      { id: "queued", status: "queued", agentType: "codex" },
      { id: "pending", status: "pending", agentType: "codex" },
      { id: "running", status: "running", agentType: "codex" },
      { id: "awaiting", status: "awaiting-input", agentType: "codex" },
      { id: "awaiting-underscore", status: "awaiting_input", agentType: "codex" },
      { id: "completed", status: "completed", agentType: "codex" },
      { id: "done", status: "done", agentType: "codex" },
      { id: "failed", status: "failed", agentType: "codex" },
      { id: "interrupted", status: "interrupted", agentType: "codex" },
    ]);

    expect(groups.active.map((run) => run.id)).toEqual([
      "queued",
      "pending",
      "running",
      "awaiting",
      "awaiting-underscore",
    ]);
    expect(groups.completed.map((run) => run.id)).toEqual(["completed", "done"]);
    expect(groups.failed.map((run) => run.id)).toEqual(["failed", "interrupted"]);
    expect(groups.metrics).toEqual({
      total: 9,
      active: 5,
      completed: 2,
      failed: 2,
    });
  });

  it("keeps the default Recent Outcomes view limited to finished or failed runs", () => {
    expect(
      filterRecentOutcomeRuns([
        { id: "queued", status: "queued", agentType: "codex" },
        { id: "running", status: "running", agentType: "codex" },
        { id: "completed", status: "completed", agentType: "codex" },
        { id: "failed", status: "failed", agentType: "codex" },
        { id: "stopped", status: "stopped", agentType: "codex" },
      ]).map((run) => run.id),
    ).toEqual(["completed", "failed", "stopped"]);
  });

  it("includes reviewed provider sessions in Recent Outcomes", () => {
    expect(
      filterRecentOutcomeRuns([
        { id: "in-review", status: "in_review", agentType: "codex" },
        { id: "review", status: "review", agentType: "cursor" },
        { id: "running", status: "running", agentType: "codex" },
      ]).map((run) => run.id),
    ).toEqual(["in-review", "review"]);
    expect(buildProviderRunRow({ id: "review", status: "in_review" }).statusTone).toBe(
      "warning",
    );
  });

  it("formats provider run titles and drilldown hrefs from linked task/session data", () => {
    expect(
      formatProviderRunTitle({
        id: "run-1",
        workItemId: "work-1",
        session: { title: "Implement queue controls" },
      }),
    ).toBe("Implement queue controls");
    expect(formatProviderRunTitle({ id: "run-2", workItemId: "work-2" })).toBe("work-2");
    expect(formatProviderRunTitle({ id: "run-3" })).toBe("run-3");
    expect(getProviderRunHref({ id: "run-1" })).toBe("/runs/run-1");
    expect(getProviderRunsHeading("all")).toBe("Recent Outcomes");
  });

  it("routes linked recent outcomes into outcome-forward work item details", () => {
    expect(
      getProviderRunHref({
        id: "run-1",
        workItemId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe("/work-items/11111111-1111-4111-8111-111111111111?view=outcome");
    expect(getProviderRunHref({ id: "run-2", workItemId: "BOB-27" })).toBe(
      "/work-items/BOB-27?view=outcome",
    );
    expect(getProviderRunHref({ id: "run-2", workItemId: "legacy-title" })).toBe(
      "/runs/run-2",
    );
  });

  it("preserves workspace when routing run drilldowns", () => {
    expect(getRunDetailBackHref("workspace-1")).toBe("/runs?workspace=workspace-1");
    expect(getRunDetailWorkItemHref("BOB-27", "workspace-1")).toBe(
      "/work-items/BOB-27?view=outcome&workspace=workspace-1",
    );
    expect(
      getProviderRunHref(
        {
          id: "run-1",
          workItemId: "BOB-27",
        },
        "workspace-1",
      ),
    ).toBe("/work-items/BOB-27?view=outcome&workspace=workspace-1");
    expect(
      getProviderRunHref(
        {
          id: "run-2",
          status: "running",
          sessionId: "session-1",
        },
        "workspace-1",
      ),
    ).toBe("/sessions/session-1?workspace=workspace-1");
    expect(getProviderRunHref({ id: "run-3" }, "workspace-1")).toBe(
      "/runs/run-3?workspace=workspace-1",
    );
  });

  it("builds provider run row hrefs that preserve the active workspace", () => {
    expect(
      buildProviderRunRow(
        {
          id: "run-1",
          workItemId: "BOB-27",
          session: { title: "Fix the tablet dashboard" },
        },
        "workspace-1",
      ),
    ).toEqual({
      title: "Fix the tablet dashboard",
      href: "/work-items/BOB-27?view=outcome&workspace=workspace-1",
      statusLabel: "Unknown",
      statusTone: "default",
      agentLabel: "Agent",
      lastUpdatedLabel: "No activity",
      accessibilityLabel: "Fix the tablet dashboard, Unknown, Agent, No activity",
    });
    expect(
      buildProviderRunRow(
        {
          id: "run-2",
          status: "running",
          sessionId: "session-1",
        },
        "workspace-1",
      ),
    ).toEqual({
      title: "run-2",
      href: "/sessions/session-1?workspace=workspace-1",
      statusLabel: "Running",
      statusTone: "warning",
      agentLabel: "Agent",
      lastUpdatedLabel: "No activity",
      accessibilityLabel: "run-2, Running, Agent, No activity",
    });
    expect(buildProviderRunRow({ id: "run-3" }, "workspace-1")).toEqual({
      title: "run-3",
      href: "/runs/run-3?workspace=workspace-1",
      statusLabel: "Unknown",
      statusTone: "default",
      agentLabel: "Agent",
      lastUpdatedLabel: "No activity",
      accessibilityLabel: "run-3, Unknown, Agent, No activity",
    });
  });

  it("builds readable provider run row metadata from status, agent, and activity", () => {
    expect(
      buildProviderRunRow(
        {
          id: "run-1",
          status: "awaiting_input",
          agentType: "cursor-agent",
          session: { title: "Awaiting approval" },
          completedAt: "2026-05-31T11:55:00.000Z",
          updatedAt: "2026-05-31T11:58:00.000Z",
          createdAt: "2026-05-31T11:00:00.000Z",
        },
        "workspace-1",
        { now: new Date("2026-05-31T12:00:00.000Z") },
      ),
    ).toEqual({
      title: "Awaiting approval",
      href: "/runs/run-1?workspace=workspace-1",
      statusLabel: "Awaiting Input",
      statusTone: "warning",
      agentLabel: "Cursor",
      lastUpdatedLabel: "2m ago",
      accessibilityLabel: "Awaiting approval, Awaiting Input, Cursor, 2m ago",
    });
  });

  it("routes session-backed provider runs to the live execution session when no work item is linked", () => {
    expect(
      getProviderRunHref({
        id: "run-1",
        status: "running",
        sessionId: "session-1",
      }),
    ).toBe("/sessions/session-1");
  });

  it("routes active provider rows to the live session before linked work item outcomes", () => {
    expect(
      getProviderRunHref(
        {
          id: "run-1",
          status: "running",
          sessionId: "session-1",
          workItemId: "BOB-27",
        },
        "workspace-1",
      ),
    ).toBe("/sessions/session-1?workspace=workspace-1");
  });

  it("routes awaiting-input provider rows to the live session", () => {
    expect(
      getProviderRunHref(
        {
          id: "run-1",
          status: "awaiting-input",
          sessionId: "session-1",
          workItemId: "BOB-27",
        },
        "workspace-1",
      ),
    ).toBe("/sessions/session-1?workspace=workspace-1");
  });
});
