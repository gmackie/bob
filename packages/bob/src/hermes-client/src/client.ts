export interface HermesPlatformStatus {
  state: string;
  updated_at: string;
  error_code?: string;
  error_message?: string;
}

export interface HermesStatus {
  active_sessions: number;
  gateway_running: boolean;
  gateway_state: string | null;
  gateway_updated_at: string | null;
  gateway_exit_reason: string | null;
  gateway_platforms: Record<string, HermesPlatformStatus>;
  version: string;
  release_date: string;
  config_version: number;
  latest_config_version: number;
  auth_required?: boolean;
  auth_providers?: string[];
}

export interface HermesMessagingEnvVar {
  key: string;
  required: boolean;
  is_set: boolean;
  redacted_value: string | null;
  description: string;
  prompt: string;
  help: string;
  url: string | null;
  is_password: boolean;
  advanced: boolean;
}

export interface HermesMessagingPlatform {
  id: string;
  name: string;
  description: string;
  docs_url: string;
  enabled: boolean;
  configured: boolean;
  gateway_running: boolean;
  state: string;
  error_code: string | null;
  error_message: string | null;
  updated_at: string | null;
  home_channel: { platform: string; chat_id: string; name: string; thread_id?: string } | null;
  env_vars: HermesMessagingEnvVar[];
}

export interface HermesMessagingPlatformUpdate {
  enabled?: boolean;
  env?: Record<string, string>;
  clear_env?: string[];
}

export interface HermesCronJob {
  id: string;
  profile?: string | null;
  profile_name?: string | null;
  name?: string | null;
  prompt?: string | null;
  schedule?: { kind?: string; expr?: string; run_at?: string; display?: string };
  schedule_display?: string | null;
  enabled: boolean;
  state?: string | null;
  deliver?: string | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  last_delivery_error?: string | null;
}

export interface HermesSession {
  id: string;
  source: string | null;
  model: string | null;
  title: string | null;
  started_at: number;
  ended_at: number | null;
  last_active: number;
  is_active: boolean;
  message_count: number;
  tool_call_count: number;
  input_tokens: number;
  output_tokens: number;
  preview: string | null;
}

export interface HermesOAuthProvider {
  id: string;
  name: string;
  flow: "pkce" | "device_code" | "external";
  cli_command: string;
  docs_url: string;
  status: {
    logged_in: boolean;
    source?: string | null;
    source_label?: string | null;
    expires_at?: string | null;
    error?: string;
  };
}

export interface HermesOverview {
  status: HermesStatus;
  platforms: HermesMessagingPlatform[];
  jobs: HermesCronJob[];
  sessions: HermesSession[];
  sessionTotal: number;
  providers: HermesOAuthProvider[];
}

export class HermesApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HermesApiError";
  }
}

export interface HermesClientOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string; error?: string };
    return body.detail ?? body.error ?? `Hermes request failed (${response.status})`;
  } catch {
    return `Hermes request failed (${response.status})`;
  }
}

export function createHermesClient(options: HermesClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? "/api/hermes").replace(/\/$/, "");
  const fetcher = options.fetcher ?? globalThis.fetch;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetcher(`${baseUrl}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
    if (!response.ok) throw new HermesApiError(response.status, await errorMessage(response));
    return response.json() as Promise<T>;
  }

  const getStatus = () => request<HermesStatus>("/status");
  const getMessagingPlatforms = () => request<{ platforms: HermesMessagingPlatform[] }>("/messaging/platforms");
  const getCronJobs = (profile = "all") => request<HermesCronJob[]>(`/cron/jobs?profile=${encodeURIComponent(profile)}`);
  const getSessions = (limit = 12) => request<{ sessions: HermesSession[]; total: number }>(`/sessions?limit=${limit}&offset=0&order=recent`);
  const getOAuthProviders = () => request<{ providers: HermesOAuthProvider[] }>("/providers/oauth");

  return {
    getStatus,
    getMessagingPlatforms,
    getCronJobs,
    getSessions,
    getOAuthProviders,
    async getOverview(): Promise<HermesOverview> {
      const [status, platformData, jobs, sessionData, providerData] = await Promise.all([
        getStatus(),
        getMessagingPlatforms(),
        getCronJobs(),
        getSessions(),
        getOAuthProviders(),
      ]);
      return {
        status,
        platforms: platformData.platforms,
        jobs,
        sessions: sessionData.sessions,
        sessionTotal: sessionData.total,
        providers: providerData.providers,
      };
    },
    updateMessagingPlatform(id: string, body: HermesMessagingPlatformUpdate) {
      return request<{ ok: boolean; platform: string }>(`/messaging/platforms/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
    testMessagingPlatform(id: string) {
      return request<{ ok: boolean; state: string; message: string }>(`/messaging/platforms/${encodeURIComponent(id)}/test`, { method: "POST" });
    },
    pauseCronJob(id: string, profile = "default") {
      return request<HermesCronJob>(`/cron/jobs/${encodeURIComponent(id)}/pause?profile=${encodeURIComponent(profile)}`, { method: "POST" });
    },
    resumeCronJob(id: string, profile = "default") {
      return request<HermesCronJob>(`/cron/jobs/${encodeURIComponent(id)}/resume?profile=${encodeURIComponent(profile)}`, { method: "POST" });
    },
    triggerCronJob(id: string, profile = "default") {
      return request<HermesCronJob>(`/cron/jobs/${encodeURIComponent(id)}/trigger?profile=${encodeURIComponent(profile)}`, { method: "POST" });
    },
  };
}
