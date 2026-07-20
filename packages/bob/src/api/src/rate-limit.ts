export type RateLimitProfile = "public" | "authenticated" | "device";

export interface RateLimitPolicy {
  readonly windowMs: number;
  readonly max: number;
}

export interface RateLimitResult extends RateLimitPolicy {
  readonly limited: boolean;
  readonly remaining: number;
  readonly resetAt: number;
  readonly retryAfterSeconds: number;
  readonly key: string;
}

export interface RateLimitOptions {
  readonly profile?: RateLimitProfile;
  readonly now?: number;
  readonly env?: Record<string, string | undefined>;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

const DEFAULT_POLICIES: Record<RateLimitProfile, RateLimitPolicy> = {
  public: { windowMs: 60_000, max: 120 },
  authenticated: { windowMs: 60_000, max: 600 },
  device: { windowMs: 60_000, max: 60 },
};

const envNumber = (
  env: Record<string, string | undefined>,
  key: string,
): number | undefined => {
  const raw = env[key];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const getEnv = (): Record<string, string | undefined> => {
  if (typeof process === "undefined") return {};
  return process.env;
};

export const getRateLimitPolicy = (
  profile: RateLimitProfile,
  env = getEnv(),
): RateLimitPolicy => {
  const suffix = profile.toUpperCase();
  return {
    windowMs:
      envNumber(env, `BOB_API_RATE_LIMIT_${suffix}_WINDOW_MS`) ??
      envNumber(env, "BOB_API_RATE_LIMIT_WINDOW_MS") ??
      DEFAULT_POLICIES[profile].windowMs,
    max:
      envNumber(env, `BOB_API_RATE_LIMIT_${suffix}_MAX`) ??
      envNumber(env, "BOB_API_RATE_LIMIT_MAX") ??
      DEFAULT_POLICIES[profile].max,
  };
};

const fnv1a = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const firstHeaderValue = (value: string | null): string | undefined =>
  value?.split(",")[0]?.trim() || undefined;

const cookieValue = (
  cookie: string | null,
  name: string,
): string | undefined => {
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return rawValue.join("=");
  }
  return undefined;
};

export const rateLimitKeyForRequest = (request: Request): string => {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return `bearer:${fnv1a(bearer)}`;

  const cookie = request.headers.get("cookie");
  const sessionToken =
    cookieValue(cookie, "better-auth.session_token") ??
    cookieValue(cookie, "__Secure-better-auth.session_token");
  if (sessionToken) return `session:${fnv1a(sessionToken)}`;

  const ip =
    request.headers.get("cf-connecting-ip") ??
    firstHeaderValue(request.headers.get("x-forwarded-for")) ??
    request.headers.get("x-real-ip");
  if (ip) return `ip:${ip}`;

  return "anonymous";
};

const pruneExpiredBuckets = (now: number): void => {
  if (buckets.size < 10_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
};

export const checkRateLimit = (
  request: Request,
  options: RateLimitOptions = {},
): RateLimitResult | null => {
  const env = options.env ?? getEnv();
  if (env.BOB_API_RATE_LIMIT_DISABLED === "1") return null;

  const profile = options.profile ?? "public";
  const policy = getRateLimitPolicy(profile, env);
  const now = options.now ?? Date.now();
  const key = `${profile}:${rateLimitKeyForRequest(request)}`;

  pruneExpiredBuckets(now);

  const existing = buckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + policy.windowMs };
  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(policy.max - bucket.count, 0);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((bucket.resetAt - now) / 1000),
  );

  return {
    ...policy,
    limited: bucket.count > policy.max,
    remaining,
    resetAt: bucket.resetAt,
    retryAfterSeconds,
    key,
  };
};

export const setRateLimitHeaders = (
  response: Response,
  result: RateLimitResult | null,
): Response => {
  if (!result) return response;
  response.headers.set("RateLimit-Limit", String(result.max));
  response.headers.set("RateLimit-Remaining", String(result.remaining));
  response.headers.set(
    "RateLimit-Reset",
    String(Math.ceil(result.resetAt / 1000)),
  );
  response.headers.set("X-RateLimit-Limit", String(result.max));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set(
    "X-RateLimit-Reset",
    String(Math.ceil(result.resetAt / 1000)),
  );
  if (result.limited) {
    response.headers.set("Retry-After", String(result.retryAfterSeconds));
  }
  return response;
};

export const rateLimitResponse = (result: RateLimitResult): Response =>
  setRateLimitHeaders(
    new Response(
      JSON.stringify({
        error: "rate_limited",
        message: "Too many requests. Please retry after the current window.",
      }),
      {
        status: 429,
        headers: { "content-type": "application/json" },
      },
    ),
    result,
  );

export const clearRateLimitBucketsForTest = (): void => {
  buckets.clear();
};
