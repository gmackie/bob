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
  const baseUrl =
    env.PLANNING_URL ??
    env.KANBANGER_URL ??
    DEFAULT_KANBANGER_URL;
  const sharedSecret =
    env.PLANNING_CONTROL_SHARED_SECRET?.trim() ??
    env.KANBANGER_CONTROL_SHARED_SECRET?.trim();
  const maxSkewMsRaw =
    env.PLANNING_CONTROL_MAX_SKEW_MS ??
    env.KANBANGER_CONTROL_MAX_SKEW_MS;

  try {
    new URL(baseUrl);
  } catch (error) {
    throw new Error(
      `Invalid planning URL: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }

  if (!sharedSecret) {
    throw new Error("Missing planning control shared secret");
  }

  const maxSkewMs = maxSkewMsRaw ? Number(maxSkewMsRaw) : DEFAULT_MAX_SKEW_MS;

  if (!Number.isFinite(maxSkewMs) || maxSkewMs <= 0) {
    throw new Error("Planning control max skew must be a positive number");
  }

  return {
    baseUrl,
    sharedSecret,
    maxSkewMs,
  };
}
