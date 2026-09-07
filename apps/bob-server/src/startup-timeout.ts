/** Allow slow operator/test hosts more time without weakening readiness checks. */
export function serverStartupTimeout(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.BOB_SERVER_STARTUP_TIMEOUT_MS ?? 30_000);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 300_000) {
    throw new Error("BOB_SERVER_STARTUP_TIMEOUT_MS must be between 1000 and 300000");
  }
  return value;
}
