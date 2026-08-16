import type { ConversationEventV1 } from "@gmacko/ooda-client/v1";
import { describe, expect, it } from "vitest";

import {
  buildConversationCorrectionInput,
  canCorrectConversationEvent,
} from "./conversation-correction-model";

function userEvent(): ConversationEventV1 {
  return {
    id: "event-user-1",
    conversationId: "conversation-1",
    branchId: "branch-main",
    sequence: "7",
    type: "user_turn",
    actor: { type: "user", id: "owner-1" },
    payload: {
      display: "the first transcript",
      text: "the first transcript",
      transcriptConfidence: 0.71,
      capture: "on_device_stt",
    },
    sensitivity: "personal",
    correlationId: "turn-1",
    occurredAt: "2026-08-16T18:00:00.000Z",
  };
}

describe("mobile conversation correction model", () => {
  it("preserves provenance while replacing the visible and captured text", () => {
    expect(
      buildConversationCorrectionInput({
        event: userEvent(),
        text: "  the corrected transcript  ",
        reason: "  Fixed speech recognition  ",
        idempotencyKey: "correction-device-1",
        occurredAt: "2026-08-16T18:05:00.000Z",
      }),
    ).toEqual({
      conversationId: "conversation-1",
      branchId: "branch-main",
      correctedEventId: "event-user-1",
      replacementPayload: {
        display: "the corrected transcript",
        text: "the corrected transcript",
        transcriptConfidence: 0.71,
        capture: "on_device_stt",
      },
      reason: "Fixed speech recognition",
      sensitivity: "personal",
      correlationId: "turn-1",
      idempotencyKey: "correction-device-1",
      occurredAt: "2026-08-16T18:05:00.000Z",
    });
  });

  it("allows only durable user turns to be corrected", () => {
    expect(canCorrectConversationEvent(userEvent())).toBe(true);
    expect(
      canCorrectConversationEvent({ ...userEvent(), type: "assistant_turn" }),
    ).toBe(false);
    expect(canCorrectConversationEvent(undefined)).toBe(false);
  });

  it("rejects blank correction text and reason", () => {
    expect(() =>
      buildConversationCorrectionInput({
        event: userEvent(),
        text: "   ",
        reason: "Fixed speech recognition",
        idempotencyKey: "correction-device-2",
        occurredAt: "2026-08-16T18:05:00.000Z",
      }),
    ).toThrow("Correction text is required");
    expect(() =>
      buildConversationCorrectionInput({
        event: userEvent(),
        text: "Corrected",
        reason: "   ",
        idempotencyKey: "correction-device-3",
        occurredAt: "2026-08-16T18:05:00.000Z",
      }),
    ).toThrow("Correction reason is required");
  });
});
