const DEFAULT_PLANNING_URL = "https://tasks.gmac.io";

type PlanningEnv = NodeJS.ProcessEnv;

export function getPlanningBaseUrl(env: PlanningEnv = process.env): string {
  return env.PLANNING_URL ?? DEFAULT_PLANNING_URL;
}

export function getPlanningAppUrl(
  env: PlanningEnv = process.env,
): string | null {
  return env.PLANNING_URL ?? null;
}

export function getPlanningApiKey(
  env: PlanningEnv = process.env,
): string | null {
  return env.PLANNING_API_KEY ?? null;
}

export function getPlanningApiUrl(env: PlanningEnv = process.env): string {
  return env.PLANNING_API_URL ?? `${getPlanningBaseUrl(env)}/api`;
}

export function buildPlanningWorkItemUrl(
  workItemId: string,
  env: PlanningEnv = process.env,
): string | null {
  const appUrl = getPlanningAppUrl(env);

  if (!appUrl) {
    return null;
  }

  return `${appUrl}/work-items/${workItemId}`;
}
