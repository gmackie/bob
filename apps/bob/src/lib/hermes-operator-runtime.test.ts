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
});
