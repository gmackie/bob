import {
  getSentryInitOptions,
  resolveObservabilityConfig,
} from "@bob/observability/config";

interface HyperdriveBinding {
  connectionString: string;
}

interface RuntimeEnv {
  BOB_AUTH_BYPASS?: unknown;
  BOB_AUTH_BYPASS_TOKEN?: unknown;
  BOB_AUTH_BYPASS_USER_ID?: unknown;
  FG_STAGE?: unknown;
  HYPERDRIVE?: HyperdriveBinding;
  SENTRY_DSN?: unknown;
  POSTHOG_KEY?: unknown;
  POSTHOG_HOST?: unknown;
  BOB_TENANT_ID?: unknown;
}

function getEnvString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function applyRuntimeAuthEnv(
  env: RuntimeEnv | undefined,
  target: Record<string, string | undefined> = process.env,
): void {
  for (const key of [
    "BOB_AUTH_BYPASS",
    "BOB_AUTH_BYPASS_TOKEN",
    "BOB_AUTH_BYPASS_USER_ID",
  ] as const) {
    const value = getEnvString(env?.[key]);
    if (value) target[key] = value;
  }
}

function runtimeEnvToMap(env: RuntimeEnv | undefined): Record<string, string | undefined> {
  return {
    SENTRY_DSN: getEnvString(env?.SENTRY_DSN) ?? process.env.SENTRY_DSN,
    POSTHOG_KEY: getEnvString(env?.POSTHOG_KEY) ?? process.env.POSTHOG_KEY,
    POSTHOG_HOST: getEnvString(env?.POSTHOG_HOST) ?? process.env.POSTHOG_HOST,
    FG_STAGE: getEnvString(env?.FG_STAGE) ?? process.env.FG_STAGE,
    BOB_TENANT_ID: getEnvString(env?.BOB_TENANT_ID) ?? process.env.BOB_TENANT_ID,
  };
}

export function getSentryOptions(env: RuntimeEnv | undefined) {
  const config = resolveObservabilityConfig({
    serviceName: "bob-worker",
    env: runtimeEnvToMap(env),
  });
  return getSentryInitOptions(config);
}

export function getHyperdriveConnectionString(env: RuntimeEnv | undefined) {
  const hyperdriveConnectionString = getEnvString(
    env?.HYPERDRIVE?.connectionString,
  );
  if (hyperdriveConnectionString) {
    return { connectionString: hyperdriveConnectionString, isHyperdrive: true };
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required when HYPERDRIVE is unavailable");
  }

  return { connectionString: databaseUrl, isHyperdrive: false };
}
