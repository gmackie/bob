// Pure config resolution for the OODA -> Bob dispatch caller. Kept free of any
// tRPC/db imports so it can be unit-tested without a DATABASE_URL or the whole
// server context.

export interface BobDispatchConfig {
  apiUrl: string;
  apiKey: string;
  workspaceId: string;
}

/** Resolve Bob dispatch config from env, or null when not fully configured. */
export function resolveBobDispatchConfig(
  env: Record<string, string | undefined>,
): BobDispatchConfig | null {
  const apiUrl = env.BOB_API_URL?.trim();
  const apiKey = env.BOB_API_KEY?.trim();
  const workspaceId = env.BOB_WORKSPACE_ID?.trim();
  if (!apiUrl || !apiKey || !workspaceId) return null;
  return { apiUrl: apiUrl.replace(/\/+$/, ""), apiKey, workspaceId };
}
