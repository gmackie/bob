interface HyperdriveBinding {
  connectionString: string;
}

interface RuntimeEnv {
  FG_STAGE?: unknown;
  HYPERDRIVE?: HyperdriveBinding;
  SENTRY_DSN?: unknown;
}

function getEnvString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
