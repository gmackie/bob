import Constants from "expo-constants";

export type AppEnvironment = "development" | "staging" | "production";

interface ObservabilityConfig {
  sentryDsn?: string;
  posthogKey?: string;
  posthogHost: string;
}

interface EnvironmentConfig {
  apiUrl: string;
  authUrl: string;
  oodaApiUrl: string;
  environment: AppEnvironment;
  isDevelopment: boolean;
  isStaging: boolean;
  isProduction: boolean;
  enableDebugMode: boolean;
  observability: ObservabilityConfig;
}

function getExpoExtraString(key: string): string | undefined {
  const extra: unknown = Constants.expoConfig?.extra;
  if (!extra || typeof extra !== "object") return undefined;

  const value = (extra as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getProcessEnvString(key: string): string | undefined {
  const value = process.env[key] as unknown;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getAppEnvironment(): AppEnvironment {
  const env = getExpoExtraString("APP_ENV") ?? getProcessEnvString("APP_ENV");
  if (env === "production") return "production";
  if (env === "staging") return "staging";
  return "development";
}

function getApiUrl(): string {
  const hostUri: unknown = Constants.expoConfig?.hostUri;
  const debuggerHost =
    typeof hostUri === "string" ? hostUri.split(":")[0] : undefined;
  const resolvedHost =
    debuggerHost && debuggerHost !== "localhost" && debuggerHost !== "127.0.0.1"
      ? debuggerHost
      : undefined;

  const envApiUrl = getExpoExtraString("API_URL") ?? getProcessEnvString("API_URL");
  if (envApiUrl) {
    if (!resolvedHost) return envApiUrl;

    try {
      const parsed = new URL(envApiUrl);
      if (
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1"
      ) {
        return `${parsed.protocol}//${resolvedHost}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`.replace(/\/$/, "");
      }
    } catch {
      return envApiUrl;
    }

    return envApiUrl;
  }

  const environment = getAppEnvironment();

  switch (environment) {
    case "production":
      return (
        getProcessEnvString("EXPO_PUBLIC_PRODUCTION_API_URL") ??
        "https://bob.blder.bot"
      );
    case "staging":
      return (
        getProcessEnvString("EXPO_PUBLIC_STAGING_API_URL") ??
        "https://bob.blder.bot"
      );
    case "development":
    default:
      return "https://bob.blder.bot";
  }
}

function getOodaApiUrl(): string {
  const envOodaUrl =
    getExpoExtraString("OODA_API_URL") ??
    getProcessEnvString("OODA_API_URL") ??
    getProcessEnvString("EXPO_PUBLIC_OODA_API_URL");

  if (envOodaUrl) return envOodaUrl;

  const environment = getAppEnvironment();
  if (environment === "production") return "https://ooda.blder.bot";
  if (environment === "staging") return "https://ooda.blder.bot";
  return "http://localhost:3001";
}

function getAuthUrl(): string {
  return (
    getExpoExtraString("AUTH_URL") ??
    getProcessEnvString("AUTH_URL") ??
    getProcessEnvString("EXPO_PUBLIC_AUTH_URL") ??
    getApiUrl()
  );
}

function getObservabilityConfig(): ObservabilityConfig {
  const environment = getAppEnvironment();

  const sentryDsn =
    getExpoExtraString("SENTRY_DSN") ??
    getSentryDsnForEnvironment(environment);

  const posthogKey =
    getExpoExtraString("POSTHOG_KEY") ??
    getPosthogKeyForEnvironment(environment);

  const posthogHost =
    getExpoExtraString("POSTHOG_HOST") ??
    getProcessEnvString("EXPO_PUBLIC_POSTHOG_HOST") ??
    "https://us.i.posthog.com";

  return {
    sentryDsn,
    posthogKey,
    posthogHost,
  };
}

function getSentryDsnForEnvironment(
  environment: AppEnvironment,
): string | undefined {
  switch (environment) {
    case "production":
      return (
        getProcessEnvString("EXPO_PUBLIC_SENTRY_DSN_PROD") ??
        getProcessEnvString("EXPO_PUBLIC_SENTRY_DSN")
      );
    case "staging":
      return (
        getProcessEnvString("EXPO_PUBLIC_SENTRY_DSN_STAGING") ??
        getProcessEnvString("EXPO_PUBLIC_SENTRY_DSN")
      );
    case "development":
    default:
      return (
        getProcessEnvString("EXPO_PUBLIC_SENTRY_DSN_DEV") ??
        getProcessEnvString("EXPO_PUBLIC_SENTRY_DSN")
      );
  }
}

function getPosthogKeyForEnvironment(
  environment: AppEnvironment,
): string | undefined {
  switch (environment) {
    case "production":
      return (
        getProcessEnvString("EXPO_PUBLIC_POSTHOG_KEY_PROD") ??
        getProcessEnvString("EXPO_PUBLIC_POSTHOG_KEY")
      );
    case "staging":
      return (
        getProcessEnvString("EXPO_PUBLIC_POSTHOG_KEY_STAGING") ??
        getProcessEnvString("EXPO_PUBLIC_POSTHOG_KEY")
      );
    case "development":
    default:
      return (
        getProcessEnvString("EXPO_PUBLIC_POSTHOG_KEY_DEV") ??
        getProcessEnvString("EXPO_PUBLIC_POSTHOG_KEY")
      );
  }
}

export function getEnvConfig(): EnvironmentConfig {
  const environment = getAppEnvironment();

  return {
    apiUrl: getApiUrl(),
    authUrl: getAuthUrl(),
    oodaApiUrl: getOodaApiUrl(),
    environment,
    isDevelopment: environment === "development",
    isStaging: environment === "staging",
    isProduction: environment === "production",
    enableDebugMode: environment !== "production",
    observability: getObservabilityConfig(),
  };
}

export const env = getEnvConfig();

export function getBaseUrl(): string {
  return env.apiUrl;
}

export function getAuthBaseUrl(): string {
  return env.authUrl;
}
