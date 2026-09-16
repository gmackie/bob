import { describe, expect, it } from "vitest";
import { readTraceReportScope } from "./trace-report-scope.js";

describe("persisted trace report scope", () => {
  const scope = { workItemId: "owned-item", workspaceId: "owned-workspace", forgeGraphWorkItemId: "fg-item" };
  it("restores the server mapping after serialization", () => {
    expect(readTraceReportScope(JSON.parse(JSON.stringify({ traceReportScope: scope })), "owned-item", "owned-workspace"))
      .toEqual({ forgeGraphWorkItemId: "fg-item" });
  });
  it("ignores editable persona metadata and mismatched ownership", () => {
    expect(readTraceReportScope({ metadata: { traceReportScope: scope } }, "owned-item", "owned-workspace")).toEqual({});
    expect(readTraceReportScope({ traceReportScope: scope }, "other-item", "owned-workspace")).toEqual({});
    expect(readTraceReportScope({ traceReportScope: scope }, "owned-item", "other-workspace")).toEqual({});
  });
});
