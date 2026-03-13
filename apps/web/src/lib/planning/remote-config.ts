export interface PlanningRemoteConfig {
  apiKey: string | null;
  baseUrl: string;
}

const DEFAULT_PLANNING_URL = "https://tasks.gmac.io";

export function getPlanningRemoteConfig(
  env: Record<string, string | undefined> = process.env,
): PlanningRemoteConfig {
  return {
    baseUrl: env.PLANNING_URL ?? env.KANBANGER_URL ?? DEFAULT_PLANNING_URL,
    apiKey: env.PLANNING_API_KEY ?? env.KANBANGER_API_KEY ?? null,
  };
}
