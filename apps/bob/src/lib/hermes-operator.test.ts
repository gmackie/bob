import { describe, expect, it, vi } from "vitest";

import {
  createHermesJournalUsageSink,
  createHermesOperatorService,
  createOodaHermesCaptureClient,
  type HermesUsageRecord,
} from "./hermes-operator";

describe("Hermes operator service", () => {
  it("captures once through OODA and emits only categorized usage", async () => {
    const capture = vi.fn(async () => ({
      schemaVersion: 1 as const,
      requestId: "telegram:4512:9918",
      replayed: false,
      canonicalRef: { kind: "conversation_event" as const, id: "event-42" },
      occurredAt: "2026-08-21T13:30:00Z",
    }));
    const record = vi.fn(async (_value: HermesUsageRecord) => undefined);
    const service = createHermesOperatorService({
      ooda: { capture },
      usage: { record },
      conversation: { id: "conversation-42", branchId: "branch-42" },
      digestRequestId: () => `sha256:${"a".repeat(64)}`,
      now: () => new Date("2026-08-21T13:30:02Z"),
    });

    await expect(
      service.handle({
        schemaVersion: 1,
        requestId: "telegram:4512:9918",
        intent: "capture",
        channel: "telegram",
        occurredAt: "2026-08-21T13:30:00Z",
        payload: { text: "Remember the lab workflow." },
      }),
    ).resolves.toMatchObject({
      intent: "capture.receipt",
      owner: "ooda",
      riskClass: "R1",
      canonicalRef: { kind: "conversation_event", id: "event-42" },
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "telegram:4512:9918",
      text: "Remember the lab workflow.",
    }));
    expect(record).toHaveBeenCalledWith({
      requestIdDigest: `sha256:${"a".repeat(64)}`,
      intent: "capture",
      channel: "telegram",
      owner: "ooda",
      riskClass: "R1",
      outcome: "success",
      durationBucket: "1-10s",
      evidence: "complete",
      observedAt: "2026-08-21T13:30:02.000Z",
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain("lab workflow");
  });

  it("routes today, status, and close through read/private-reflection adapters", async () => {
    const record = vi.fn(async (_value: HermesUsageRecord) => undefined);
    const service = createHermesOperatorService({
      ooda: { capture: vi.fn() },
      usage: { record },
      conversation: { id: "conversation-42", branchId: "branch-42" },
      digestRequestId: () => `sha256:${"a".repeat(64)}`,
      now: () => new Date("2026-08-21T13:30:02Z"),
      briefing: {
        today: vi.fn(async () => ({
          schemaVersion: 1 as const,
          kind: "morning" as const,
          generatedAt: "2026-08-21T13:30:00Z",
          sections: [],
          gaps: ["forgegraph did not report"],
        })),
        close: vi.fn(async () => ({
          schemaVersion: 1 as const,
          kind: "evening" as const,
          generatedAt: "2026-08-21T22:00:00Z",
          sections: { completed: [], blocked: [], waiting: [], captured: [], tomorrow: [] },
          gaps: ["forgegraph reported partial coverage"],
        })),
      },
      status: {
        read: vi.fn(async () => ({
          summary: "Release build passed; installation proof is missing.",
          canonicalRef: { kind: "work-item", id: "release-42" },
          observedAt: "2026-08-21T13:29:00Z",
          coverage: "partial" as const,
        })),
      },
    });
    const base = {
      schemaVersion: 1,
      channel: "telegram",
      occurredAt: "2026-08-21T13:30:00Z",
    } as const;

    await expect(service.handle({ ...base, requestId: "today-1", intent: "today", payload: {} }))
      .resolves.toMatchObject({ intent: "today.brief", owner: "bob", freshness: { coverage: "partial" } });
    await expect(service.handle({
      ...base,
      requestId: "status-1",
      intent: "status",
      payload: { query: "Where is the release?" },
    })).resolves.toMatchObject({ intent: "status.result", owner: "bob", freshness: { coverage: "partial" } });
    await expect(service.handle({ ...base, requestId: "close-1", intent: "close", payload: {} }))
      .resolves.toMatchObject({ intent: "close.summary", owner: "ooda", freshness: { coverage: "partial" } });

    expect(record).toHaveBeenCalledTimes(3);
    expect(record.mock.calls.map(([value]) => value.intent)).toEqual(["today", "status", "close"]);
    expect(record.mock.calls.map(([value]) => value.evidence)).toEqual(["partial", "partial", "partial"]);
  });

  it("serializes the normalized usage record for Skillfleet's replay-safe journal collector", async () => {
    const append = vi.fn(async (_line: string) => undefined);
    const sink = createHermesJournalUsageSink({ append });

    await sink.record({
      requestIdDigest: `sha256:${"a".repeat(64)}`,
      intent: "capture",
      channel: "telegram",
      owner: "ooda",
      riskClass: "R1",
      outcome: "success",
      durationBucket: "1-10s",
      evidence: "complete",
      observedAt: "2026-08-21T13:30:02.000Z",
    });

    expect(append).toHaveBeenCalledTimes(1);
    const line = append.mock.calls[0]![0];
    expect(JSON.parse(line)).toMatchObject({
      schemaVersion: 1,
      source: "bob",
      kind: "hermes_usage",
      sessionIdDigest: null,
      projectIdDigest: null,
      payload: { intent: "capture", channel: "telegram", outcome: "success" },
    });
    expect(JSON.parse(line).recordId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(line.endsWith("\n")).toBe(true);
    expect(line).not.toContain("telegram:4512:9918");
  });

  it("calls the owner-scoped OODA capture resource with its API key", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      schemaVersion: 1,
      requestId: "telegram:4512:9918",
      replayed: false,
      canonicalRef: { kind: "conversation_event", id: "event-42" },
      occurredAt: "2026-08-21T13:30:00Z",
    }));
    const client = createOodaHermesCaptureClient({
      origin: "https://ooda.example.com/",
      apiKey: "owner-scoped-api-key",
      fetch: fetchImpl,
    });
    const input = {
      schemaVersion: 1 as const,
      requestId: "telegram:4512:9918",
      conversationId: "conversation-42",
      branchId: "branch-42",
      text: "Remember the lab workflow.",
      occurredAt: "2026-08-21T13:30:00Z",
    };

    await expect(client.capture(input)).resolves.toMatchObject({
      canonicalRef: { kind: "conversation_event", id: "event-42" },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://ooda.example.com/api/v1/hermes/capture",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer owner-scoped-api-key",
          "content-type": "application/json",
        }),
        body: JSON.stringify(input),
      }),
    );
  });
});
