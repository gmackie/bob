import { describe, expect, it } from "vitest";

import {
  canPairTaskPanes,
  describeBuilderDiff,
  selectBuilderExecution,
} from "./task-builder";

describe("task and builder workspace", () => {
  it("uses the measured pane after sidebars, padding and insets, at the user's text size", () => {
    expect(
      [350, 599, 600, 710, 950].map((width) => canPairTaskPanes(width, 1)),
    ).toEqual([false, false, true, true, true]);
    expect(canPairTaskPanes(710, 1.4)).toBe(false);
    expect(canPairTaskPanes(950, 1.4)).toBe(true);
  });

  const history = [
    { id: "latest", sessionId: null },
    { id: "prior", sessionId: "s1" },
  ];
  it("keeps a sessionless result and never pairs an older run with a fresh dispatch", () => {
    expect(selectBuilderExecution(history, null, "s1")).toEqual({
      run: history[0],
      sessionId: null,
    });
    expect(selectBuilderExecution(history, "s2", "s1")).toEqual({
      run: undefined,
      sessionId: "s2",
    });
    expect(selectBuilderExecution(history, "s1", null)).toEqual({
      run: history[1],
      sessionId: "s1",
    });
    expect(selectBuilderExecution([], null, "task-run-session").sessionId).toBe(
      "task-run-session",
    );
  });

  it("summarizes the runner's inline patch, including hunk lines beginning with +++ or ---", () => {
    const patch = [
      "diff --git a/a b/a",
      "--- a/a",
      "+++ b/a",
      "@@ -1 +1 @@",
      "--- old",
      "+++ new",
      "diff --git a/b b/c",
      "similarity index 100%",
      "rename from b",
      "rename to c",
    ].join("\n");
    expect(
      describeBuilderDiff({
        artifacts: [{ type: "diff", metadata: { content: patch } }],
      }),
    ).toBe("2 files changed · +1 · −1");
  });

  it("prefers recorded stats, preserves real zeros and never invents totals for a missing or truncated patch", () => {
    expect(
      describeBuilderDiff({
        summary: { files_changed: 1 },
        artifacts: [
          { type: "diff", metadata: { insertions: 0, deletions: 2 } },
        ],
      }),
    ).toBe("1 file changed · +0 · −2");
    expect(
      describeBuilderDiff({
        artifacts: [
          {
            type: "diff",
            metadata: { truncated: true, content: "+remainder" },
          },
        ],
      }),
    ).toBe("Partial diff recorded");
    expect(
      describeBuilderDiff({
        artifacts: [{ type: "log", metadata: { content: "+log" } }],
      }),
    ).toBeNull();
  });
});
