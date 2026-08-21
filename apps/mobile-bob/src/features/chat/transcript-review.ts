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
  // Apple's on-device SFSpeechRecognizer (dictation mode) routinely reports
  // confidence 0 or null on final results, so "no confidence" is the NORMAL
  // case, not a low-quality signal. Treat unavailable confidence as
  // trustworthy and send it — only route to review when a real confidence
  // score is present AND below the threshold.
  if (input.confidence === null || input.confidence <= 0) {
    return { action: "send", text };
  }
  if (input.confidence < threshold) {
    return { action: "review", text, reason: "low_confidence" };
  }
  return { action: "send", text };
}
