import type { MemorySeedKindV1 } from "../contracts/v1";

export interface DerivedMemoryCapture {
  kind: MemorySeedKindV1;
  normalizedText: string;
  sourceSpan: { start: number; end: number };
  confidence: number;
  entities: string[];
}

const NON_ENTITY_WORDS = new Set([
  "about",
  "build",
  "could",
  "from",
  "have",
  "itself",
  "not",
  "planner",
  "recipe",
  "regulate",
  "that",
  "the",
  "this",
  "vault",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
]);

function payloadText(payload: Record<string, unknown>): string | null {
  for (const key of ["display", "content", "text"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function classify(text: string): { kind: MemorySeedKindV1; confidence: number } {
  if (/^(?:what if|idea\b)|\b(?:an idea|we could build)\b/iu.test(text)) {
    return { kind: "idea", confidence: 0.94 };
  }
  if (/\b(?:i prefer|i like|i want|my preference)\b/iu.test(text)) {
    return { kind: "preference", confidence: 0.92 };
  }
  if (/\b(?:i decided|we decided|the decision is)\b/iu.test(text)) {
    return { kind: "decision", confidence: 0.93 };
  }
  if (/\b(?:i will|we will|i commit|we commit)\b/iu.test(text)) {
    return { kind: "commitment", confidence: 0.91 };
  }
  if (/\?$|^(?:who|what|when|where|why|how|can|could|should|would|is|are|do|does)\b/iu.test(text)) {
    return { kind: "question", confidence: 0.98 };
  }
  return { kind: "observation", confidence: 0.72 };
}

function extractEntities(text: string): string[] {
  const entities = text
    .toLowerCase()
    .match(/[a-z][a-z0-9-]{3,}/g)
    ?.filter((word) => !NON_ENTITY_WORDS.has(word)) ?? [];
  return [...new Set(entities)].slice(0, 32);
}

export function deriveMemoryCapture(input: {
  type: string;
  payload: Record<string, unknown>;
}): DerivedMemoryCapture | null {
  if (input.type !== "user_turn" && input.type !== "correction") return null;

  const raw = input.type === "correction"
    ? (() => {
        const replacement = input.payload.replacementPayload;
        return replacement && typeof replacement === "object" && !Array.isArray(replacement)
          ? payloadText(replacement as Record<string, unknown>)
          : null;
      })()
    : payloadText(input.payload);
  if (!raw) return null;

  const normalizedText = raw.trim();
  const start = raw.indexOf(normalizedText);
  const classified = input.type === "correction"
    ? { kind: "correction" as const, confidence: 1 }
    : classify(normalizedText);
  return {
    ...classified,
    normalizedText,
    sourceSpan: { start, end: start + normalizedText.length },
    entities: extractEntities(normalizedText),
  };
}
