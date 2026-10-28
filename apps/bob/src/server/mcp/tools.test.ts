import { describe, it, expect, vi } from "vitest";
vi.mock("@bob/api/handlers/workItems", () => ({
  workItemsList: vi.fn(async () => []),
  workItemsGet: vi.fn(),
  workItemsUpdate: vi.fn(),
  workItemsCreateComment: vi.fn(),
}));
import { makeTools, makeWorkspaceIdentity } from "./tools";
import { workItemsUpdate } from "@bob/api/handlers/workItems";
import type { Db } from "@bob/db/client";
import type { OAuthGrant, OAuthIdentity } from "./types";
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
  return { db, identity, itemLookup, tools: makeTools(db, identity) };
}
describe("MCP tool boundaries", () => {
  it("lists only tools permitted by the grant", () => {
    const { tools } = fixture();
    expect(tools.list(grant)).toHaveLength(4);
    expect(
      tools.list({ ...grant, scopes: ["bob:read", "bob:write"] }),
    ).toHaveLength(6);
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
  it("treats viewer membership as read-only", async () => {
    const { db } = fixture();
    const identity = makeWorkspaceIdentity(db, async () => null);
    expect(await identity.access("alice", id, false)).toBe(true);
    expect(await identity.access("alice", id, true)).toBe(false);
  });
});
