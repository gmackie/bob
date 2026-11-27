import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkLlaveroTools, exchangeLlavero, registerLlavero, revokeLlavero } from "./client";

const origin = "https://keys-stg.gmac.io";
const issuer = origin + "/api/auth";
const config = {
  origin,
  issuer,
  resource: origin + "/mcp",
  bobOrigin: "https://bob.example",
  callback: "https://bob.example/api/llavero/callback",
};
const expectedScope = "llavero:read llavero:propose offline_access";
const metadata = {
  issuer,
  authorization_endpoint: issuer + "/oauth2/authorize",
  token_endpoint: issuer + "/oauth2/token",
  registration_endpoint: issuer + "/oauth2/register",
  revocation_endpoint: issuer + "/oauth2/revoke",
  code_challenge_methods_supported: ["S256"],
};
function oauthReply(scope: string) {
  return Response.json({
    access_token: "gmo_fixture",
    refresh_token: "gmr_fixture",
    token_type: "Bearer",
    expires_in: 3600,
    scope,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Llavero OAuth client", () => {
  it("registers a public client with a pinned resource and S256 proof", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ resource: config.resource, authorization_servers: [issuer] }))
      .mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(Response.json({ client_id: "fixture-client" }, { status: 201 }));
    vi.stubGlobal("fetch", transport);
    const flow = await registerLlavero(config);
    expect(transport).toHaveBeenNthCalledWith(3, metadata.registration_endpoint,
      expect.objectContaining({ method: "POST", redirect: "error" }));
    expect(JSON.parse(String(transport.mock.calls[2]?.[1]?.body))).toMatchObject({
      redirect_uris: [config.callback],
      scope: expectedScope,
      token_endpoint_auth_method: "none",
    });
    expect(Object.fromEntries(flow.url.searchParams)).toMatchObject({
      client_id: "fixture-client",
      redirect_uri: config.callback,
      resource: config.resource,
      state: flow.state,
      scope: expectedScope,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(flow.verifier).digest("base64url"),
    });
  });

  it("refuses unexpected issuer endpoints before registration", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ resource: config.resource, authorization_servers: [issuer] }))
      .mockResolvedValueOnce(Response.json({ ...metadata, token_endpoint: "https://other.example/token" }));
    vi.stubGlobal("fetch", transport);
    await expect(registerLlavero(config)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("requires both rotation scopes and refuses additional authority", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(oauthReply("llavero:read offline_access"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(oauthReply(expectedScope + " llavero:resume"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(oauthReply(expectedScope))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", transport);
    const grant = { refreshToken: "gmr_previous" };
    await expect(exchangeLlavero(config, "fixture-client", grant)).rejects.toThrow();
    await expect(exchangeLlavero(config, "fixture-client", grant)).rejects.toThrow();
    const pair = await exchangeLlavero(config, "fixture-client", grant);
    expect(Object.fromEntries(new URLSearchParams(String(transport.mock.calls[4]?.[1]?.body)))).toEqual({
      client_id: "fixture-client",
      resource: config.resource,
      grant_type: "refresh_token",
      refresh_token: grant.refreshToken,
    });
    await expect(revokeLlavero(config, "fixture-client", pair.refresh_token)).resolves.toBe(true);
    expect(transport).toHaveBeenLastCalledWith(metadata.revocation_endpoint,
      expect.objectContaining({ method: "POST", redirect: "error" }));
  });

  it("checks that the live MCP grant exposes the rotation tools", async () => {
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      const rpc = JSON.parse(String(init?.body));
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      const result = rpc.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "test", version: "1" } }
        : { tools: ["rotation_status"].map((name) => ({ name, inputSchema: { type: "object" } })) };
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
    });
    vi.stubGlobal("fetch", transport);
    await expect(checkLlaveroTools(config, "gmo_fixture")).resolves.toBe(false);
    expect(transport.mock.calls.every(([url]) => String(url) === config.resource)).toBe(true);
  });
});
