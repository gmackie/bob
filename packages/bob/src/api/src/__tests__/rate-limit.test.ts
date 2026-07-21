import { beforeEach, describe, expect, it } from "vitest";

import {
  checkRateLimit,
  clearRateLimitBucketsForTest,
  getRateLimitPolicy,
  rateLimitKeyForRequest,
  rateLimitResponse,
  setRateLimitHeaders,
} from "../rate-limit.js";

const env = {
  BOB_API_RATE_LIMIT_PUBLIC_MAX: "2",
  BOB_API_RATE_LIMIT_PUBLIC_WINDOW_MS: "1000",
};

describe("rate limiting", () => {
  beforeEach(() => {
    clearRateLimitBucketsForTest();
  });

  it("uses profile-specific env policy before global defaults", () => {
    expect(getRateLimitPolicy("public", env)).toEqual({
      max: 2,
      windowMs: 1000,
    });
  });

  it("keys bearer, session, and ip requests separately", () => {
    expect(
      rateLimitKeyForRequest(
        new Request("http://localhost", {
          headers: { authorization: "Bearer bob_live_secret" },
        }),
      ),
    ).toMatch(/^bearer:/);

    expect(
      rateLimitKeyForRequest(
        new Request("http://localhost", {
          headers: { cookie: "better-auth.session_token=session-1" },
        }),
      ),
    ).toMatch(/^session:/);

    expect(
      rateLimitKeyForRequest(
        new Request("http://localhost", {
          headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
        }),
      ),
    ).toBe("ip:203.0.113.10");
  });

  it("limits after the configured request budget", () => {
    const request = new Request("http://localhost/api/v1/runs", {
      headers: { "cf-connecting-ip": "203.0.113.20" },
    });

    const first = checkRateLimit(request, { env, now: 1_000 });
    const second = checkRateLimit(request, { env, now: 1_100 });
    const third = checkRateLimit(request, { env, now: 1_200 });

    expect(first?.limited).toBe(false);
    expect(first?.remaining).toBe(1);
    expect(second?.limited).toBe(false);
    expect(second?.remaining).toBe(0);
    expect(third?.limited).toBe(true);
    expect(third?.remaining).toBe(0);
  });

  it("resets after the window expires", () => {
    const request = new Request("http://localhost/api/v1/runs", {
      headers: { "cf-connecting-ip": "203.0.113.21" },
    });

    expect(checkRateLimit(request, { env, now: 1_000 })?.limited).toBe(false);
    expect(checkRateLimit(request, { env, now: 1_100 })?.limited).toBe(false);
    expect(checkRateLimit(request, { env, now: 1_200 })?.limited).toBe(true);
    expect(checkRateLimit(request, { env, now: 2_001 })?.limited).toBe(false);
  });

  it("adds standard rate-limit headers and retry-after on 429", async () => {
    const request = new Request("http://localhost/api/v1/runs", {
      headers: { "cf-connecting-ip": "203.0.113.22" },
    });

    checkRateLimit(request, { env, now: 1_000 });
    checkRateLimit(request, { env, now: 1_100 });
    const result = checkRateLimit(request, { env, now: 1_200 });
    expect(result?.limited).toBe(true);
    if (!result) throw new Error("expected a rate limit result");

    const response = rateLimitResponse(result);
    expect(response.status).toBe(429);
    expect(response.headers.get("RateLimit-Limit")).toBe("2");
    expect(response.headers.get("RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.json()).toMatchObject({ error: "rate_limited" });
  });

  it("can annotate successful responses", () => {
    const request = new Request("http://localhost/api/v1/runs", {
      headers: { "cf-connecting-ip": "203.0.113.23" },
    });

    const result = checkRateLimit(request, { env, now: 1_000 });
    const response = setRateLimitHeaders(new Response("ok"), result);

    expect(response.headers.get("RateLimit-Limit")).toBe("2");
    expect(response.headers.get("RateLimit-Remaining")).toBe("1");
    expect(response.headers.has("Retry-After")).toBe(false);
  });
});
