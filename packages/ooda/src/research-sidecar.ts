export interface ResearchSidecarConfig {
  apiUrl: string;
  serviceToken: string;
}

const configuredText = (value: string | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export function resolveResearchSidecarConfig(
  env: Record<string, string | undefined>,
): ResearchSidecarConfig | null {
  const apiUrl = configuredText(env.RESEARCH_API_URL);
  const serviceToken = configuredText(env.RESEARCH_SERVICE_TOKEN);
  return apiUrl && serviceToken ? { apiUrl, serviceToken } : null;
}

export function researchServiceHeaders(
  serviceToken: string,
  additional: Record<string, string> = {},
): Record<string, string> {
  return {
    ...additional,
    Authorization: `Bearer ${serviceToken}`,
  };
}
