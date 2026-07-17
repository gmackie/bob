export interface OracleConfig {
  enabled: boolean;
  apiUrl: string;
  token: string;
}

export function readOracleConfig(env: Record<string, string | undefined> = process.env): OracleConfig {
  const apiUrl = env.OODA_API_URL ?? "";
  const token = env.OODA_ORACLE_TOKEN ?? "";
  return { enabled: Boolean(apiUrl && token), apiUrl, token };
}
