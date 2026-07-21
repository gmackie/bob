import { describe, expect, it } from "vitest";
import { renderToolText } from "./ooda-oracle-mcp";
import type { OracleQueryResult } from "./oracle-client";

const result: OracleQueryResult = {
  confidence: 0.6, queryId: "q", latencyMs: 9,
  chunks: [{ unitId: "u", sourceId: 1, content: "alpha", tokenCount: 1, headingContext: null,
    score: 0.6, sourceTitle: "Src", sourceUrl: "http://x", sourceKind: "doc", contentAsOf: null }],
};

describe("renderToolText", () => {
  it("lists chunks with source titles and confidence", () => {
    const text = renderToolText(result);
    expect(text).toContain("confidence 0.60");
    expect(text).toContain("[Src] alpha");
  });
  it("reports no results clearly when chunks are empty", () => {
    expect(renderToolText({ ...result, chunks: [] })).toContain("No knowledge found");
  });
});
