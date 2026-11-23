import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { makeOAuth } from "./oauth";
import { makeMcpTransport } from "./transport";
import type { OAuthGrant } from "./types";

it("interoperates with the official MCP Streamable HTTP client", async () => {
  const grant: OAuthGrant = {
    id: "grant",
    clientId: "client",
    userId: "alice",
    workspaceId: "workspace",
    scopes: ["bob:read"],
    resource: "https://bob.example/mcp",
    expiresAt: new Date(Date.now() + 100000),
    revokedAt: null,
  };
  // Isolate transport interoperability from OAuth; auth has separate integration
  // coverage. All bytes still pass through real Request/Response objects.
  const oauth = {
    resource: grant.resource,
    authenticate: async () => grant,
  } as unknown as ReturnType<typeof makeOAuth>;
  const handle = makeMcpTransport(oauth, {
    list: () => [
      {
        name: "bob_list_projects",
        description: "List projects",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    call: async () => ({ projects: [{ id: "project", name: "Bob" }] }),
  });
  const transport = new StreamableHTTPClientTransport(new URL(grant.resource), {
    fetch: async (url, init) => handle(new Request(url, init)),
  });
  const client = new Client({ name: "test", version: "1" });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools[0]?.name).toBe("bob_list_projects");
    expect(
      await client.callTool({ name: "bob_list_projects", arguments: {} }),
    ).toMatchObject({
      isError: false,
      structuredContent: { projects: [{ name: "Bob" }] },
    });
    await client.ping();
  } finally {
    await client.close();
  }
});
