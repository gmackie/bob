import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PgliteDbHandle } from "@bob/db/client-pglite";
import { makePgliteDb } from "@bob/db/client-pglite";
import {
  chatConversations,
  tenantMembers,
  tenants,
  user,
  workItems,
  workspaces,
} from "@bob/db/schema";

import { publicApiDispatchExecution } from "../publicApi.js";
import { sessionList } from "../session.js";

// Bob's executions view lists the sessions Bob runs on behalf of an external
// dispatcher (GenTrellis research) next to everything else, filtered by the
// provenance recorded at dispatch.
describe("sessionList — executions by dispatch source", () => {
  let handle: PgliteDbHandle;
  const workspaceId = "22222222-2222-4222-8222-222222222222";
  const ctx = {
    get db() {
      return handle.db as never;
    },
    userId: "user-1",
  };
  const source = {
    system: "gentrellis-research",
    kind: "research-hypothesis",
    environment: "dronesplat-nvs",
    suggestionId: "412",
    url: "https://console.gentrellis.com/dashboard/research?env=dronesplat-nvs",
  };
  let declaredSessionId = "";
  let legacySessionId = "";
  let ordinarySessionId = "";
  const originalFlag = process.env.BOB_OODA_DISPATCH_ENABLED;

  async function insertSession(
    title: string,
    description: string | null,
    updatedAt: Date,
  ) {
    const [item] = await handle.db
      .insert(workItems)
      .values({
        ownerUserId: "user-1",
        workspaceId,
        kind: "task",
        title,
        description,
        status: "in_progress",
        sequenceNumber: Math.floor(updatedAt.getTime() / 1000),
      })
      .returning();
    if (!item) throw new Error("Work item fixture was not created");
    const [session] = await handle.db
      .insert(chatConversations)
      .values({
        userId: "user-1",
        workingDirectory: "/home/bob/dev/dronesplat-autolab",
        agentType: "claude",
        sessionType: "execution",
        status: "completed",
        title,
        workItemId: item.id,
        updatedAt: updatedAt.toISOString(),
      })
      .returning();
    if (!session) throw new Error("Session fixture was not created");
    return session.id;
  }

  beforeAll(async () => {
    process.env.BOB_OODA_DISPATCH_ENABLED = "true";
    delete process.env.GATEWAY_URL;
    delete process.env.NUDGE_SHARED_SECRET;
    handle = await makePgliteDb({ dataDir: ":memory:" });
    await handle.db
      .insert(user)
      .values({ id: "user-1", name: "Owner", email: "owner@example.com" });
    const [tenant] = await handle.db
      .insert(tenants)
      .values({ name: "Personal", slug: "personal" })
      .returning();
    if (!tenant) throw new Error("Tenant fixture was not created");
    await handle.db
      .insert(tenantMembers)
      .values({ tenantId: tenant.id, userId: "user-1", role: "owner" });
    await handle.db.insert(workspaces).values({
      id: workspaceId,
      ownerUserId: "user-1",
      tenantId: tenant.id,
      name: "Bob",
      slug: "bob",
    });

    legacySessionId = await insertSession(
      "legacy hypothesis",
      "You are implementing one research hypothesis as a real code change.\n\nHypothesis: ...",
      new Date("2026-10-01T00:00:00Z"),
    );
    ordinarySessionId = await insertSession(
      "fix the login bug",
      "Mentions refs/autolab/champion but is ordinary work",
      new Date("2026-10-02T00:00:00Z"),
    );
    const dispatched = await publicApiDispatchExecution(ctx, {
      workspaceId,
      title: "freeze geometry early",
      description: "You are implementing one research hypothesis as a real code change.",
      workingDirectory: "/home/bob/dev/dronesplat-autolab",
      agentType: "claude",
      source,
    });
    declaredSessionId = dispatched.sessionId;
  });

  afterAll(async () => {
    if (originalFlag === undefined) delete process.env.BOB_OODA_DISPATCH_ENABLED;
    else process.env.BOB_OODA_DISPATCH_ENABLED = originalFlag;
    await handle.close();
  });

  it("returns the declared dispatch source on each session", async () => {
    const { items } = await sessionList(ctx, { limit: 50 });
    const declared = items.find((s) => s.id === declaredSessionId);
    expect(declared?.dispatchSource).toEqual(source);
    expect(items.find((s) => s.id === ordinarySessionId)?.dispatchSource).toBeNull();
  });

  it("filters to one dispatching system, including pre-provenance research sessions", async () => {
    const { items } = await sessionList(ctx, {
      limit: 50,
      source: "gentrellis-research",
    });
    expect(items.map((s) => s.id).sort()).toEqual(
      [declaredSessionId, legacySessionId].sort(),
    );
    // A pre-provenance session is attributed by its prompt, not by stored data.
    expect(items.find((s) => s.id === legacySessionId)?.dispatchSource).toEqual({
      system: "gentrellis-research",
      inferred: true,
    });
  });

  it("returns nothing for a system that never dispatched", async () => {
    const { items } = await sessionList(ctx, { limit: 50, source: "ooda" });
    expect(items).toEqual([]);
  });

  it("pages with the cursor without repeating or skipping sessions", async () => {
    const first = await sessionList(ctx, { limit: 2, sessionType: "execution" });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();
    const second = await sessionList(ctx, {
      limit: 2,
      sessionType: "execution",
      cursor: first.nextCursor,
    });
    const ids = [...first.items, ...second.items].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(
      [declaredSessionId, legacySessionId, ordinarySessionId].sort(),
    );
    expect(second.nextCursor).toBeUndefined();
  });
});
