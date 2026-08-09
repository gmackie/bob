import type { ConversationEventV1 } from "../contracts/v1";

export type ConversationTtsPolicy =
  | "allowed"
  | "manual"
  | "disabled"
  | "sensitive_denied";

export type TtsRequestMode = "automatic" | "manual";

export type TtsDisclosureDecision =
  | { allowed: true; text: string }
  | {
      allowed: false;
      code:
        | "NOT_ASSISTANT_TURN"
        | "SPEAKABLE_TEXT_MISSING"
        | "TTS_POLICY_DISABLED"
        | "MANUAL_TTS_REQUIRED"
        | "SENSITIVE_TTS_DENIED"
        | "SPEAKABLE_TEXT_UNSAFE"
        | "SPEAKABLE_TEXT_TOO_LONG";
    };

export function isSafeSpeakableText(text: string): boolean {
  if (text.length > 5_000) return false;
  const unsafeSpeechPatterns = [
    /```/u,
    /^\s*\|.+\|\s*$[\s\S]*^\s*\|?\s*:?-{3,}/mu,
    /\bAuthorization\s*:\s*Bearer\s+\S+/iu,
    /\b(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S+/iu,
  ];
  return !unsafeSpeechPatterns.some((pattern) => pattern.test(text));
}

export function resolveTtsSpeakable(input: {
  event: ConversationEventV1;
  ttsPolicy: ConversationTtsPolicy;
  requestMode: TtsRequestMode;
  sensitiveTtsEnabled: boolean;
}): TtsDisclosureDecision {
  if (input.ttsPolicy === "disabled") {
    return { allowed: false, code: "TTS_POLICY_DISABLED" };
  }

  if (input.ttsPolicy === "manual" && input.requestMode !== "manual") {
    return { allowed: false, code: "MANUAL_TTS_REQUIRED" };
  }

  const isSensitive = input.event.sensitivity === "sensitive"
    || input.event.sensitivity === "restricted";
  if (
    isSensitive
    && (input.ttsPolicy === "sensitive_denied" || !input.sensitiveTtsEnabled)
  ) {
    return { allowed: false, code: "SENSITIVE_TTS_DENIED" };
  }

  if (input.event.type !== "assistant_turn") {
    return { allowed: false, code: "NOT_ASSISTANT_TURN" };
  }

  const speakable = input.event.payload.speakable;
  if (typeof speakable !== "string" || speakable.trim().length === 0) {
    return { allowed: false, code: "SPEAKABLE_TEXT_MISSING" };
  }

  if (speakable.length > 5_000) {
    return { allowed: false, code: "SPEAKABLE_TEXT_TOO_LONG" };
  }

  if (!isSafeSpeakableText(speakable)) {
    return { allowed: false, code: "SPEAKABLE_TEXT_UNSAFE" };
  }

  return { allowed: true, text: speakable.trim() };
}
