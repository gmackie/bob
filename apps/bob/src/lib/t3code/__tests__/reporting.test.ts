import { describe, expect, it } from "vitest";

import { buildT3codeInteractionReport } from "../reporting";

describe("buildT3codeInteractionReport", () => {
  it("summarizes mirrored t3 runtime events with thread and Linear context", () => {
    const report = buildT3codeInteractionReport({
      sessionId: "session-1",
      taskRunId: "run-1",
      workflowState: {
        workflowStatus: "working",
        statusMessage: "Applying changes",
      },
      events: [
        {
          id: "event-1",
          seq: 10,
          eventType: "state",
          direction: "server",
          createdAt: "2026-06-04T19:00:00.000Z",
          payload: { workflowStatus: "working", message: "Local state update" },
        },
        {
          id: "event-2",
          seq: 11,
          eventType: "state",
          direction: "server",
          createdAt: "2026-06-04T19:01:00.000Z",
          payload: {
            type: "t3_runtime_event",
            status: "working",
            message: "t3code is editing files",
            threadId: "thread-123",
            taskRunId: "run-1",
            details: {
              externalTask: {
                origin: "bob",
                planningProvider: "linear",
                linearIdentifier: "ENG-42",
                linearTitle: "Add t3 reporting",
                linearUrl: "https://tasks.gmac.io/acme/issue/ENG-42/add-t3-reporting",
                linearWebBaseUrl: "https://tasks.gmac.io",
                bobWorkspaceId: "workspace-1",
                bobWorkItemId: "work-item-1",
                bobTaskRunId: "run-1",
              },
            },
          },
        },
        {
          id: "event-3",
          seq: 12,
          eventType: "state",
          direction: "server",
          createdAt: "2026-06-04T19:02:00.000Z",
          payload: {
            type: "t3_runtime_event",
            status: "review_ready",
            message: "Review ready",
            threadId: "thread-123",
            taskRunId: "run-1",
          },
        },
      ],
    });

    expect(report).toMatchObject({
      sessionId: "session-1",
      taskRunId: "run-1",
      backendLabel: "t3code server",
      status: "review_ready",
      message: "Review ready",
      threadId: "thread-123",
      linear: {
        identifier: "ENG-42",
        title: "Add t3 reporting",
        url: "https://tasks.gmac.io/acme/issue/ENG-42/add-t3-reporting",
        webBaseUrl: "https://tasks.gmac.io",
      },
    });
    expect(report?.events).toEqual([
      {
        id: "11",
        seq: 11,
        status: "working",
        message: "t3code is editing files",
        threadId: "thread-123",
        taskRunId: "run-1",
        createdAt: "2026-06-04T19:01:00.000Z",
      },
      {
        id: "12",
        seq: 12,
        status: "review_ready",
        message: "Review ready",
        threadId: "thread-123",
        taskRunId: "run-1",
        createdAt: "2026-06-04T19:02:00.000Z",
      },
    ]);
  });

  it("returns null when no t3 runtime metadata is present", () => {
    expect(
      buildT3codeInteractionReport({
        sessionId: "session-1",
        taskRunId: null,
        workflowState: {
          workflowStatus: "working",
          statusMessage: "Local execution",
        },
        events: [
          {
            id: "event-1",
            seq: 1,
            eventType: "assistant",
            direction: "server",
            createdAt: "2026-06-04T19:00:00.000Z",
            payload: { text: "Local agent output" },
          },
        ],
      }),
    ).toBeNull();
  });

  it("can report a pending t3 dispatch before mirrored events arrive", () => {
    expect(
      buildT3codeInteractionReport({
        sessionId: "session-1",
        taskRunId: "run-1",
        assumeT3code: true,
        workflowState: {
          workflowStatus: "working",
          statusMessage: "Dispatch accepted by Bob",
        },
        events: [],
      }),
    ).toEqual({
      backendLabel: "t3code server",
      sessionId: "session-1",
      taskRunId: "run-1",
      status: "working",
      message: "Dispatch accepted by Bob",
      threadId: null,
      linear: null,
      events: [],
    });
  });
});
