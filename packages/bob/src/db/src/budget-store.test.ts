import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PgliteDbHandle } from "./client-pglite.js";
import { makePgliteDb } from "./client-pglite.js";
import { applyMigrations, noop } from "./migrate.js";
import {
  readBudgetPolicy,
  readBudgetStateRows,
  recordBudgetDecision,
  recordMeterSamples,
  upsertBobSessions,
  upsertBudgetAccounts,
  upsertUsageBuckets,
  writeBudgetPolicy,
  type UsageBucketInput,
} from "./budget-store.js";

const DRIZZLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
const WS = "4b0f8e5e-3a5c-4a52-9a7a-5d1d6c0b9f01";
const HOST = "hetzner-bob";

const tokens = (n: number) => ({ input: n, output: n, reasoning: 0, cacheRead: n * 10, cacheCreation: n, total: n * 13 });

function bucket(over: Partial<UsageBucketInput> = {}): UsageBucketInput {
  return {
    hour: "2026-11-14T20:00:00.000Z",
    authIndex: "a1",
    provider: "claude",
    model: "claude-opus-5-5",
    source: "bob",
    requests: 2,
    failed: 0,
    tokens: tokens(100),
    ...over,
  };
}

describe("budget telemetry store", () => {
  let handle: PgliteDbHandle;
  let dir: string;

  beforeEach(async () => {
    handle = await makePgliteDb({ dataDir: ":memory:", bootstrap: false });
    dir = mkdtempSync(join(tmpdir(), "bob-budget-migration-"));
    for (const filename of ["0038_budget_telemetry.sql", "0039_budget_governor.sql"]) {
      writeFileSync(join(dir, filename), readFileSync(join(DRIZZLE_DIR, filename), "utf8"));
    }
    await applyMigrations({ client: handle.client, migrationsDir: dir, log: noop });
  });

  afterEach(async () => {
    await handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("has no column that could hold a key, an email or a client address", async () => {
    const result = await handle.db.execute(sql`
      select column_name from information_schema.columns
      where table_name in ('budget_meter_samples', 'budget_usage_ledger', 'budget_session_usage')`);
    const names = result.rows.map((row) => String(row.column_name));
    for (const banned of ["api_key", "email", "client_ip", "user_agent", "token"]) {
      expect(names).not.toContain(banned);
    }
  });

  it("upserts ledger buckets idempotently: resending the same totals changes nothing", async () => {
    await upsertUsageBuckets(handle.db, { workspaceId: WS, hostId: HOST, buckets: [bucket()] });
    await upsertUsageBuckets(handle.db, { workspaceId: WS, hostId: HOST, buckets: [bucket()] });
    const rows = await handle.db.execute(sql`select requests, total_tokens from budget_usage_ledger`);
    expect(rows.rows).toEqual([{ requests: 2, total_tokens: 1300 }]);
  });

  it("advances to larger running totals but never shrinks one", async () => {
    await upsertUsageBuckets(handle.db, { workspaceId: WS, hostId: HOST, buckets: [bucket({ requests: 5, tokens: tokens(500) })] });
    await upsertUsageBuckets(handle.db, { workspaceId: WS, hostId: HOST, buckets: [bucket({ requests: 1, tokens: tokens(10) })] });
    const rows = await handle.db.execute(sql`select requests, total_tokens from budget_usage_ledger`);
    expect(rows.rows).toEqual([{ requests: 5, total_tokens: 6500 }]);
  });

  it("keeps bob and interactive usage of the same account apart", async () => {
    await upsertUsageBuckets(handle.db, {
      workspaceId: WS,
      hostId: HOST,
      buckets: [bucket(), bucket({ source: "interactive", requests: 7 })],
    });
    const rows = await handle.db.execute(sql`select source, requests from budget_usage_ledger order by source`);
    expect(rows.rows).toEqual([
      { source: "bob", requests: 2 },
      { source: "interactive", requests: 7 },
    ]);
  });

  it("records each distinct meter observation once, for accounts and models", async () => {
    const meter = { window: "weekly", windowMinutes: 10_080, usedPercent: 47, resetsAt: "2026-11-15T12:00:00.000Z", status: "allowed", observedAt: "2026-11-14T20:06:13.006Z" };
    const accounts = [
      { id: "auth-0", provider: "claude", ref: { authIndex: "a1" }, meters: [meter], modelMeters: { "claude-opus-5-5": [meter] } },
      { id: "auth-4", provider: "kimi" },
    ];
    await recordMeterSamples(handle.db, { workspaceId: WS, hostId: HOST, accounts });
    await recordMeterSamples(handle.db, { workspaceId: WS, hostId: HOST, accounts });
    const rows = await handle.db.execute(sql`
      select account_id, auth_index, model, window_name, used_percent from budget_meter_samples order by model`);
    expect(rows.rows).toEqual([
      { account_id: "auth-0", auth_index: "a1", model: "", window_name: "weekly", used_percent: 47 },
      { account_id: "auth-0", auth_index: "a1", model: "claude-opus-5-5", window_name: "weekly", used_percent: 47 },
    ]);
  });

  it("merges Bob session totals and keeps the earliest start and latest meters", async () => {
    const base = {
      sessionId: "s-1",
      authIndex: "a1",
      provider: "claude",
      model: "claude-opus-5-5",
      failed: 0,
      firstAt: "2026-11-14T20:20:00.000Z",
      metersFirst: [{ window: "weekly", usedPercent: 47, observedAt: "2026-11-14T20:20:00.000Z" }],
    };
    await upsertBobSessions(handle.db, {
      workspaceId: WS,
      hostId: HOST,
      sessions: [{ ...base, requests: 1, tokens: tokens(1), lastAt: "2026-11-14T20:20:00.000Z", metersLast: base.metersFirst }],
    });
    await upsertBobSessions(handle.db, {
      workspaceId: WS,
      hostId: HOST,
      sessions: [
        {
          ...base,
          requests: 3,
          tokens: tokens(3),
          lastAt: "2026-11-14T20:40:00.000Z",
          metersLast: [{ window: "weekly", usedPercent: 49, observedAt: "2026-11-14T20:40:00.000Z" }],
        },
      ],
    });
    const rows = await handle.db.execute(sql`
      select requests, total_tokens, first_at, last_at, meters_last from budget_session_usage`);
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0]!;
    expect(row.requests).toBe(3);
    expect(row.total_tokens).toBe(39);
    expect(new Date(String(row.first_at)).toISOString()).toBe("2026-11-14T20:20:00.000Z");
    expect(new Date(String(row.last_at)).toISOString()).toBe("2026-11-14T20:40:00.000Z");
    expect((row.meters_last as Array<{ usedPercent: number }>)[0]!.usedPercent).toBe(49);
  });

  it("upserts account states and lets the latest heartbeat win", async () => {
    await upsertBudgetAccounts(handle.db, { workspaceId: WS, hostId: HOST, accounts: [{ id: "auth-1", provider: "claude", label: "m…@x.com", status: "error", detail: "invalid grant", ref: { authIndex: "a2" } }] });
    await upsertBudgetAccounts(handle.db, { workspaceId: WS, hostId: HOST, accounts: [{ id: "auth-1", provider: "claude", label: "m…@x.com", status: "ready" }] });
    const rows = await handle.db.execute(sql`select status, detail, auth_index from budget_accounts`);
    expect(rows.rows).toEqual([{ status: "ready", detail: null, auth_index: null }]);
  });

  it("writes the policy and records every change with its author", async () => {
    expect(await readBudgetPolicy(handle.db)).toBeUndefined();
    await writeBudgetPolicy(handle.db, { policy: { reservePct: 15 }, changedBy: "user-1" });
    await writeBudgetPolicy(handle.db, { policy: { reservePct: 20 }, changedBy: "user-1", note: "more headroom" });
    expect((await readBudgetPolicy(handle.db))?.policy).toEqual({ reservePct: 20 });
    const changes = await handle.db.execute(sql`select before, after, note from budget_policy_changes order by id`);
    expect(changes.rows).toEqual([
      { before: {}, after: { reservePct: 15 }, note: null },
      { before: { reservePct: 15 }, after: { reservePct: 20 }, note: "more headroom" },
    ]);
  });

  it("records decisions and reads back the governor state window", async () => {
    await recordBudgetDecision(handle.db, { enforce: false, mode: "run", totalSlots: 3, legacyBudget: 2, verdict: { a: 1 }, inputs: { b: 2 } });
    const now = new Date("2026-11-14T21:00:00Z");
    await upsertBudgetAccounts(handle.db, { workspaceId: WS, hostId: HOST, accounts: [{ id: "auth-0", provider: "claude", label: "m…@x.com", status: "ready", ref: { authIndex: "a1" } }] });
    await upsertUsageBuckets(handle.db, { workspaceId: WS, hostId: HOST, buckets: [bucket(), bucket({ hour: "2026-11-10T00:00:00.000Z" })] });
    const state = await readBudgetStateRows(handle.db, { now, accountMaxAgeHours: 1e6 });
    expect(state.accounts.map((a) => a.accountId)).toEqual(["auth-0"]);
    expect(state.ledger.map((l) => l.hour.toISOString())).toEqual(["2026-11-14T20:00:00.000Z"]);
    const decisions = await handle.db.execute(sql`select total_slots, legacy_budget from budget_decisions`);
    expect(decisions.rows).toEqual([{ total_slots: 3, legacy_budget: 2 }]);
  });
});
