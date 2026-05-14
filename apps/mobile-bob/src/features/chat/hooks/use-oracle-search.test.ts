import { describe, expect, it } from "vitest";

describe("oracle chunk shape", () => {
  it("validates chunk structure at type level", () => {
    interface OracleChunk {
      unitId: string;
      sourceId: number;
      content: string;
      tokenCount: number;
      headingContext: string | null;
      score: number;
      sourceTitle: string | null;
      sourceUrl: string | null;
      sourceKind: string;
    }

    const chunk: OracleChunk = {
      unitId: "unit-1",
      sourceId: 42,
      content: "Event sourcing with CQRS",
      tokenCount: 128,
      headingContext: "Architecture > Patterns",
      score: 0.87,
      sourceTitle: "System Design Notes",
      sourceUrl: null,
      sourceKind: "note",
    };

    expect(chunk.unitId).toBe("unit-1");
    expect(chunk.score).toBe(0.87);
    expect(chunk.sourceKind).toBe("note");
  });
});
