export interface PlanningRemoteConfig {
  apiKey: string | null;
  apiUrl: string;
  baseUrl: string;
}

const DEFAULT_PLANNING_URL = "https://tasks.gmac.io";

export function getPlanningRemoteConfig(
  env: Record<string, string | undefined> = process.env,
): PlanningRemoteConfig {
  const baseUrl = env.PLANNING_URL ?? DEFAULT_PLANNING_URL;

  return {
    apiUrl: env.PLANNING_API_URL ?? `${baseUrl}/api`,
    baseUrl,
    apiKey: env.PLANNING_API_KEY ?? null,
  };
}
