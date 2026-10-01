import { describe, expect, it } from "vitest";

import { buildSessionList } from "./session-list-model";

const NOW = new Date("2026-09-30T12:00:00.000Z");

const sessions = [
  {
    sessionId: "s-running",
    status: "running",
    agentType: "codex",
    title: "Implement queue reorder",
    workItemIdentifier: "BOB-42",
    lastActivityAt: "2026-09-30T11:58:00.000Z",
  },
  {
    sessionId: "s-blocked",
    status: "blocked",
    agentType: "claude",
    title: "Fix mobile auth",
    lastActivityAt: "2026-09-30T11:30:00.000Z",
  },
  {
    sessionId: "s-lost",
    status: "host_unknown",
    agentType: "codex",
    title: "Migrate schema",
    lastActivityAt: "2026-09-30T10:00:00.000Z",
  },
  {
    sessionId: "s-done",
    status: "completed",
    agentType: "codex",
    title: "Add digest email",
    lastActivityAt: "2026-09-30T09:00:00.000Z",
  },
  {
    sessionId: "s-failed",
    status: "failed",
    agentType: "grok",
    title: "Refactor relay",
    lastActivityAt: "2026-09-29T09:00:00.000Z",
  },
  {
    sessionId: "p-1",
    status: "running",
    agentType: "planner",
    sessionType: "planning",
    title: "Plan dashboard",
    lastActivityAt: "2026-09-30T11:59:00.000Z",
  },
];

describe("buildSessionList", () => {
  it("groups by what a person needs to do: decide, watch, review", () => {
    const list = buildSessionList(sessions, { now: NOW });
    expect(
      list.sections.map((s) => [s.key, s.rows.map((r) => r.sessionId)]),
    ).toEqual([
      ["needs_you", ["s-blocked", "s-lost"]],
      ["running", ["s-running"]],
      ["finished", ["s-done", "s-failed"]],
    ]);
    expect(list.needsYouCount).toBe(2);
    expect(list.runningCount).toBe(1);
  });

  it("leaves planning sessions to the planning screens", () => {
    const list = buildSessionList(sessions, { now: NOW });
    const ids = list.sections.flatMap((s) => s.rows.map((r) => r.sessionId));
    expect(ids).not.toContain("p-1");
  });

  it("builds a row a person can read at a glance", () => {
    const list = buildSessionList(sessions, { now: NOW, workspaceId: "ws-1" });
    const row = list.sections[1]?.rows[0];
    expect(row).toMatchObject({
      title: "Implement queue reorder",
      identifier: "BOB-42",
      agentLabel: "Codex",
      statusLabel: "Running",
      tone: "running",
      lastActivityLabel: "2m ago",
      href: "/sessions/s-running?workspace=ws-1",
    });
  });

  it("caps the finished list but reports the true total", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      sessionId: `f-${i}`,
      status: "completed",
      title: `Done ${i}`,
      lastActivityAt: `2026-09-30T0${i}:00:00.000Z`,
    }));
    const list = buildSessionList(many, { now: NOW, finishedLimit: 2 });
    expect(list.sections[0]?.rows).toHaveLength(2);
    expect(list.sections[0]?.total).toBe(5);
    // Freshest first.
    expect(list.sections[0]?.rows[0]?.sessionId).toBe("f-4");
  });

  it("is empty when there is nothing to show", () => {
    expect(buildSessionList([], { now: NOW }).isEmpty).toBe(true);
  });
});
