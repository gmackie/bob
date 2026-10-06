import { describe, expect, it } from "vitest";

import {
  commitTrailerInstruction,
  pullRequestBody,
  pullRequestTitle,
  rangeReferencesIssue,
  trackerIdentifierForSession,
} from "./tracker-naming";

const tracker = {
  issueId: "cb43f3bb-295f-42ca-9a95-a8ba4076e084",
  identifier: "GMA-612",
  title: "GMA-612: Fix the login redirect",
};

describe("tracker naming", () => {
  it("treats a session as tracker work only when the gateway marked it and the identifier is tracker-shaped", () => {
    expect(trackerIdentifierForSession(tracker)).toBe("GMA-612");
    // Internal item with a project-key identifier: not tracker work.
    expect(trackerIdentifierForSession({ identifier: "BOB-27", title: "x" })).toBeNull();
    // Imported item still running under its UUID (pre-change dispatch).
    expect(trackerIdentifierForSession({ ...tracker, identifier: tracker.issueId })).toBeNull();
  });

  it("titles tracker PRs GMA-612: <title> without doubling the prefix", () => {
    expect(pullRequestTitle(tracker, "branch")).toBe("GMA-612: Fix the login redirect");
    expect(pullRequestTitle({ ...tracker, title: "Fix the login redirect" }, "branch")).toBe(
      "GMA-612: Fix the login redirect",
    );
  });

  it("keeps [Bob] <title> for everything else", () => {
    expect(pullRequestTitle({ identifier: "81431962", title: "81431962: Tune it" }, "b")).toBe(
      "[Bob] 81431962: Tune it",
    );
    expect(pullRequestTitle({}, "bob/x/y")).toBe("[Bob] bob/x/y");
  });

  it("adds Refs: GMA-612 to tracker PR bodies once, and leaves others alone", () => {
    expect(pullRequestBody(tracker, "Automated by Bob agent.")).toBe("Automated by Bob agent.\n\nRefs: GMA-612");
    expect(pullRequestBody(tracker, "x\n\nRefs: GMA-612")).toBe("x\n\nRefs: GMA-612");
    expect(pullRequestBody({ identifier: "BOB-27" }, "body")).toBe("body");
  });

  it("asks only tracker sessions for the commit trailer", () => {
    expect(commitTrailerInstruction(tracker)).toContain("`Refs: GMA-612`");
    expect(commitTrailerInstruction({ identifier: "BOB-27" })).toBeNull();
  });

  it("detects an existing reference without matching a longer number", () => {
    expect(rangeReferencesIssue("fix: x\n\nRefs: GMA-612\n", "GMA-612")).toBe(true);
    expect(rangeReferencesIssue("GMA-612: fix", "GMA-612")).toBe(true);
    expect(rangeReferencesIssue("Refs: GMA-6123", "GMA-612")).toBe(false);
    expect(rangeReferencesIssue("XGMA-612", "GMA-612")).toBe(false);
    expect(rangeReferencesIssue("plain message", "GMA-612")).toBe(false);
  });
});
