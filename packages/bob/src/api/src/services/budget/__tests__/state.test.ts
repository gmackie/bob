import { describe, expect, it, vi } from "vitest";

vi.mock("@bob/db/client", () => ({ db: {} }));

import { DEFAULT_BUDGET_POLICY, governState } from "@bob/ws";
import type { BudgetStateRows } from "@bob/db";

import { nextBudgetedAgent, rowsToBudgetState } from "../state";

const NOW = new Date("2026-11-14T20:00:00Z");
const tok = { inputTokens: 10, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 100, cacheCreationTokens: 2, totalTokens: 113 };

const rows: BudgetStateRows = {
  accounts: [
    { accountId: "codex-a", provider: "codex", label: "m…@x.com", status: "ready", detail: null, authIndex: "c1", updatedAt: NOW },
    { accountId: "claude-a", provider: "claude", label: "m…@x.com", status: "ready", detail: null, authIndex: "a1", updatedAt: NOW },
  ],
  meters: [
    { accountId: "claude-a", windowName: "weekly", windowMinutes: 10_080, usedPercent: 47, resetsAt: new Date("2026-11-15T12:00:00Z"), status: "allowed", observedAt: NOW },
  ],
  ledger: [
    { hour: new Date("2026-11-14T19:00:00Z"), authIndex: "a1", provider: "claude", model: "opus", source: "bob", requests: 3, failed: 0, ...tok },
    { hour: new Date("2026-11-14T19:00:00Z"), authIndex: "a1", provider: "claude", model: "opus", source: "bogus", requests: 3, failed: 0, ...tok },
  ],
  sessions: [{ sessionId: "s", authIndex: "a1", provider: "claude", model: "opus", requests: 3, ...tok, firstAt: NOW, lastAt: NOW }],
};

describe("rowsToBudgetState", () => {
  it("maps rows to the wire snapshot, sorted, with ISO times and unknown sources dropped", () => {
    const state = rowsToBudgetState(rows, DEFAULT_BUDGET_POLICY, { claude: 1 }, NOW);
    expect(state.accounts.map((a) => a.accountId)).toEqual(["claude-a", "codex-a"]);
    expect(state.meters[0]).toEqual({
      accountId: "claude-a",
      window: "weekly",
      windowMinutes: 10_080,
      usedPercent: 47,
      resetsAt: "2026-11-15T12:00:00.000Z",
      status: "allowed",
      observedAt: NOW.toISOString(),
    });
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]?.tokens).toEqual({ input: 10, output: 1, reasoning: 0, cacheRead: 100, cacheCreation: 2, total: 113 });
    expect(state.activeByProvider).toEqual({ claude: 1 });
  });

  it("produces a snapshot the governor accepts end to end", () => {
    const { verdict } = governState(rowsToBudgetState(rows, DEFAULT_BUDGET_POLICY, {}, NOW), NOW);
    expect(verdict.enforce).toBe(false);
    expect(verdict.accounts.map((a) => a.accountId)).toEqual(["claude-a", "codex-a"]);
  });
});

describe("nextBudgetedAgent", () => {
  it("picks the governed agent with the most remaining slots and never an ungoverned one", () => {
    const remaining = new Map([
      ["claude", 1],
      ["codex", 3],
    ]);
    expect(nextBudgetedAgent(["claude", "codex", "cursor"], remaining)).toBe("codex");
    expect(nextBudgetedAgent(["cursor"], remaining)).toBeUndefined();
    expect(nextBudgetedAgent(["claude", "codex"], new Map())).toBeUndefined();
  });
});
