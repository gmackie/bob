import { describe, expect, it } from "vitest";

import { summarizeTaskRuns } from "./task-workspace";

describe("task workspace run history", () => {
  it("keeps linked session ids so the mobile workspace can open runs", () => {
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
