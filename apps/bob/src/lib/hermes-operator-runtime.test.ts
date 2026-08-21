import { describe, expect, it, vi } from "vitest";

import { createHermesOperatorRuntime } from "./hermes-operator-runtime";

describe("Hermes operator runtime", () => {
  it("owner-binds capture and persists only digested categorical usage", async () => {
    const record = vi.fn(async () => undefined);
    const fetch = vi.fn(async () =>
      Response.json({
        schemaVersion: 1,
        requestId: "telegram:1",
        replayed: false,
        canonicalRef: { kind: "conversation_event", id: "event-1" },
        occurredAt: "2026-08-21T13:30:00Z",
      }),
    );
    const runtime = createHermesOperatorRuntime(
      {
        ownerUserId: "user-1",
        oodaOrigin: "https://ooda.example.com",
        oodaApiKey: "ooda-secret",
        conversationId: "conversation-1",
        branchId: "branch-1",
        digestSecret: "digest-secret",
        fetch,
      },
      { usage: { record } },
    );
    const auth = {
      keyId: "key-1",
      userId: "user-1",
      permissions: ["write" as const],
    };

    expect(runtime.authorize(auth)).toBe(true);
    expect(runtime.authorize({ ...auth, userId: "user-2" })).toBe(false);
    await runtime.createService(auth).handle({
      schemaVersion: 1,
      requestId: "telegram:1",
      intent: "capture",
      channel: "telegram",
      occurredAt: "2026-08-21T13:30:00Z",
      payload: { text: "private capture text" },
    });

    expect(record).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(record.mock.calls[0]);
    expect(serialized).not.toContain("private capture text");
    expect(serialized).not.toContain("telegram:1");
    expect(serialized).not.toContain("user-1");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "capture",
        channel: "telegram",
        owner: "ooda",
        riskClass: "R1",
        outcome: "success",
        evidence: "complete",
        recordId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        requestIdDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        actorUserIdDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    );
  });

  it("assembles today from the available Bob reader and preserves missing-source gaps", async () => {
    const runtime = createHermesOperatorRuntime(
      {
        ownerUserId: "user-1",
        oodaOrigin: "https://ooda.example.com",
        oodaApiKey: "ooda-secret",
        conversationId: "conversation-1",
        branchId: "branch-1",
        digestSecret: "digest-secret",
      },
      {
        usage: { record: async () => undefined },
        briefingSources: {
          bob: {
            read: async () => ({
              source: "bob",
              observedAt: "2026-08-21T14:00:00.000Z",
              coverage: "complete",
              total: 1,
              items: [
                {
                  label: "BLOCKED · BOB-17 · Deploy the Hermes operator route",
                  canonicalRef: { kind: "work-item", id: "work-1" },
                },
              ],
            }),
          },
        },
      },
    );
    const auth = {
      keyId: "key-1",
      userId: "user-1",
      permissions: ["read" as const],
    };

    await expect(
      runtime.createService(auth).handle({
        schemaVersion: 1,
        requestId: "telegram:today:1",
        intent: "today",
        channel: "telegram",
        occurredAt: "2026-08-21T14:00:00Z",
        payload: {},
      }),
    ).resolves.toMatchObject({
      intent: "today.brief",
      freshness: { coverage: "partial" },
      data: {
        sections: [
          { source: "ooda", coverage: "unknown", total: 0 },
          {
            source: "bob",
            coverage: "complete",
            total: 1,
            items: [
              {
                canonicalRef: { kind: "work-item", id: "work-1" },
              },
            ],
          },
          { source: "skillfleet", coverage: "unknown", total: 0 },
          { source: "forgegraph", coverage: "unknown", total: 0 },
        ],
        gaps: [
          "ooda did not report",
          "skillfleet did not report",
          "forgegraph did not report",
        ],
      },
    });
  });

  it("routes status through the canonical Bob status reader", async () => {
    const runtime = createHermesOperatorRuntime(
      {
        ownerUserId: "user-1",
        oodaOrigin: "https://ooda.example.com",
        oodaApiKey: "ooda-secret",
        conversationId: "conversation-1",
        branchId: "branch-1",
        digestSecret: "digest-secret",
      },
      {
        usage: { record: async () => undefined },
        statusReader: {
          read: async (query) => ({
            summary: `${query} is verified in Bob.`,
            canonicalRef: { kind: "work-item", id: "work-17" },
            observedAt: "2026-08-21T14:00:00.000Z",
            coverage: "complete" as const,
          }),
        },
      },
    );

    await expect(
      runtime.createService({
        keyId: "key-1",
        userId: "user-1",
        permissions: ["read"],
      }).handle({
        schemaVersion: 1,
        requestId: "telegram:status:1",
        intent: "status",
        channel: "telegram",
        occurredAt: "2026-08-21T14:00:00Z",
        payload: { query: "BOB-17" },
      }),
    ).resolves.toMatchObject({
      intent: "status.result",
      summary: "BOB-17 is verified in Bob.",
      canonicalRef: { kind: "work-item", id: "work-17" },
      freshness: { coverage: "complete" },
    });
  });

  it("routes close through the evidence-backed close reader", async () => {
    const runtime = createHermesOperatorRuntime(
      {
        ownerUserId: "user-1",
        oodaOrigin: "https://ooda.example.com",
        oodaApiKey: "ooda-secret",
        conversationId: "conversation-1",
        branchId: "branch-1",
        digestSecret: "digest-secret",
      },
      {
        usage: { record: async () => undefined },
        closeReader: {
          read: async () => ({
            schemaVersion: 1 as const,
            kind: "evening" as const,
            generatedAt: "2026-08-21T22:00:00.000Z",
            gaps: ["forgegraph did not report"],
            sections: { completed: [], blocked: [], waiting: [], captured: [], tomorrow: [] },
          }),
        },
      },
    );

    await expect(
      runtime.createService({
        keyId: "key-1",
        userId: "user-1",
        permissions: ["read"],
      }).handle({
        schemaVersion: 1,
        requestId: "telegram:close:1",
        intent: "close",
        channel: "telegram",
        occurredAt: "2026-08-21T22:00:00Z",
        payload: {},
      }),
    ).resolves.toMatchObject({
      intent: "close.summary",
      freshness: { coverage: "partial" },
      data: { gaps: ["forgegraph did not report"] },
    });
  });
});
