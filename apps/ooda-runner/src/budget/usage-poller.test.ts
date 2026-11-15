import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UsagePoller } from "./usage-poller";
import type { UsageQueueRecord } from "./usage-ledger";

const BOB_KEY = "sk-bob-runner-key";
const MGMT_KEY = "mgmt-secret";

function record(at: string, over: Partial<UsageQueueRecord> = {}): UsageQueueRecord {
  return {
    timestamp: at,
    provider: "codex",
    model: "gpt-6.1-sol",
    auth_index: "c1",
    api_key: BOB_KEY,
    session_id: "sess-1",
    tokens: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    ...over,
  };
}

/** A usage queue that pops destructively, like the proxy's. */
function fakeProxy(initial: UsageQueueRecord[] = []) {
  const queue = [...initial];
  const calls: Array<{ url: string; auth: string | null }> = [];
  let failNext = false;
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    if (failNext) {
      failNext = false;
      return new Response("down", { status: 502 });
    }
    const count = Number(new URL(url).searchParams.get("count"));
    return Response.json(queue.splice(0, count));
  }) as typeof globalThis.fetch;
  return { queue, calls, fetch, fail: () => (failNext = true) };
}

describe("UsagePoller", () => {
  let dir: string;
  let sent: Array<Record<string, unknown>>;
  let connected: boolean;
  let clock: Date;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bob-usage-poller-"));
    sent = [];
    connected = true;
    clock = new Date("2026-11-14T20:30:00Z");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const make = (proxy: ReturnType<typeof fakeProxy>, over: Partial<ConstructorParameters<typeof UsagePoller>[0]> = {}) =>
    new UsagePoller({
      baseUrl: "http://proxy.test:8317/",
      managementKey: MGMT_KEY,
      bobApiKeys: [BOB_KEY],
      spoolPath: join(dir, "usage-ledger.json"),
      send: (message) => {
        sent.push(message);
      },
      isConnected: () => connected,
      fetch: proxy.fetch,
      now: () => clock,
      batchSize: 2,
      ...over,
    });

  it("drains the queue in batches with the management key until it is empty", async () => {
    const proxy = fakeProxy([record("2026-11-14T20:01:00Z"), record("2026-11-14T20:02:00Z"), record("2026-11-14T20:03:00Z")]);
    const poller = make(proxy);
    const drained = await poller.drain();
    expect(drained).toBe(3);
    expect(proxy.calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v0/management/usage-queue",
      "/v0/management/usage-queue",
    ]);
    expect(proxy.calls.every((call) => call.auth === `Bearer ${MGMT_KEY}`)).toBe(true);
  });

  it("sends running totals as one budget_usage message and nothing when unchanged", async () => {
    const poller = make(fakeProxy([record("2026-11-14T20:01:00Z")]));
    await poller.tick();
    await poller.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "budget_usage",
      buckets: [{ hour: "2026-11-14T20:00:00.000Z", source: "bob", requests: 1 }],
      sessions: [{ sessionId: "sess-1", requests: 1 }],
    });
  });

  it("holds changes while disconnected and sends them on reconnect", async () => {
    const proxy = fakeProxy([record("2026-11-14T20:01:00Z")]);
    const poller = make(proxy);
    connected = false;
    await poller.tick();
    expect(sent).toHaveLength(0);
    connected = true;
    await poller.tick();
    expect(sent).toHaveLength(1);
  });

  it("periodically resends recent totals so a dropped message is repaired", async () => {
    const poller = make(fakeProxy([record("2026-11-14T20:01:00Z")]), { resendEveryMs: 600_000 });
    await poller.tick();
    clock = new Date(clock.getTime() + 601_000);
    await poller.tick();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ buckets: [{ requests: 1 }] });
  });

  it("persists the ledger so a restart resumes from the spool, holding no keys", async () => {
    const proxy = fakeProxy([record("2026-11-14T20:01:00Z")]);
    await make(proxy).tick();
    const spool = readFileSync(join(dir, "usage-ledger.json"), "utf8");
    expect(spool).not.toContain(BOB_KEY);
    expect(spool).not.toContain(MGMT_KEY);

    proxy.queue.push(record("2026-11-14T20:05:00Z"));
    sent = [];
    const restarted = make(proxy);
    await restarted.tick();
    expect(sent.at(-1)).toMatchObject({ buckets: [{ requests: 2 }] });
  });

  it("reports a collection gap long enough to have lost records", async () => {
    const proxy = fakeProxy();
    const poller = make(proxy);
    await poller.tick();
    proxy.fail();
    clock = new Date(clock.getTime() + 20_000);
    await poller.tick();
    clock = new Date(clock.getTime() + 30_000);
    await poller.tick();
    expect(poller.status()).toMatchObject({ lastError: undefined, gapsOver45s: 1 });
  });

  it("does nothing without a management key", async () => {
    const proxy = fakeProxy([record("2026-11-14T20:01:00Z")]);
    const poller = make(proxy, { managementKey: undefined });
    await poller.tick();
    expect(proxy.calls).toHaveLength(0);
    expect(sent).toHaveLength(0);
    expect(existsSync(join(dir, "usage-ledger.json"))).toBe(false);
  });
});

describe("UsagePoller session links", () => {
  it("ships links with the next budget_usage message even when no usage changed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bob-usage-links-"));
    const sent: Array<Record<string, unknown>> = [];
    const proxy = fakeProxy();
    const poller = new UsagePoller({
      baseUrl: "http://proxy.test",
      managementKey: MGMT_KEY,
      bobApiKeys: [BOB_KEY],
      spoolPath: join(dir, "ledger.json"),
      send: (m) => {
        sent.push(m);
      },
      isConnected: () => true,
      fetch: proxy.fetch,
      now: () => new Date("2026-11-14T20:30:00Z"),
    });
    await poller.tick();
    poller.linkSession("native-1234", "bob-run-1");
    await poller.tick();
    expect(sent.at(-1)).toMatchObject({ type: "budget_usage", links: [{ nativeSessionId: "native-1234", bobSessionId: "bob-run-1" }] });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("UsagePoller runaway guard", () => {
  it("flags a linked Bob run once when its weighted tokens pass the cap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bob-usage-runaway-"));
    const flagged: string[] = [];
    const proxy = fakeProxy([record("2026-11-14T20:01:00Z"), record("2026-11-14T20:02:00Z")]);
    const poller = new UsagePoller({
      baseUrl: "http://proxy.test",
      managementKey: MGMT_KEY,
      bobApiKeys: [BOB_KEY],
      spoolPath: join(dir, "ledger.json"),
      send: () => {},
      isConnected: () => false,
      fetch: proxy.fetch,
      now: () => new Date("2026-11-14T20:30:00Z"),
      runWeightedTokenCap: 50,
      onRunaway: (run) => flagged.push(run),
    });
    poller.linkSession("sess-1", "bob-run-1");
    await poller.tick();
    proxy.queue.push(record("2026-11-14T20:03:00Z"));
    await poller.tick();
    // Each record weighs 10 input + 5×5 output = 35; two records pass 50.
    expect(flagged).toEqual(["bob-run-1"]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("UsagePoller delivery and links-only mode", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bob-usage-delivery-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps changes queued when send reports failure and delivers them on the next tick", async () => {
    const proxy = fakeProxy([record("2026-11-14T20:01:00Z")]);
    const sent: Array<Record<string, unknown>> = [];
    let up = false;
    const poller = new UsagePoller({
      baseUrl: "http://proxy.test",
      managementKey: MGMT_KEY,
      bobApiKeys: [BOB_KEY],
      spoolPath: join(dir, "ledger.json"),
      send: async (message) => {
        if (!up) return false;
        sent.push(message);
        return true;
      },
      isConnected: () => true,
      fetch: proxy.fetch,
      now: () => new Date("2026-11-14T20:30:00Z"),
    });
    await poller.tick();
    expect(sent).toEqual([]);
    expect(poller.status().sendFailures).toBe(1);
    up = true;
    await poller.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ buckets: [{ requests: 1, source: "bob" }] });
    await poller.tick();
    expect(sent).toHaveLength(1);
    expect(poller.status().lastSentAt).toBe("2026-11-14T20:30:00.000Z");
  });

  it("treats a throwing send as undelivered", async () => {
    const proxy = fakeProxy([record("2026-11-14T20:01:00Z")]);
    let calls = 0;
    const poller = new UsagePoller({
      baseUrl: "http://proxy.test",
      managementKey: MGMT_KEY,
      bobApiKeys: [BOB_KEY],
      spoolPath: join(dir, "ledger.json"),
      send: () => {
        calls += 1;
        if (calls === 1) throw new Error("socket closed");
      },
      isConnected: () => true,
      fetch: proxy.fetch,
      now: () => new Date("2026-11-14T20:30:00Z"),
    });
    await poller.tick();
    await poller.tick();
    expect(calls).toBe(2);
    expect(poller.status().sendFailures).toBe(1);
  });

  it("never touches the queue when another process drains it, but still ships session links", async () => {
    const proxy = fakeProxy([record("2026-11-14T20:01:00Z")]);
    const sent: Array<Record<string, unknown>> = [];
    const poller = new UsagePoller({
      baseUrl: "http://proxy.test",
      bobApiKeys: [],
      drainQueue: false,
      spoolPath: join(dir, "ledger.json"),
      send: (message) => {
        sent.push(message);
      },
      isConnected: () => true,
      fetch: proxy.fetch,
      now: () => new Date("2026-11-14T20:30:00Z"),
    });
    poller.start();
    poller.linkSession("native-1", "bob-run-1");
    await poller.tick();
    poller.stop();
    expect(proxy.calls).toEqual([]);
    expect(proxy.queue).toHaveLength(1);
    expect(sent.at(-1)).toMatchObject({ type: "budget_usage", buckets: [], sessions: [], links: [{ nativeSessionId: "native-1", bobSessionId: "bob-run-1" }] });
  });
});
