export type TranscriptDisposition =
  | { action: "discard" }
  | { action: "send"; text: string }
  | {
      action: "review";
      text: string;
      reason: "low_confidence" | "confidence_unavailable";
    };

export function transcriptDisposition(input: {
  text: string;
  confidence: number | null;
  threshold?: number;
}): TranscriptDisposition {
  const text = input.text.trim();
  if (!text) return { action: "discard" };
  const threshold = input.threshold ?? 0.72;
  if (input.confidence === null || input.confidence < 0) {
    return { action: "review", text, reason: "confidence_unavailable" };
  }
  if (input.confidence < threshold) {
    return { action: "review", text, reason: "low_confidence" };
  }
  return { action: "send", text };
}
