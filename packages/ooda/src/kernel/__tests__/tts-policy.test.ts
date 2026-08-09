import { describe, expect, it } from "vitest";

import type { ConversationEventV1 } from "../../contracts/v1";
import { resolveTtsSpeakable } from "../tts-policy";

function assistantEvent(overrides: Partial<ConversationEventV1> = {}): ConversationEventV1 {
  return {
    id: "event-1",
    conversationId: "conversation-1",
    branchId: "branch-1",
    sequence: "2",
    type: "assistant_turn",
    actor: { type: "host", id: "grok" },
    payload: {
      display: "A detailed answer for the screen.",
      speakable: "Here is the concise answer.",
    },
    sensitivity: "personal",
    correlationId: "correlation-1",
    occurredAt: "2026-08-07T12:00:00.000Z",
    ...overrides,
  };
}

describe("TTS disclosure policy", () => {
  it("returns only the explicit speakable text from an allowed assistant turn", () => {
    expect(resolveTtsSpeakable({
      event: assistantEvent(),
      ttsPolicy: "allowed",
      requestMode: "automatic",
      sensitiveTtsEnabled: false,
    })).toEqual({
      allowed: true,
      text: "Here is the concise answer.",
    });
  });

  it("denies every request when conversation TTS is disabled", () => {
    expect(resolveTtsSpeakable({
      event: assistantEvent(),
      ttsPolicy: "disabled",
      requestMode: "manual",
      sensitiveTtsEnabled: false,
    })).toEqual({
      allowed: false,
      code: "TTS_POLICY_DISABLED",
    });
  });

  it("requires an explicit replay request when the conversation policy is manual", () => {
    expect(resolveTtsSpeakable({
      event: assistantEvent(),
      ttsPolicy: "manual",
      requestMode: "automatic",
      sensitiveTtsEnabled: false,
    })).toEqual({
      allowed: false,
      code: "MANUAL_TTS_REQUIRED",
    });

    expect(resolveTtsSpeakable({
      event: assistantEvent(),
      ttsPolicy: "manual",
      requestMode: "manual",
      sensitiveTtsEnabled: false,
    })).toEqual({
      allowed: true,
      text: "Here is the concise answer.",
    });
  });

  it("denies sensitive disclosure unless the category is explicitly enabled", () => {
    const sensitiveEvent = assistantEvent({ sensitivity: "sensitive" });

    expect(resolveTtsSpeakable({
      event: sensitiveEvent,
      ttsPolicy: "allowed",
      requestMode: "automatic",
      sensitiveTtsEnabled: false,
    })).toEqual({
      allowed: false,
      code: "SENSITIVE_TTS_DENIED",
    });

    expect(resolveTtsSpeakable({
      event: sensitiveEvent,
      ttsPolicy: "allowed",
      requestMode: "automatic",
      sensitiveTtsEnabled: true,
    })).toEqual({
      allowed: true,
      text: "Here is the concise answer.",
    });
  });

  it.each([
    "Run this:\n```ts\nconsole.log('secret')\n```",
    "| Name | Value |\n| --- | --- |\n| token | hidden |",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
    "API_KEY=do-not-read-this-aloud",
  ])("denies code, table, and credential-like speech: %s", (speakable) => {
    expect(resolveTtsSpeakable({
      event: assistantEvent({ payload: { display: speakable, speakable } }),
      ttsPolicy: "allowed",
      requestMode: "manual",
      sensitiveTtsEnabled: false,
    })).toEqual({
      allowed: false,
      code: "SPEAKABLE_TEXT_UNSAFE",
    });
  });

  it("denies unexpectedly long speakable text", () => {
    const speakable = "a".repeat(5_001);
    expect(resolveTtsSpeakable({
      event: assistantEvent({ payload: { display: speakable, speakable } }),
      ttsPolicy: "allowed",
      requestMode: "automatic",
      sensitiveTtsEnabled: false,
    })).toEqual({
      allowed: false,
      code: "SPEAKABLE_TEXT_TOO_LONG",
    });
  });
});
