const providers = new Set(["claude", "codex", "grok", "cursor-agent"]);

export interface ProviderCapacity {
  provider: string;
  collectedAt: string;
  allowance: Record<string, unknown>;
  observed?: Record<string, unknown>;
}

export function normalizeProviderCapacity(value: unknown): ProviderCapacity {
  if (!value || typeof value !== "object") throw new Error("provider capacity is required");
  const input = value as Record<string, unknown>;
  if (typeof input.provider !== "string" || !providers.has(input.provider)) {
    throw new Error("unsupported provider");
  }
  if (typeof input.collectedAt !== "string" || !Number.isFinite(Date.parse(input.collectedAt))) {
    throw new Error("invalid collection time");
  }
  if (!input.allowance || typeof input.allowance !== "object") {
    throw new Error("allowance is required");
  }
  const allowance = input.allowance as Record<string, unknown>;
  if (allowance.source !== "provider") {
    throw new Error("allowance must be provider-reported");
  }
  if (input.observed && typeof input.observed !== "object") {
    throw new Error("observed usage must be an object");
  }
  return {
    provider: input.provider,
    collectedAt: input.collectedAt,
    allowance,
    observed: input.observed as Record<string, unknown> | undefined,
  };
}
