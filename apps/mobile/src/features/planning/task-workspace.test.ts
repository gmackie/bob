import { describe, expect, it } from "vitest";

import {
  buildTaskWorkspaceViewModel,
  deriveTaskWorkspaceValidationState,
  summarizeSessionEvents,
  summarizeTaskRuns,
} from "./task-workspace";

describe("task workspace view model", () => {
  it("summarizes the latest execution state for a task workspace screen", () => {
    expect(
      buildTaskWorkspaceViewModel({
        workItem: {
          id: "task-1",
          identifier: "MOB-42",
          title: "Merge mobile execution shell",
        },
        session: {
          id: "session-1",
          title: "MOB-42 execution",
          status: "running",
        },
        workflowState: {
          workflowStatus: "awaiting_input",
          statusMessage: "Waiting for a product call",
          awaitingInput: {
            question: "Which launch copy should we use?",
            defaultAction: "Use existing copy",
            expiresAt: "2026-03-11T18:30:00.000Z",
          },
        },
        currentArtifacts: [
          {
            id: "artifact-1",
            artifactRole: "verification",
            artifactType: "verification",
            title: "Verification summary",
            url: "https://example.com/verification",
          },
        ],
        events: [
          {
            seq: 14,
            direction: "agent",
            eventType: "message_final",
            payload: {
              content: "I need a decision before I continue.",
            },
          },
        ],
      }),
    ).toEqual({
      title: "MOB-42 execution",
      sessionStatus: "running",
      workflowStatus: "awaiting_input",
      statusMessage: "Waiting for a product call",
      awaitingInput: {
        question: "Which launch copy should we use?",
        defaultAction: "Use existing copy",
        expiresAt: "2026-03-11T18:30:00.000Z",
      },
      artifactCount: 1,
      latestEventPreview: "I need a decision before I continue.",
      inputEnabled: true,
    });
  });

  it("summarizes visible session events for the mobile execution stream", () => {
    expect(
      summarizeSessionEvents([
        {
          seq: 9,
          direction: "client",
          eventType: "input",
          payload: { data: "Can you rerun tests?" },
        },
        {
          seq: 10,
          direction: "agent",
          eventType: "message_final",
          payload: { content: "Yes, rerunning now." },
        },
      ]),
    ).toEqual([
      {
        id: "9",
        actor: "You",
        body: "Can you rerun tests?",
      },
      {
        id: "10",
        actor: "Bob",
        body: "Yes, rerunning now.",
      },
    ]);
  });

  it("derives validation state from the latest verification artifact", () => {
    expect(
      deriveTaskWorkspaceValidationState([
        {
          id: "artifact-1",
          artifactRole: "verification",
          artifactType: "verification",
          title: "Verification passed",
          summary: "All acceptance checks passed.",
          url: "https://example.com/verification",
          metadata: { result: "passed" },
        },
      ]),
    ).toEqual({
      label: "Validation passed",
      detail: "All acceptance checks passed.",
      tone: "positive",
    });
  });

  it("summarizes task runs for the mobile execution history", () => {
    expect(
      summarizeTaskRuns([
        {
          id: "run-1",
          status: "awaiting_review",
          branch: "bob/mob-42-review",
          sessionId: "session-1",
        },
        {
          id: "run-2",
          status: "completed",
          branch: null,
          sessionId: null,
        },
      ]),
    ).toEqual([
      {
        id: "run-1",
        label: "awaiting review",
        branch: "bob/mob-42-review",
        hasSession: true,
        sessionId: "session-1",
      },
      {
        id: "run-2",
        label: "completed",
        branch: "No branch recorded",
        hasSession: false,
        sessionId: null,
      },
    ]);
  });
});
