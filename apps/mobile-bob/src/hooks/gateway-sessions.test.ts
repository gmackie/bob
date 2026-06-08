import { describe, expect, it } from "vitest";

import {
  getLiveDashboardSessions,
  mergeGatewaySessionStatusChange,
} from "./gateway-sessions";

describe("gateway session state", () => {
  it("applies planning draft and produced task counts from live status changes", () => {
    const merged = mergeGatewaySessionStatusChange(
      [
        {
          sessionId: "plan-1",
          status: "running",
          agentType: "planner",
          sessionType: "planning",
          title: "Plan queue",
          lastActivityAt: "2026-05-31T10:00:00.000Z",
          draftCount: 4,
          producedTaskCount: 1,
        },
      ],
      {
        type: "session_status_changed",
        sessionId: "plan-1",
        status: "idle",
        draftCount: 2,
        producedTaskCount: 3,
      },
      "2026-05-31T11:00:00.000Z",
    );

    expect(merged[0]).toMatchObject({
      sessionId: "plan-1",
      status: "idle",
      draftCount: 2,
      producedTaskCount: 3,
      lastActivityAt: "2026-05-31T11:00:00.000Z",
    });
  });

  it("preserves existing planning counts when a status change omits them", () => {
    const merged = mergeGatewaySessionStatusChange(
      [
        {
          sessionId: "plan-1",
          status: "running",
          agentType: "planner",
          sessionType: "planning",
          lastActivityAt: "2026-05-31T10:00:00.000Z",
          draftCount: 4,
          producedTaskCount: 1,
        },
      ],
      {
        type: "session_status_changed",
        sessionId: "plan-1",
        status: "idle",
      },
      "2026-05-31T11:00:00.000Z",
    );

    expect(merged[0]).toMatchObject({
      draftCount: 4,
      producedTaskCount: 1,
    });
  });

  it("keeps only execution sessions available to the phone tasks dashboard", () => {
    const sessions = [
      {
        sessionId: "run-1",
        status: "running" as const,
        agentType: "codex",
        sessionType: "execution",
        lastActivityAt: "2026-05-31T10:00:00.000Z",
      },
      {
        sessionId: "plan-1",
        status: "running" as const,
        agentType: "planner",
        sessionType: "planning",
        lastActivityAt: "2026-05-31T10:01:00.000Z",
      },
      {
        sessionId: "plan-2",
        status: "running" as const,
        agentType: "planning-agent",
        lastActivityAt: "2026-05-31T10:02:00.000Z",
      },
    ];

    expect(getLiveDashboardSessions(sessions).map((session) => session.sessionId)).toEqual([
      "run-1",
    ]);
  });
});
