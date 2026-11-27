import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "@bob/db";
import type { Db } from "@bob/db/client";
import { makePgliteDb, type PgliteDbHandle } from "@bob/db/client-pglite";
import {
  agentRuns,
  chatConversations,
  projects,
  tenantMembers,
  tenants,
  user,
  workItems,
  workspaceMembers,
  workspaces,
} from "@bob/db/schema";
import { makeApps } from "./apps";
import { digest, makeOAuth, randomToken } from "./oauth";
import { makeOAuthStore } from "./store";
import { makeMcpTransport } from "./transport";
import { makeTools } from "./tools";
import { makeWorkspaceIdentity } from "./identity";
import type { OAuthGrant } from "./types";

vi.mock("../bizpulse/link", () => ({ bizPulseAccess: vi.fn() }));
const workspaceId = randomUUID(),
  otherWorkspace = randomUUID(),
  tenantId = randomUUID();
const projectId = randomUUID(),
  otherProject = randomUUID();
const itemId = randomUUID(),
  otherItem = randomUUID(),
  readyItem = randomUUID();
const sessionId = randomUUID(),
  threadId = `bob-${createHash("sha256").update(sessionId).digest("hex").slice(0, 32)}`;
const matchedRun = randomUUID(),
  oldRun = randomUUID();
const read: OAuthGrant = {
  id: "connection",
  clientId: "t3",
  userId: "member",
  workspaceId,
  scopes: ["bob:read"],
  resource: "https://bob.example/mcp",
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
};
const write = { ...read, scopes: ["bob:read", "bob:write"] };
let handle: PgliteDbHandle;
// New tool service per call, like two T3 sessions served by different isolates.
function tools() {
  const db = handle.db as unknown as Db;
  return makeTools(
    db,
    makeWorkspaceIdentity(db, async () => null),
    {
      origin: "https://bob.example",
      store: { addCredential: async () => {} },
      sdlcEnv: () => ({}),
    },
  );
}
const call = (grant: OAuthGrant, name: string, args: Record<string, unknown>) =>
  tools().call(grant, name, args);

beforeAll(async () => {
  handle = await makePgliteDb({ dataDir: ":memory:" });
  const { db } = handle;
  // Exercise the actual upgrade SQL on a database with Bob's current schema.
  await handle.client.exec("DROP TABLE mcp_linear_links");
  await handle.client.exec(
    await readFile(
      new URL(
        "../../../../../packages/bob/src/db/drizzle/0045_mcp_linear_links.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.insert(user).values({ id: "member", name: "Member", email: "member@bob.test" });
  await db.insert(tenants).values({ id: tenantId, name: "Tenant", slug: "tenant" });
  await db.insert(tenantMembers).values({ userId: "member", tenantId });
  for (const id of [workspaceId, otherWorkspace]) {
    await db.insert(workspaces).values({ id, tenantId, ownerUserId: "member", name: id, slug: id });
    await db.insert(workspaceMembers).values({ userId: "member", workspaceId: id, role: "member" });
  }
  await db
    .insert(projects)
    .values(
      [projectId, otherProject].map((id, n) => ({ id, workspaceId, key: `P${n}`, name: id })),
    );
  const item = {
    ownerUserId: "member",
    workspaceId,
    projectId,
    kind: "task" as const,
    status: "todo",
  };
  await db
    .insert(workItems)
    .values([
      { ...item, id: itemId, title: "50%_Coverage", queueSortOrder: 500 },
      { ...item, id: readyItem, projectId: otherProject, title: "Review this" },
      { ...item, id: otherItem, workspaceId: otherWorkspace, projectId: null, title: "Private" },
      ...Array.from({ length: 101 }, (_, i) => ({ ...item, title: `Other ${i}` })),
    ]);
  await db.insert(chatConversations).values({ id: sessionId, userId: "member" });
  const run = {
    tenantId,
    workspaceId,
    workItemId: itemId,
    agentType: "codex",
    status: "completed" as const,
  };
  await db.insert(agentRuns).values([
    { ...run, id: matchedRun, sessionId, createdAt: "2025-01-02" },
    { ...run, id: oldRun, agentConfig: { sessionId }, createdAt: "2025-01-01" },
    // A legacy text workItemId can refer to an item in a different workspace.
    { ...run, workspaceId: otherWorkspace, workItemId: itemId, agentConfig: { threadId } },
    ...Array.from({ length: 51 }, () => ({ ...run, workItemId: null })),
  ]);
}, 60_000);
afterAll(async () => {
  await handle?.close();
});

describe("remote Bob panels with real workspace data", () => {
  it("opens a real resource and reads scoped data through the SDK with a read-only OAuth credential", async () => {
    const db = handle.db as unknown as Db;
    const identity = makeWorkspaceIdentity(db, async () => null);
    const origin = new URL(read.resource).origin;
    const store = makeOAuthStore(db);
    const access = randomToken();
    await store.addClient({
      id: read.clientId,
      name: "T3",
      redirectUris: ["https://t3.example/callback"],
    });
    await store.addGrant(read);
    await store.addCredential({
      hash: await digest(access),
      kind: "access",
      grantId: read.id,
      data: { scopes: read.scopes },
      expiresAt: read.expiresAt,
      usedAt: null,
    });
    const serve = makeMcpTransport(makeOAuth({ origin, identity, store }), tools(), [], makeApps());
    const transport = new StreamableHTTPClientTransport(new URL(read.resource), {
      requestInit: { headers: { Authorization: `Bearer ${access}` } },
      fetch: (url, init) => serve(new Request(url, init)),
    });
    const client = new Client({ name: "T3-test", version: "1" });
    try {
      await client.connect(transport);
      const catalog = await client.listTools();
      expect(catalog.tools.map((tool) => tool.name)).not.toContain("bob_planning_approve");
      const view = catalog.tools.find((tool) => tool.name === "bob_workspace")?._meta?.[
        "ui/resourceUri"
      ];
      if (typeof view !== "string") throw new Error("Missing workspace resource");
      expect((await client.readResource({ uri: view })).contents).toMatchObject([
        { uri: view, mimeType: "text/html;profile=mcp-app" },
      ]);
      expect(
        await client.callTool({ name: "bob_workspace", arguments: { threadId, query: "%_cov" } }),
      ).toMatchObject({
        structuredContent: {
          workspaceId,
          workItems: [{ id: itemId }],
          runs: [{ id: matchedRun }, { id: oldRun }],
        },
      });
      expect(
        await client.callTool({
          name: "bob_linear_links",
          arguments: { action: "remove", bobWorkItemId: itemId },
        }),
      ).toMatchObject({ isError: true });
    } finally {
      await client.close();
    }
  });

  it("applies project, literal title and thread filters before the result limits", async () => {
    const expected = [
      { id: matchedRun, threadId },
      { id: oldRun, threadId },
    ];
    expect(
      await call(read, "bob_workspace", { workspaceId, projectId, query: "%_cov", threadId }),
    ).toMatchObject({ workspaceId, workItems: [{ id: itemId }], runs: expected, pollSeconds: 60 });
    expect(await call(read, "bob_runs_list", { workItemId: itemId, threadId })).toMatchObject({
      runs: expected,
    });
    expect(await call(read, "bob_workspace", { projectId: otherProject, threadId })).toMatchObject({
      runs: [],
    });
    expect(await call(read, "bob_work_item_get", { workItemId: itemId })).toMatchObject({
      item: { id: itemId, providerId: "bob", title: "50%_Coverage" },
    });
    await expect(call(read, "bob_workspace", { workspaceId: otherWorkspace })).rejects.toThrow(
      "must match",
    );
    for (const tool of [
      "bob_work_item_get",
      "bob_runs_list",
      "bob_planning_review",
      "bob_planning_approve",
    ]) {
      await expect(call(write, tool, { workItemId: otherItem })).rejects.toThrow("not found");
    }
  });

  it("stores shared approvals and suppresses mutation actions for read-only panels", async () => {
    expect(await call(read, "bob_planning_review", { workItemId: readyItem })).toMatchObject({
      workflow: { actions: [] },
    });
    await expect(call(read, "bob_planning_approve", { workItemId: readyItem })).rejects.toThrow(
      "access denied",
    );
    expect(await call(write, "bob_planning_approve", { workItemId: readyItem })).toMatchObject({
      approved: true,
    });
    expect(await call(write, "bob_planning_review", { workItemId: readyItem })).toMatchObject({
      workflow: { actions: [{ id: "execute" }] },
    });
  });

  it("persists links across services, serializes replacements, and scopes every link operation", async () => {
    const tool = "bob_linear_links";
    const args = { bobWorkItemId: itemId, linearIssueId: "issue-a", linearProjectId: "project" };
    const created = await call(write, tool, { ...args, action: "upsert" });
    expect(created).toMatchObject({ kind: "create", link: args });
    expect(await call(write, tool, { ...args, action: "upsert" })).toEqual({
      ...(created as object),
      kind: "unchanged",
    });
    expect(await call(read, tool, { action: "list" })).toMatchObject({
      links: [args],
      nextOffset: null,
    });
    const other = { ...write, workspaceId: otherWorkspace };
    expect(await call(other, tool, { action: "list" })).toMatchObject({ links: [] });
    for (const action of ["get", "upsert", "remove"])
      await expect(call(other, tool, { ...args, action })).rejects.toThrow("not found");
    for (const action of ["upsert", "remove"])
      await expect(call(read, tool, { ...args, action })).rejects.toThrow("access denied");
    const replacements = await Promise.all(
      Array.from({ length: 2 }, () =>
        call(write, tool, { action: "upsert", bobWorkItemId: itemId, linearIssueId: "issue-b" }),
      ),
    );
    expect(replacements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "replace", previous: expect.objectContaining(args) }),
        expect.objectContaining({ kind: "unchanged" }),
      ]),
    );
    expect(await call(read, tool, { action: "get", bobWorkItemId: itemId })).toMatchObject({
      link: { linearIssueId: "issue-b" },
    });
    expect(await call(write, tool, { action: "remove", bobWorkItemId: itemId })).toEqual({
      removed: true,
    });
    expect(await call(read, tool, { action: "get", bobWorkItemId: itemId })).toEqual({
      link: null,
    });
    await handle.db
      .update(workspaceMembers)
      .set({ role: "viewer" })
      .where(eq(workspaceMembers.workspaceId, otherWorkspace));
    await expect(
      call(other, tool, { ...args, bobWorkItemId: otherItem, action: "upsert" }),
    ).rejects.toThrow("access denied");
  });
});
