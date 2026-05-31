type Env = Record<string, string | undefined>;

const DEV_AUTH_TOKEN_PREFIX = "bob-auth-bypass:";
const DEFAULT_BYPASS_USER_ID = "default-user";
const DEFAULT_DEV_BYPASS_TOKEN = "local-dev-auth-bypass";

function readEnv(env: Env, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function isDevAuthBypassEnabled(env: Env = process.env): boolean {
  return readEnv(env, "EXPO_PUBLIC_BOB_AUTH_BYPASS") === "true";
}

export function shouldSkipOnboardingForDevAuth(env: Env = process.env): boolean {
  return (
    isDevAuthBypassEnabled(env) ||
    readEnv(env, "EXPO_PUBLIC_BOB_SKIP_ONBOARDING") === "true"
  );
}

export function getDevAuthBypassUserId(env: Env = process.env): string {
  return (
    readEnv(env, "EXPO_PUBLIC_BOB_AUTH_BYPASS_USER_ID") ??
    DEFAULT_BYPASS_USER_ID
  );
}

export function getDevAuthBypassToken(env: Env = process.env): string {
  return (
    readEnv(env, "EXPO_PUBLIC_BOB_AUTH_BYPASS_TOKEN") ??
    DEFAULT_DEV_BYPASS_TOKEN
  );
}

export function getDevAuthBypassCookie(env: Env = process.env): string {
  return `${DEV_AUTH_TOKEN_PREFIX}${getDevAuthBypassToken(env)}`;
}

export function createDevAuthSession(env: Env = process.env) {
  const userId = getDevAuthBypassUserId(env);
  const now = new Date(0);

  return {
    session: {
      id: "dev-auth-bypass-session",
      token: getDevAuthBypassCookie(env),
      userId,
      expiresAt: new Date("2999-12-31T23:59:59.999Z"),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: "Bob mobile dev auth bypass",
    },
    user: {
      id: userId,
      email: `${userId}@dev.bob.local`,
      name: "Bob Dev User",
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}
