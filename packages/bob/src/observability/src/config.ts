export type ObservabilitySurface = "api" | "job" | "gateway";

export type EnvMap = Record<string, string | undefined>;

export interface SentryConfig {
  enabled: boolean;
  dsn?: string;
  tracesSampleRate: number;
}

export interface PostHogConfig {
  enabled: boolean;
  apiKey?: string;
  host: string;
}

export interface ObservabilityConfig {
  serviceName: string;
  environment: string;
  sentry: SentryConfig;
  posthog: PostHogConfig;
  tenantId?: string;
}

export interface ResolveObservabilityConfigOptions {
  serviceName: string;
  serviceVersion?: string;
  env?: EnvMap;
}

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

function readEnvString(env: EnvMap, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function readSampleRate(env: EnvMap): number {
  const raw = env.SENTRY_TRACES_SAMPLE_RATE?.trim();
  if (!raw) return DEFAULT_TRACES_SAMPLE_RATE;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : DEFAULT_TRACES_SAMPLE_RATE;
}

export function resolveObservabilityConfig(
  options: ResolveObservabilityConfigOptions,
): ObservabilityConfig {
  const env = options.env ?? process.env;
  const sentryDsn = readEnvString(
    env,
    "SENTRY_DSN",
    "NEXT_PUBLIC_SENTRY_DSN",
    "EXPO_PUBLIC_SENTRY_DSN",
  );
  const posthogKey = readEnvString(
    env,
    "POSTHOG_KEY",
    "NEXT_PUBLIC_POSTHOG_KEY",
    "EXPO_PUBLIC_POSTHOG_KEY",
  );
  const posthogHost =
    readEnvString(
      env,
      "POSTHOG_HOST",
      "NEXT_PUBLIC_POSTHOG_HOST",
      "EXPO_PUBLIC_POSTHOG_HOST",
    ) ?? DEFAULT_POSTHOG_HOST;

  return {
    serviceName: readEnvString(env, "OTEL_SERVICE_NAME") ?? options.serviceName,
    environment:
      readEnvString(env, "FG_STAGE", "APP_ENV", "NODE_ENV") ?? "development",
    sentry: {
      enabled: Boolean(sentryDsn),
      dsn: sentryDsn,
      tracesSampleRate: readSampleRate(env),
    },
    posthog: {
      enabled: Boolean(posthogKey),
      apiKey: posthogKey,
      host: posthogHost,
    },
    tenantId: readEnvString(env, "BOB_TENANT_ID"),
  };
}

export function getSentryInitOptions(config: ObservabilityConfig) {
  return {
    dsn: config.sentry.dsn,
    environment: config.environment,
    tracesSampleRate: config.sentry.tracesSampleRate,
    enabled: config.sentry.enabled,
  };
}

export function isObservabilityEnabled(config: ObservabilityConfig): boolean {
  return config.sentry.enabled || config.posthog.enabled;
}
