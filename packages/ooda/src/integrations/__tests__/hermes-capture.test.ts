import { describe, expect, it, vi } from "vitest";

import type { AppendConversationEventInputV1 } from "../../contracts/v1";
import { createHermesCaptureAdapter } from "../hermes-capture";

describe("Hermes OODA capture adapter", () => {
  it("appends one event-only integration record with transport idempotency and returns an opaque receipt", async () => {
    const append = vi.fn(async (_input: AppendConversationEventInputV1) => ({
      event: {
        id: "event-42",
        conversationId: "conversation-42",
        branchId: "branch-42",
        sequence: "7",
        type: "user_turn" as const,
        actor: { type: "user" as const },
        payload: { format: "text", text: "Remember the lab workflow." },
        sensitivity: "personal" as const,
        correlationId: "telegram:4512:9918",
        idempotencyKey: "telegram:4512:9918",
        occurredAt: "2026-08-21T13:30:00Z",
      },
      replayed: true,
    }));
    const adapter = createHermesCaptureAdapter({ append });

    await expect(
      adapter.capture({
        schemaVersion: 1,
        requestId: "telegram:4512:9918",
        conversationId: "conversation-42",
        branchId: "branch-42",
        text: "Remember the lab workflow.",
        occurredAt: "2026-08-21T13:30:00Z",
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      requestId: "telegram:4512:9918",
      replayed: true,
      canonicalRef: { kind: "conversation_event", id: "event-42" },
      occurredAt: "2026-08-21T13:30:00Z",
    });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "telegram:4512:9918",
        correlationId: "telegram:4512:9918",
        actor: { type: "user" },
        type: "user_turn",
        sensitivity: "personal",
      }),
      { captureMemory: false },
    );
  });
});
