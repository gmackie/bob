import { describe, expect, it } from "vitest";

import {
  formatDuration,
  parseForgeRevisionReviewMetadata,
} from "@/lib/forge/review-data";

describe("Forge revision review metadata parser", () => {
  it("extracts changed files from arrays of strings and objects", () => {
    const metadata = {
      files: [
        "ui/new.tsx",
        {
          path: "api/service.ts",
          status: "modified",
          additions: 12,
          deletions: 2,
        },
      ],
    };

    const parsed = parseForgeRevisionReviewMetadata(metadata);

    expect(parsed.changedFiles).toHaveLength(2);
    expect(parsed.changedFiles[0]).toMatchObject({ path: "ui/new.tsx" });
    expect(parsed.changedFiles[1]).toMatchObject({
      path: "api/service.ts",
      status: "modified",
      additions: 12,
      deletions: 2,
    });
  });

  it("extracts pull requests from mixed structured metadata", () => {
    const metadata = {
      runId: "run-42",
      taskId: "tsk-12",
      agentId: "agent-9",
      pullRequests: [
        {
          id: "42",
          title: "Agent patch",
          url: "https://github.com/acme/repo/pull/42",
          state: "open",
        },
        "https://github.com/acme/repo/pull/99",
      ],
    };

    const parsed = parseForgeRevisionReviewMetadata(metadata);

    expect(parsed.pullRequests).toHaveLength(2);
    expect(parsed.pullRequests[0]).toMatchObject({
      id: "42",
      title: "Agent patch",
      url: "https://github.com/acme/repo/pull/42",
      state: "open",
    });
    expect(parsed.pullRequests[1]).toMatchObject({
      id: "https://github.com/acme/repo/pull/99",
      url: "https://github.com/acme/repo/pull/99",
    });
    expect(parsed.runId).toBe("run-42");
    expect(parsed.taskId).toBe("tsk-12");
    expect(parsed.agentId).toBe("agent-9");
  });

  it("returns empty buckets for malformed data", () => {
    expect(parseForgeRevisionReviewMetadata(null).changedFiles).toHaveLength(0);
    expect(parseForgeRevisionReviewMetadata({}).pullRequests).toHaveLength(0);
    expect(parseForgeRevisionReviewMetadata("invalid").ciNotes).toHaveLength(0);
  });

  it("formats duration with best-effort precision", () => {
    expect(formatDuration("2025-02-01T10:00:00.000Z", "2025-02-01T10:00:00.500Z")).toBe("0m 0s");
    expect(formatDuration(undefined, undefined)).toBe("N/A");
  });
});
