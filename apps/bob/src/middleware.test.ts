import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, middleware } from "./middleware";

const makeRequest = (
  path: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
) => new NextRequest(`https://bob.example.com${path}`, init);

describe("Bob middleware", () => {
  it("answers browser API preflights with the public CORS contract", () => {
    const response = middleware(
      makeRequest("/api/v1/work-items/list", {
        method: "OPTIONS",
        headers: {
          Origin: "http://127.0.0.1:5733",
          "Access-Control-Request-Headers": "authorization,content-type",
          "Access-Control-Request-Method": "POST",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Authorization, Content-Type, X-API-Key",
    );
    expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
  });

  it("adds CORS headers to non-preflight browser API responses", () => {
    const response = middleware(
      makeRequest("/api/v1/device/code", { method: "POST" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("keeps root redirects and legacy API rewrites intact", () => {
    const rootResponse = middleware(makeRequest("/"));
    const legacyResponse = middleware(
      makeRequest("/v1/work-items/list?limit=10"),
    );

    expect(rootResponse.status).toBe(302);
    expect(rootResponse.headers.get("location")).toBe(
      "https://bob.example.com/runs",
    );
    expect(legacyResponse.headers.get("x-middleware-rewrite")).toBe(
      "https://bob.example.com/api/v1/work-items/list?limit=10",
    );
  });

  it("matches the browser API namespace", () => {
    expect(config.matcher).toContain("/api/v1/:path*");
  });
});
