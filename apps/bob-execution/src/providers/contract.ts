export const providerIds = ["claude", "codex", "grok", "cursor-agent"] as const;

export type ProviderId = (typeof providerIds)[number];
export type UsageSource = "provider" | "bob_metered" | "estimated";

export interface ProviderCapabilities {
  approval: boolean;
  followUp: boolean;
  resume: boolean;
  cancel: boolean;
  structuredUsage: boolean;
  providerAllowance: boolean;
  providerResetAt: boolean;
  directCost: boolean;
  modelIdentity: boolean;
}

export interface ProviderUsageValue {
  source: UsageSource;
  inputTokens: number;
  outputTokens: number;
  runCount?: number;
  costUsd?: number;
}

export type ProviderAllowance =
  | { status: "unavailable"; source: "provider"; error?: string }
  | { status: "available"; source: "provider"; used: number; limit: number; unit: string; resetAt?: string };

export interface ProviderUsageSnapshot {
  provider: ProviderId;
  collectedAt: string;
  allowance: ProviderAllowance;
  observed?: ProviderUsageValue;
}

export interface ProviderHealthSnapshot {
  provider: ProviderId;
  command: string;
  installed: boolean;
  authenticated: boolean;
  version?: string;
  /**
   * `no_credit` means authenticated but out of balance. It cannot be probed
   * — it is latched from real dispatch outcomes. See providers/credit.ts.
   */
  status: "ready" | "unavailable" | "unauthenticated" | "degraded" | "no_credit";
  capabilities: ProviderCapabilities;
  checkedAt: string;
  error?: string;
  /** Provider's own wording, redacted. Drives "top up" vs "sign in". */
  detail?: string;
}

interface NormalizeUsageInput {
  provider: ProviderId;
  collectedAt: string;
  allowance?: ProviderAllowance;
  observed?: Omit<ProviderUsageValue, "source"> & { source?: UsageSource };
}

export function normalizeProviderUsage(input: NormalizeUsageInput): ProviderUsageSnapshot {
  return {
    provider: input.provider,
    collectedAt: input.collectedAt,
    allowance: input.allowance ?? { status: "unavailable", source: "provider" },
    observed: input.observed
      ? { ...input.observed, source: input.observed.source ?? "bob_metered" }
      : undefined,
  };
}

const sourcePriority: Record<UsageSource, number> = { estimated: 0, bob_metered: 1, provider: 2 };

export function selectProviderUsage(values: ProviderUsageValue[]): ProviderUsageValue | undefined {
  return values.reduce<ProviderUsageValue | undefined>(
    (selected, value) =>
      !selected || sourcePriority[value.source] > sourcePriority[selected.source] ? value : selected,
    undefined,
  );
}

export function isProviderUsageStale(
  snapshot: Pick<ProviderUsageSnapshot, "collectedAt">,
  now = new Date(),
  maxAgeMs = 5 * 60_000,
): boolean {
  const collectedAt = Date.parse(snapshot.collectedAt);
  return !Number.isFinite(collectedAt) || now.getTime() - collectedAt > maxAgeMs;
}
