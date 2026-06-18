export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export const MODEL_PRICING: Record<
  string,
  { inputPer1M: number; outputPer1M: number; cacheReadPer1M: number; cacheCreationPer1M: number }
> = {
  "claude-sonnet-4-6": { inputPer1M: 3.0, outputPer1M: 15.0, cacheReadPer1M: 0.3, cacheCreationPer1M: 3.75 },
  "claude-opus-4-6": { inputPer1M: 15.0, outputPer1M: 75.0, cacheReadPer1M: 1.5, cacheCreationPer1M: 18.75 },
  "claude-opus-4-7": { inputPer1M: 15.0, outputPer1M: 75.0, cacheReadPer1M: 1.5, cacheCreationPer1M: 18.75 },
  "claude-haiku-4-5": { inputPer1M: 0.8, outputPer1M: 4.0, cacheReadPer1M: 0.08, cacheCreationPer1M: 1.0 },
};

const DEFAULT_MODEL = "claude-sonnet-4-6";

export function computeCostMicrocents(model: string, tokens: TokenCounts): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING[DEFAULT_MODEL]!;
  const inputCost = (tokens.input / 1_000_000) * pricing.inputPer1M;
  const outputCost = (tokens.output / 1_000_000) * pricing.outputPer1M;
  const cacheCost =
    (tokens.cacheRead / 1_000_000) * pricing.cacheReadPer1M +
    (tokens.cacheCreation / 1_000_000) * pricing.cacheCreationPer1M;
  return Math.round((inputCost + outputCost + cacheCost) * 100_000_000);
}

export function computeCostUsd(model: string, tokens: TokenCounts): number {
  return computeCostMicrocents(model, tokens) / 100_000_000;
}
