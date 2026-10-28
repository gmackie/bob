import { describe, it, expect, vi } from "vitest";
import { makeMcpTransport } from "./transport";
import { makeOAuth } from "./oauth";
import type { OAuthGrant } from "./types";

const grant: OAuthGrant = {
  id: "grant",
  clientId: "client",
  userId: "alice",
  workspaceId: "workspace",
  scopes: ["bob:read"],
  resource: "https://bob.example/mcp",
  expiresAt: new Date(Date.now() + 10000),
  revokedAt: null,
};
function fixture(authorized = true) {
  const oauth = {
    resource: grant.resource,
    authenticate: vi.fn(async () => (authorized ? grant : null)),
  } as unknown as ReturnType<typeof makeOAuth>;
  const tools = {
    list: vi.fn(() => [{ name: "bob_list_projects" }]),
    call: vi.fn(async () => ({ projects: [] })),
  };
  const handle = makeMcpTransport(oauth, tools);
  const request = (
    body: unknown,
    options: {
      method?: string;
      headers?: Record<string, string>;
      raw?: string;
    } = {},
  ) =>
    handle(
      new Request(grant.resource, {
        method: options.method ?? "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...options.headers,
        },
        body: ["GET", "DELETE"].includes(options.method ?? "")
          ? undefined
          : (options.raw ?? JSON.stringify(body)),
      }),
    );
  return { tools, request };
}
const message = (method: string, params?: unknown) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  params,
});
describe("stateless Streamable HTTP MCP", () => {
  it("advertises OAuth discovery on unauthorized requests", async () => {
    const f = fixture(false);
    const r = await f.request(message("tools/list"));
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain(
      "/.well-known/oauth-protected-resource/mcp",
    );
    expect(f.tools.list).not.toHaveBeenCalled();
  });
  it("initializes, lists tools, calls tools, and accepts notifications", async () => {
    const f = fixture();
    const initialized = await (
      await f.request(
        message("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        }),
      )
    ).json();
    expect(initialized).toMatchObject({
      result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } },
    });
    expect(await (await f.request(message("tools/list"))).json()).toMatchObject(
      { result: { tools: [{ name: "bob_list_projects" }] } },
    );
    expect(
      await (
        await f.request(
          message("tools/call", { name: "bob_list_projects", arguments: {} }),
        )
      ).json(),
    ).toMatchObject({
      result: { isError: false, structuredContent: { projects: [] } },
    });
    expect(f.tools.call).toHaveBeenCalledWith(grant, "bob_list_projects", {});
    expect(
      (await f.request({ jsonrpc: "2.0", method: "notifications/initialized" }))
        .status,
    ).toBe(202);
    expect((await f.request(null, { method: "GET" })).status).toBe(405);
  });
  it("validates origins, versions, envelopes, content negotiation, and size", async () => {
    const f = fixture();
    expect(
      (
        await f.request(message("ping"), {
          headers: { origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await f.request(message("ping"), {
          headers: { "MCP-Protocol-Version": "unsupported" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.request(message("ping"), {
          headers: { Accept: "application/json" },
        })
      ).status,
    ).toBe(406);
    expect((await f.request([message("ping")])).status).toBe(400);
    expect((await f.request(null, { raw: "{" })).status).toBe(400);
    expect((await f.request(null, { raw: "x".repeat(40_000) })).status).toBe(
      413,
    );
    expect(
      (await f.request({ jsonrpc: "2.0", id: null, method: "ping" })).status,
    ).toBe(400);
    expect(
      await (await f.request(message("unsupported"))).json(),
    ).toMatchObject({ error: { code: -32601 } });
  });
  it("returns tool failures without leaking internal errors", async () => {
    const f = fixture();
    f.tools.call.mockRejectedValue(new Error("database password=secret"));
    const r = await (
      await f.request(
        message("tools/call", { name: "bob_list_projects", arguments: {} }),
      )
    ).json();
    expect(r).toMatchObject({ result: { isError: true } });
    expect(JSON.stringify(r)).not.toContain("secret");
  });
});
