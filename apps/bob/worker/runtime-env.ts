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

export function getSentryOptions(env: RuntimeEnv | undefined) {
  return {
    dsn: getEnvString(env?.SENTRY_DSN) ?? process.env.SENTRY_DSN,
    environment:
      getEnvString(env?.FG_STAGE) ?? process.env.FG_STAGE ?? "production",
    tracesSampleRate: 0.1,
  };
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
