import { describe, it, expect, vi } from "vitest";
vi.mock("../bizpulse/link", () => ({ bizPulseAccess: vi.fn() }));
vi.mock("@bob/api/handlers/workItems", () => ({
  BIZPULSE_CREDENTIAL_SETUP: "bizpulse-credential",
  workItemsList: vi.fn(async () => []),
  workItemsGet: vi.fn(),
  workItemsUpdate: vi.fn(),
  workItemsCreateComment: vi.fn(),
  workItemsDispatch: vi.fn(),
}));
vi.mock("@bob/api/handlers/publicApi", () => ({
  workspaceRunSummaries: vi.fn(async () => []),
}));
import { makeTools } from "./tools";
import { makeWorkspaceIdentity } from "./identity";
import type { McpSdlcEnv } from "./sdlc";
import { workItemsUpdate } from "@bob/api/handlers/workItems";
import type { Db } from "@bob/db/client";
import type { Credential, OAuthGrant, OAuthIdentity } from "./types";
const id = "aaaabbbb-1111-4000-8000-000000000001";
const grant: OAuthGrant = {
  id,
  clientId: "client",
  userId: "alice",
  workspaceId: id,
  scopes: ["bob:read"],
  resource: "https://bob.example/mcp",
  expiresAt: new Date(Date.now() + 10000),
  revokedAt: null,
};
function fixture() {
  const itemLookup = vi.fn(async () => undefined);
  const db = {
    query: {
      workItems: { findFirst: itemLookup },
      projects: { findFirst: vi.fn(async () => undefined) },
      workspaceMembers: { findFirst: vi.fn(async () => ({ role: "viewer" })) },
    },
  } as unknown as Db;
  const identity = {
    access: vi.fn(async () => true),
  } as unknown as OAuthIdentity;
  const store = { addCredential: vi.fn(async (_credential: Credential) => {}) };
  const sdlcEnv = {
    SDLC_EDGE_WORKSPACE_ID: id, SDLC_VIEWER_USER_IDS: "alice",
    SDLC_EDGE: { idFromName: vi.fn((id: string) => id), get: vi.fn(() => ({ fetch: async () => Response.json({ scope: "fleet" }) })) },
  };
  return {
    sdlcEnv,
    db,
    identity,
    itemLookup,
    store,
    tools: makeTools(db, identity, { store, origin: "https://bob.example", sdlcEnv: () => sdlcEnv as unknown as McpSdlcEnv }),
  };
}
describe("MCP tool boundaries", () => {
  it("lists only tools permitted by the grant", async () => {
    const { tools } = fixture();
    expect(await tools.list(grant)).toHaveLength(11);
    expect(
      await tools.list({ ...grant, scopes: ["bob:read", "bob:write"] }),
    ).toHaveLength(16);
  });
  it("publishes all nine former plugin tools and advertises only authorized link actions", async () => {
    const { tools } = fixture();
    const writes = { ...grant, scopes: ["bob:read", "bob:write"] };
    const expected = ["bob_workspace", "bob_planning_review", "bob_sdlc", "bob_sdlc_item_for_thread", "bob_planning_approve", "bob_planning_dispatch", "bob_work_item_get", "bob_runs_list", "bob_linear_links"];
    const all = await tools.list(writes) as { name: string }[];
    expect(all.map((t) => t.name)).toEqual(expect.arrayContaining(expected));
    for (const [g, actions] of [[grant, ["get", "list"]], [writes, ["get", "list", "upsert", "remove"]]] as const) {
      expect(await tools.list(g)).toEqual(expect.arrayContaining([expect.objectContaining({
        name: "bob_linear_links", inputSchema: expect.objectContaining({ type: "object", required: ["action"], properties: expect.objectContaining({ action: { type: "string", enum: actions } }) }),
        annotations: expect.objectContaining({ readOnlyHint: g === grant }),
      })]));
    }
  });
  it("names each view's opening tool and keeps approval and the legacy edge socket app-only", async () => {
    const { tools, store } = fixture();
    const write = { ...grant, scopes: ["bob:read", "bob:write"] };
    const meta = Object.fromEntries(
      (await tools.list(write) as { name: string; _meta: unknown }[]).map((t) => [t.name, t._meta]),
    );
    expect(meta.bob_workspace).toEqual({ "ui/resourceUri": "ui://bob/workspace.html", ui: { resourceUri: "ui://bob/workspace.html", visibility: ["model", "app"] } });
    expect(meta.bob_planning_dispatch).toEqual({ "ui/resourceUri": "ui://bob/planning-review.html", ui: { resourceUri: "ui://bob/planning-review.html", visibility: ["model", "app"] } });
    expect(meta.bob_sdlc).toEqual({ "ui/resourceUri": "ui://bob/sdlc.html", ui: { resourceUri: "ui://bob/sdlc.html", visibility: ["model", "app"] } });
    expect(meta.bob_planning_approve).toEqual({ ui: { visibility: ["app"] } });
    expect(meta.bob_sdlc_connect).toEqual({ ui: { visibility: ["app"] } });
    expect(meta.bob_list_projects).toEqual({ ui: { visibility: ["model"] } });
    const { url } = (await tools.call(write, "bob_sdlc_connect", {})) as { url: string };
    const ticket = new URL(url).searchParams.get("ticket");
    expect(url.startsWith("wss://bob.example/api/sdlc/ws?ticket=")).toBe(true);
    const issued = vi.mocked(store.addCredential).mock.calls[0]?.[0];
    expect(issued).toMatchObject({ kind: "sdlc_ticket", grantId: grant.id });
    expect(issued?.hash).not.toBe(ticket);
    await expect(tools.call(grant, "bob_sdlc_connect", {})).rejects.toThrow("access denied");
  });
  it("rejects scope escalation even when a write tool name is known", async () => {
    const { tools, itemLookup } = fixture();
    await expect(
      tools.call(grant, "bob_update_work_item", { id, title: "change" }),
    ).rejects.toThrow("access denied");
    expect(itemLookup).not.toHaveBeenCalled();
    expect(workItemsUpdate).not.toHaveBeenCalled();
  });
  it("denies work items outside the token's selected workspace before invoking handlers", async () => {
    const { tools, itemLookup } = fixture();
    await expect(
      tools.call(
        { ...grant, scopes: ["bob:read", "bob:write"] },
        "bob_update_work_item",
        { id, title: "change" },
      ),
    ).rejects.toThrow("not found");
    expect(itemLookup).toHaveBeenCalledOnce();
    expect(workItemsUpdate).not.toHaveBeenCalled();
  });
  it("rejects workspace arguments, prototype names, and revoked membership", async () => {
    const f = fixture();
    await expect(
      f.tools.call(grant, "bob_list_work_items", { workspaceId: "other" }),
    ).rejects.toThrow();
    await expect(f.tools.call(grant, "toString", {})).rejects.toThrow(
      "Unknown tool",
    );
    vi.mocked(f.identity.access).mockResolvedValue(false);
    await expect(f.tools.call(grant, "bob_list_projects", {})).rejects.toThrow(
      "access denied",
    );
  });
  it("only addresses the configured SDLC workspace for a current viewer", async () => {
    const { tools, sdlcEnv, store, identity } = fixture();
    for (const denied of [{ ...grant, workspaceId: "elsewhere" }, { ...grant, userId: "other" }]) {
      await expect(tools.call(denied, "bob_sdlc", {})).rejects.toThrow("SDLC access");
      await expect(tools.call(denied, "bob_sdlc_item_for_thread", { threadId: "thread" })).rejects.toThrow("SDLC access");
      await expect(tools.call({ ...denied, scopes: ["bob:read", "bob:write"] }, "bob_sdlc_connect", {})).rejects.toThrow("SDLC access");
    }
    expect(sdlcEnv.SDLC_EDGE.get).not.toHaveBeenCalled();
    expect(store.addCredential).not.toHaveBeenCalled();
    await expect(tools.call(grant, "bob_sdlc", {})).resolves.toMatchObject({ scope: "fleet" });
    expect(identity.access).toHaveBeenLastCalledWith("alice", id, false);
    expect(sdlcEnv.SDLC_EDGE.idFromName).toHaveBeenCalledWith(grant.workspaceId);
  });
  it("treats viewer membership as read-only", async () => {
    const { db } = fixture();
    const identity = makeWorkspaceIdentity(db, async () => null);
    expect(await identity.access("alice", id, false)).toBe(true);
    expect(await identity.access("alice", id, true)).toBe(false);
  });
});
