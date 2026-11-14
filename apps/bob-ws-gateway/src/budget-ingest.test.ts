import { describe, expect, it, vi } from "vitest";

import { ingestAccountStates, ingestBudgetUsage, ingestMeterSamples, type BudgetStore } from "./budget-ingest";

const WS = "4b0f8e5e-3a5c-4a52-9a7a-5d1d6c0b9f01";
const tokens = { input: 1, output: 2, reasoning: 0, cacheRead: 3, cacheCreation: 4, total: 10 };
const bucket = { hour: "2026-11-14T20:00:00.000Z", authIndex: "a1", provider: "claude", model: "m", source: "bob", requests: 1, failed: 0, tokens };
const session = { sessionId: "s", authIndex: "a1", provider: "claude", model: "m", requests: 1, failed: 0, tokens, firstAt: bucket.hour, lastAt: bucket.hour };

function store(): BudgetStore & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = { buckets: [], sessions: [], meters: [], accounts: [] };
  return {
    calls,
    upsertUsageBuckets: vi.fn(async (_db, input) => (calls.buckets!.push(input), input.buckets.length)),
    upsertBobSessions: vi.fn(async (_db, input) => (calls.sessions!.push(input), input.sessions.length)),
    recordMeterSamples: vi.fn(async (_db, input) => (calls.meters!.push(input), input.accounts.length)),
    upsertBudgetAccounts: vi.fn(async (_db, input) => (calls.accounts!.push(input), input.accounts.length)),
  };
}

describe("ingestBudgetUsage", () => {
  it("passes well-formed buckets and sessions to the store under the daemon's workspace and host", async () => {
    const s = store();
    await ingestBudgetUsage({} as never, s, { workspaceId: WS, hostId: "hetzner-bob" }, { buckets: [bucket], sessions: [session] });
    expect(s.calls.buckets).toEqual([{ workspaceId: WS, hostId: "hetzner-bob", buckets: [bucket] }]);
    expect(s.calls.sessions).toEqual([{ workspaceId: WS, hostId: "hetzner-bob", sessions: [session] }]);
  });

  it("drops malformed rows and never calls the store with an empty batch", async () => {
    const s = store();
    await ingestBudgetUsage({} as never, s, { workspaceId: WS, hostId: "h" }, {
      buckets: [null, "x", { ...bucket, source: "someone-else" }, { ...bucket, tokens: "lots" }, { ...bucket, requests: -1 }],
      sessions: "not a list",
    });
    expect(s.calls.buckets).toEqual([]);
    expect(s.calls.sessions).toEqual([]);
  });

  it("refuses oversized messages instead of writing part of them", async () => {
    const s = store();
    const many = Array.from({ length: 5_001 }, () => bucket);
    await expect(ingestBudgetUsage({} as never, s, { workspaceId: WS, hostId: "h" }, { buckets: many, sessions: [] })).rejects.toThrow(/too many/);
    expect(s.calls.buckets).toEqual([]);
  });

  it("drops fields it does not know rather than storing them", async () => {
    const s = store();
    await ingestBudgetUsage({} as never, s, { workspaceId: WS, hostId: "h" }, { buckets: [{ ...bucket, api_key: "sk-leak" }], sessions: [] });
    expect(JSON.stringify(s.calls.buckets)).not.toContain("sk-leak");
  });
});

describe("ingestMeterSamples", () => {
  it("records meters of the proxy accounts in a host snapshot and ignores snapshots without them", async () => {
    const s = store();
    const accounts = [{ id: "auth-0", provider: "claude", meters: [{ window: "weekly", usedPercent: 47, observedAt: bucket.hour }] }];
    await ingestMeterSamples({} as never, s, { workspaceId: WS, hostId: "h" }, { proxy: { accounts } } as never);
    await ingestMeterSamples({} as never, s, { workspaceId: WS, hostId: "h" }, { proxy: { accounts: [{ id: "k", provider: "kimi" }] } } as never);
    await ingestMeterSamples({} as never, s, { workspaceId: WS, hostId: "h" }, {} as never);
    expect(s.calls.meters).toHaveLength(1);
    expect(s.calls.meters![0]).toMatchObject({ accounts: [{ id: "auth-0" }] });
  });
});

describe("ingestAccountStates", () => {
  it("records every account's status, including unmetered ones, and drops unknown statuses", async () => {
    const s = store();
    await ingestAccountStates({} as never, s, { workspaceId: WS, hostId: "h" }, {
      proxy: {
        accounts: [
          { id: "auth-1", provider: "claude", label: "m…@x.com", status: "error", detail: "invalid grant", ref: { authIndex: "a2" } },
          { id: "kimi", provider: "kimi", label: "k…@x.com", status: "ready" },
          { id: "odd", provider: "grok", label: "x", status: "sideways" },
        ],
      },
    } as never);
    expect(s.calls.accounts).toEqual([
      {
        workspaceId: WS,
        hostId: "h",
        accounts: [
          { id: "auth-1", provider: "claude", label: "m…@x.com", status: "error", detail: "invalid grant", ref: { authIndex: "a2" } },
          { id: "kimi", provider: "kimi", label: "k…@x.com", status: "ready" },
        ],
      },
    ]);
  });
});
