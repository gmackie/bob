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
  home_channel: {
    platform: string;
    chat_id: string;
    name: string;
    thread_id?: string;
  } | null;
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
  schedule?: {
    kind?: string;
    expr?: string;
    run_at?: string;
    display?: string;
  };
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
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HermesApiError";
  }
}

export class HermesInputError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "HermesInputError";
  }
}

const TELEGRAM_BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{30,}$/;

export function validateHermesMessagingPlatformUpdate(
  id: string,
  body: unknown,
): asserts body is HermesMessagingPlatformUpdate {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HermesInputError(
      "body",
      "Hermes connector update body must be an object.",
    );
  }
  const update = body as Record<string, unknown>;
  if (update.enabled !== undefined && typeof update.enabled !== "boolean") {
    throw new HermesInputError("enabled", "enabled must be a boolean.");
  }
  if (
    update.env !== undefined &&
    (!update.env || typeof update.env !== "object" || Array.isArray(update.env))
  ) {
    throw new HermesInputError("env", "env must be an object of string values.");
  }
  if (
    update.env &&
    Object.entries(update.env).some(
      ([key, value]) => !key.trim() || typeof value !== "string",
    )
  ) {
    throw new HermesInputError("env", "env must contain only string values.");
  }
  if (
    update.clear_env !== undefined &&
    (!Array.isArray(update.clear_env) ||
      update.clear_env.some((key) => typeof key !== "string" || !key.trim()))
  ) {
    throw new HermesInputError(
      "clear_env",
      "clear_env must contain only non-empty strings.",
    );
  }

  const validated = body as HermesMessagingPlatformUpdate;
  const token = validated.env?.TELEGRAM_BOT_TOKEN?.trim();
  if (id === "telegram" && token && !TELEGRAM_BOT_TOKEN_PATTERN.test(token)) {
    throw new HermesInputError(
      "TELEGRAM_BOT_TOKEN",
      "Telegram bot token must start with the numeric bot ID followed by a colon and the BotFather secret.",
    );
  }
}

export interface HermesHealth {
  tone: "success" | "danger";
  label: "Operational" | "Needs attention";
  issues: string[];
}

export function deriveHermesHealth(input: {
  status: Pick<HermesStatus, "gateway_running" | "gateway_state">;
  providers: Array<Pick<HermesOAuthProvider, "status">>;
}): HermesHealth {
  const issues: string[] = [];
  if (!input.status.gateway_running)
    issues.push(`Gateway is ${input.status.gateway_state || "stopped"}`);
  if (
    input.providers.length > 0 &&
    !input.providers.some((provider) => provider.status.logged_in)
  )
    issues.push("No provider authentication is active");
  return issues.length > 0
    ? { tone: "danger", label: "Needs attention", issues }
    : { tone: "success", label: "Operational", issues: [] };
}

export function findLastBriefing(jobs: HermesCronJob[]): HermesCronJob | null {
  return (
    jobs
      .filter((job) =>
        (job.name ?? "").toLowerCase().includes("morning briefing"),
      )
      .sort((a, b) =>
        (b.last_run_at ?? "").localeCompare(a.last_run_at ?? ""),
      )[0] ?? null
  );
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as {
      detail?: string;
      error?: string;
    };
    return (
      body.detail ?? body.error ?? `Hermes request failed (${response.status})`
    );
  } catch {
    return `Hermes request failed (${response.status})`;
  }
}

export function createHermesClient(
  options: { baseUrl?: string; fetcher?: typeof fetch } = {},
) {
  const baseUrl = (options.baseUrl ?? "/api/hermes").replace(/\/$/, "");
  const fetcher = options.fetcher ?? globalThis.fetch;
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type"))
      headers.set("content-type", "application/json");
    const response = await fetcher(`${baseUrl}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
    if (!response.ok)
      throw new HermesApiError(response.status, await responseError(response));
    return response.json() as Promise<T>;
  }
  return {
    getOverview: () => request<HermesOverview>("/overview"),
    async updateMessagingPlatform(
      id: string,
      body: HermesMessagingPlatformUpdate,
    ) {
      validateHermesMessagingPlatformUpdate(id, body);
      return request<{ ok: boolean; platform: string }>(
        `/messaging/platforms/${encodeURIComponent(id)}`,
        { method: "PUT", body: JSON.stringify(body) },
      );
    },
    testMessagingPlatform: (id: string) =>
      request<{ ok: boolean; state: string; message: string }>(
        `/messaging/platforms/${encodeURIComponent(id)}/test`,
        { method: "POST" },
      ),
    pauseCronJob: (id: string, profile = "default") =>
      request<HermesCronJob>(
        `/cron/jobs/${encodeURIComponent(id)}/pause?profile=${encodeURIComponent(profile)}`,
        { method: "POST" },
      ),
    resumeCronJob: (id: string, profile = "default") =>
      request<HermesCronJob>(
        `/cron/jobs/${encodeURIComponent(id)}/resume?profile=${encodeURIComponent(profile)}`,
        { method: "POST" },
      ),
    triggerCronJob: (id: string, profile = "default") =>
      request<HermesCronJob>(
        `/cron/jobs/${encodeURIComponent(id)}/trigger?profile=${encodeURIComponent(profile)}`,
        { method: "POST" },
      ),
  };
}
