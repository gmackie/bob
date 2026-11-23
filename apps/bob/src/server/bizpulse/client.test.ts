import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";

import { createAuthorization, discover, exchange } from "./client";

const config = {
  origin: "https://bizpulse.test",
  bobOrigin: "https://bob.test",
  resource: "https://bizpulse.test/mcp",
  callback: "https://bob.test/api/bizpulse/callback",
};
afterEach(() => vi.unstubAllGlobals());

it("pins discovery and builds an authorization request with a fresh PKCE challenge", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith("/mcp")
          ? {
              resource: config.resource,
              authorization_servers: [config.origin],
            }
          : {
              issuer: config.origin,
              authorization_endpoint: config.origin + "/oauth/authorize",
              token_endpoint: config.origin + "/oauth/token",
            },
      ),
    ),
  );
  const metadata = await discover(config);
  const { url, verifier, state } = createAuthorization(
    config,
    metadata.authorization_endpoint,
  );
  expect(url.searchParams.get("redirect_uri")).toBe(config.callback);
  expect(url.searchParams.get("resource")).toBe(config.resource);
  expect(url.searchParams.get("state")).toBe(state);
  expect(url.searchParams.get("code_challenge")).toBe(
    createHash("sha256").update(verifier).digest("base64url"),
  );
  expect(url.searchParams.get("code_verifier")).toBeNull();
});

it("refuses unexpected discovery endpoints without sending a token", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith("/mcp")
          ? {
              resource: config.resource,
              authorization_servers: [config.origin],
            }
          : {
              issuer: config.origin,
              authorization_endpoint: "https://elsewhere.test/authorize",
              token_endpoint: config.origin + "/oauth/token",
            },
      ),
    ),
  );
  await expect(discover(config)).rejects.toThrow();
});

it("posts the exact redirect and resource only to the configured token endpoint", async () => {
  const request = vi.fn(async () =>
    Response.json({
      token_type: "Bearer",
      access_token: "a".repeat(43),
      refresh_token: "b".repeat(43),
      expires_in: 600,
      scope: "credentials:read",
    }),
  );
  vi.stubGlobal("fetch", request);
  await expect(
    exchange(config, { kind: "code", code: "synthetic", verifier: "test" }),
  ).resolves.toMatchObject({ expires_in: 600 });
  expect(request).toHaveBeenCalledWith(
    config.origin + "/oauth/token",
    expect.objectContaining({
      redirect: "error",
      method: "POST",
      body: expect.any(URLSearchParams),
    }),
  );
});
