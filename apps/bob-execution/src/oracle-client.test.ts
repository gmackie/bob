import { describe, expect, it } from "vitest";
import { buildSeedQuestion, formatOracleSection, type OracleQueryResult } from "./oracle-client";
import { fetchOracleSeed } from "./oracle-client";

describe("buildSeedQuestion", () => {
  it("combines intent and notes", () => {
    expect(buildSeedQuestion("add auth", "use better-auth")).toBe("add auth\n\nuse better-auth");
  });
  it("uses intent alone when notes absent", () => {
    expect(buildSeedQuestion("add auth", undefined)).toBe("add auth");
  });
  it("returns empty string when nothing provided", () => {
    expect(buildSeedQuestion(undefined, undefined)).toBe("");
  });
});

describe("formatOracleSection", () => {
  const base: OracleQueryResult = { chunks: [], confidence: 0, queryId: "q1", latencyMs: 5 };

  it("returns empty string when there are no chunks", () => {
    expect(formatOracleSection(base)).toBe("");
  });

  it("renders a numbered knowledge section with titles and confidence", () => {
    const result: OracleQueryResult = {
      ...base,
      confidence: 0.82,
      chunks: [
        { unitId: "u1", sourceId: 1, content: "Use Drizzle for migrations.", tokenCount: 6,
          headingContext: null, score: 0.9, sourceTitle: "DB Guide", sourceUrl: null,
          sourceKind: "doc", contentAsOf: null },
      ],
    };
    const section = formatOracleSection(result);
    expect(section).toContain("## Knowledge from OODA (oracle, confidence 0.82)");
    expect(section).toContain("1. [DB Guide] Use Drizzle for migrations.");
    expect(section).toContain("oracle_query tool");
  });

  it("falls back to 'untitled source' when sourceTitle is null", () => {
    const result: OracleQueryResult = {
      ...base, confidence: 0.5,
      chunks: [{ unitId: "u1", sourceId: 1, content: "x", tokenCount: 1, headingContext: null,
        score: 0.5, sourceTitle: null, sourceUrl: null, sourceKind: "doc", contentAsOf: null }],
    };
    expect(formatOracleSection(result)).toContain("[untitled source] x");
  });
});

describe("fetchOracleSeed", () => {
  const logs: string[] = [];
  const log = (m: string) => logs.push(m);
  const okResult: OracleQueryResult = {
    confidence: 0.7, queryId: "qid", latencyMs: 12,
    chunks: [{ unitId: "u", sourceId: 1, content: "hi", tokenCount: 1, headingContext: null,
      score: 0.7, sourceTitle: "S", sourceUrl: null, sourceKind: "doc", contentAsOf: null }],
  };

  it("returns a formatted section and logs queryId on success", async () => {
    const client = { oracle: { query: { query: async () => okResult } } };
    const section = await fetchOracleSeed(client, { question: "q", topK: 6 }, log);
    expect(section).toContain("## Knowledge from OODA");
    expect(logs.some((l) => l.includes("qid"))).toBe(true);
  });

  it("returns empty string and never throws when the client rejects", async () => {
    const client = { oracle: { query: { query: async () => { throw new Error("boom"); } } } };
    const section = await fetchOracleSeed(client, { question: "q" }, log);
    expect(section).toBe("");
  });

  it("returns empty string when the question is blank", async () => {
    let called = false;
    const client = { oracle: { query: { query: async () => { called = true; return okResult; } } } };
    const section = await fetchOracleSeed(client, { question: "   " }, log);
    expect(section).toBe("");
    expect(called).toBe(false);
  });
});
