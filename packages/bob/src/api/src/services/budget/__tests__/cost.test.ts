import { describe, expect, it, vi } from "vitest";

vi.mock("@bob/db/client", () => ({ db: {} }));

import { groupCostRows } from "../cost";

const base = { projectId: "p1", title: "Fix it", status: "done", externalProvider: "linear", updatedAt: new Date("2026-11-14T20:00:00Z"), reasoningTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, firstAt: new Date("2026-11-14T19:00:00Z"), lastAt: new Date("2026-11-14T19:30:00Z") };

describe("groupCostRows", () => {
  it("folds per-account rows into one spend input per work item", () => {
    const items = groupCostRows([
      { ...base, workItemId: "w1", authIndex: "a1", sessions: 2, inputTokens: 10, outputTokens: 1, totalTokens: 11 },
      { ...base, workItemId: "w1", authIndex: "c1", sessions: 1, inputTokens: 5, outputTokens: 0, totalTokens: 5 },
      { ...base, workItemId: "w2", authIndex: "a1", sessions: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ workItemId: "w1", updatedAt: "2026-11-14T20:00:00.000Z" });
    expect(items[0]?.byAccount.map((a) => [a.authIndex, a.sessions, a.tokens.total])).toEqual([
      ["a1", 2, 11],
      ["c1", 1, 5],
    ]);
  });
});
