export interface KanbangerControlConfig {
  baseUrl: string;
  sharedSecret: string;
  maxSkewMs: number;
}

const DEFAULT_KANBANGER_URL = "https://tasks.gmac.io";
const DEFAULT_MAX_SKEW_MS = 300_000;

export function getKanbangerControlConfig(
  env: Record<string, string | undefined> = process.env,
): KanbangerControlConfig {
  const baseUrl = env.KANBANGER_URL ?? DEFAULT_KANBANGER_URL;
  const sharedSecret = env.KANBANGER_CONTROL_SHARED_SECRET?.trim();
  const maxSkewMsRaw = env.KANBANGER_CONTROL_MAX_SKEW_MS;

  try {
    new URL(baseUrl);
  } catch (error) {
    throw new Error(
      `Invalid KANBANGER_URL: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }

  if (!sharedSecret) {
    throw new Error("Missing KANBANGER_CONTROL_SHARED_SECRET");
  }

  const maxSkewMs = maxSkewMsRaw ? Number(maxSkewMsRaw) : DEFAULT_MAX_SKEW_MS;

  if (!Number.isFinite(maxSkewMs) || maxSkewMs <= 0) {
    throw new Error("KANBANGER_CONTROL_MAX_SKEW_MS must be a positive number");
  }

  return {
    baseUrl,
    sharedSecret,
    maxSkewMs,
  };
}
