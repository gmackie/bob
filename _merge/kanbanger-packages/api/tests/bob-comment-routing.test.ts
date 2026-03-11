import { describe, expect, it } from "vitest";

import { buildBobCommentRoutingMetadata } from "../src/routers/comment";

describe("Bob comment routing", () => {
  it("routes replies to the latest Bob prompt comment", () => {
    expect(
      buildBobCommentRoutingMetadata({
        body: "Ship option A",
        parentId: "prompt-comment-1",
        issueStatus: "blocked",
        lastPromptCommentId: "prompt-comment-1",
        taskRunId: "task-run-1",
        sessionId: "session-1",
        hasActiveBobRun: true,
      }),
    ).toEqual({
      shouldRoute: true,
      reason: "prompt_reply",
      issueManaged: true,
      promptCommentId: "prompt-comment-1",
      taskRunId: "task-run-1",
      sessionId: "session-1",
    });
  });

  it("routes explicit Bob mentions while the issue is in review", () => {
    expect(
      buildBobCommentRoutingMetadata({
        body: "@Bob please address the review note on the auth flow.",
        parentId: null,
        issueStatus: "in_review",
        lastPromptCommentId: "prompt-comment-1",
        taskRunId: "task-run-1",
        sessionId: "session-1",
        hasActiveBobRun: true,
      }),
    ).toEqual({
      shouldRoute: true,
      reason: "mention",
      issueManaged: true,
      promptCommentId: "prompt-comment-1",
      taskRunId: "task-run-1",
      sessionId: "session-1",
    });
  });

  it("ignores ordinary comments that are not prompt replies or Bob mentions", () => {
    expect(
      buildBobCommentRoutingMetadata({
        body: "This looks fine to me.",
        parentId: null,
        issueStatus: "in_progress",
        lastPromptCommentId: "prompt-comment-1",
        taskRunId: "task-run-1",
        sessionId: "session-1",
        hasActiveBobRun: true,
      }),
    ).toEqual({
      shouldRoute: false,
      reason: "mention",
      issueManaged: true,
      promptCommentId: "prompt-comment-1",
      taskRunId: "task-run-1",
      sessionId: "session-1",
    });
  });

  it("does not route Bob mentions when there is no active Bob run", () => {
    expect(
      buildBobCommentRoutingMetadata({
        body: "@Bob please take another pass.",
        parentId: null,
        issueStatus: "done",
        lastPromptCommentId: null,
        taskRunId: null,
        sessionId: null,
        hasActiveBobRun: false,
      }),
    ).toEqual({
      shouldRoute: false,
      reason: "mention",
      issueManaged: false,
      promptCommentId: null,
      taskRunId: null,
      sessionId: null,
    });
  });
});
