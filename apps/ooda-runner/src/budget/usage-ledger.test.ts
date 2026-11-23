import { describe, expect, it } from "vitest";

import { UsageLedger, type UsageQueueRecord } from "./usage-ledger";

// Field names follow a /v0/management/usage-queue record recorded from the
// production proxy on 2026-11-14 (fork 3bd9e323). Values here are synthetic.
const BOB_KEY = "sk-bob-runner-key-000000000000000000000000000000000000";
const MY_KEY = "sk-interactive-key-0000000000000000000000000000000000000";

function record(over: Partial<UsageQueueRecord> = {}): UsageQueueRecord {
  return {
    timestamp: "2026-11-14T15:20:31.5-05:00",
    provider: "claude",
    model: "claude-opus-5-5",
    auth_index: "a1",
    auth_type: "oauth",
    api_key: BOB_KEY,
    session_id: "0b0e5b84-4b1a-4a6e-9a3e-0c9d7b0f1a11",
    client_ip: "100.64.0.7",
    user_agent: "claude-cli/2.1",
    failed: false,
    tokens: {
      input_tokens: 2,
      output_tokens: 279,
      reasoning_tokens: 0,
      cached_tokens: 231_413,
      cache_read_tokens: 231_413,
      cache_creation_tokens: 980,
      total_tokens: 232_674,
    },
    response_headers: {
      "Anthropic-Ratelimit-Unified-7d-Utilization": ["0.47"],
      "Anthropic-Ratelimit-Unified-7d-Reset": ["1794744000"],
      "Anthropic-Organization-Id": ["org-secret"],
    },
    ...over,
  };
}

const ledger = () => new UsageLedger({ bobApiKeys: [BOB_KEY] });

describe("UsageLedger attribution", () => {
  it("attributes the runner's own key to bob and every other key to interactive", () => {
    const l = ledger();
    l.ingest([record(), record({ api_key: MY_KEY, session_id: "mine" })]);
    const sources = l.buckets().map((bucket) => bucket.source).sort();
    expect(sources).toEqual(["bob", "interactive"]);
  });

  it("keys hourly buckets by hour, account, model and source and sums tokens", () => {
    const l = ledger();
    l.ingest([record(), record({ timestamp: "2026-11-14T20:59:59Z" }), record({ timestamp: "2026-11-14T21:00:00Z" })]);
    const buckets = l.buckets();
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toEqual({
      hour: "2026-11-14T20:00:00.000Z",
      authIndex: "a1",
      provider: "claude",
      model: "claude-opus-5-5",
      source: "bob",
      requests: 2,
      failed: 0,
      tokens: { input: 4, output: 558, reasoning: 0, cacheRead: 462_826, cacheCreation: 1_960, total: 465_348 },
    });
  });

  it("counts failures without dropping their tokens", () => {
    const l = ledger();
    l.ingest([record({ failed: true })]);
    expect(l.buckets()[0]).toMatchObject({ requests: 1, failed: 1 });
  });
});

describe("UsageLedger Bob sessions", () => {
  it("totals each Bob session and records the meters it started and ended on", () => {
    const l = ledger();
    l.ingest([
      record(),
      record({
        timestamp: "2026-11-14T20:40:00Z",
        response_headers: { "Anthropic-Ratelimit-Unified-7d-Utilization": ["0.49"] },
      }),
    ]);
    const [session] = l.sessions();
    expect(session).toMatchObject({
      sessionId: "0b0e5b84-4b1a-4a6e-9a3e-0c9d7b0f1a11",
      authIndex: "a1",
      provider: "claude",
      model: "claude-opus-5-5",
      requests: 2,
      firstAt: "2026-11-14T20:20:31.500Z",
      lastAt: "2026-11-14T20:40:00.000Z",
    });
    expect(session?.metersFirst?.[0]).toMatchObject({ window: "weekly", usedPercent: 47 });
    expect(session?.metersLast?.[0]).toMatchObject({ window: "weekly", usedPercent: 49 });
  });

  it("keeps no session record for interactive traffic", () => {
    const l = ledger();
    l.ingest([record({ api_key: MY_KEY })]);
    expect(l.sessions()).toEqual([]);
  });
});

describe("UsageLedger redaction", () => {
  it("never emits keys, addresses, user agents, interactive session ids or raw headers", () => {
    const l = ledger();
    l.ingest([record(), record({ api_key: MY_KEY, session_id: "interactive-session-id" })]);
    const wire = JSON.stringify({ buckets: l.buckets(), sessions: l.sessions() });
    for (const secret of [BOB_KEY, MY_KEY, "100.64.0.7", "claude-cli", "interactive-session-id", "org-secret", "Organization"]) {
      expect(wire).not.toContain(secret);
    }
  });
});

describe("UsageLedger robustness and retention", () => {
  it("skips malformed records instead of failing the batch", () => {
    const l = ledger();
    l.ingest([{ timestamp: "not a time" } as UsageQueueRecord, record()]);
    expect(l.buckets()).toHaveLength(1);
  });

  it("only reports what changed since a cursor, and forgets data older than the retention window", () => {
    const l = new UsageLedger({ bobApiKeys: [BOB_KEY], retentionHours: 2 });
    l.ingest([record({ timestamp: "2026-11-14T10:00:00Z" })]);
    const cursor = l.revision();
    l.ingest([record({ timestamp: "2026-11-14T20:00:00Z" })]);
    expect(l.buckets({ since: cursor }).map((b) => b.hour)).toEqual(["2026-11-14T20:00:00.000Z"]);
    l.prune(new Date("2026-11-14T21:00:00Z"));
    expect(l.buckets().map((b) => b.hour)).toEqual(["2026-11-14T20:00:00.000Z"]);
  });

  it("round-trips through its own serialized state, so a restart loses nothing", () => {
    const l = ledger();
    l.ingest([record()]);
    const restored = UsageLedger.restore({ bobApiKeys: [BOB_KEY] }, JSON.parse(JSON.stringify(l.toJSON())));
    expect(restored.buckets()).toEqual(l.buckets());
    expect(restored.sessions()).toEqual(l.sessions());
  });
});

describe("UsageLedger session links", () => {
  it("records a native → Bob session link once, reports it after a cursor and survives restore", () => {
    const l = ledger();
    const cursor = l.revision();
    l.linkSession("4743021e-110b-4f42-8f50-530699139927", "bob-run-1", new Date("2026-11-14T20:00:00Z"));
    l.linkSession("4743021e-110b-4f42-8f50-530699139927", "bob-run-1");
    expect(l.links({ since: cursor })).toEqual([
      { nativeSessionId: "4743021e-110b-4f42-8f50-530699139927", bobSessionId: "bob-run-1", linkedAt: "2026-11-14T20:00:00.000Z" },
    ]);
    const restored = UsageLedger.restore({ bobApiKeys: [BOB_KEY] }, JSON.parse(JSON.stringify(l.toJSON())));
    expect(restored.links()).toEqual(l.links());
  });
});
