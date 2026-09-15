import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { HandlerContext } from "../context";
import { dispatchExecutionBatch } from "../dispatch";

function fixture(itemWorkspace: string | null) {
  const insert = vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([{ id: "session-1", title: "Owned task" }]) }) }));
  const db = {
    query: {
      workspaceMembers: { findFirst: () => Promise.resolve({ id: "membership-1" }) },
      workItems: { findFirst: ({ where }: { where: SQL }) => {
        const query = new PgDialect().sqlToQuery(where);
        const scoped = query.params.includes("workspace-1");
        return Promise.resolve(itemWorkspace && (!scoped || itemWorkspace === "workspace-1")
          ? { id: "item-1", workspaceId: itemWorkspace, title: "Owned task", description: "Context", project: null, sequenceNumber: 1 } : undefined);
      } },
    },
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ max: 1 }]) }) }),
    insert,
  };
  return { ctx: { db, userId: "user-1" } as unknown as HandlerContext, insert };
}
const input = { workspaceId: "workspace-1", agentType: "codex", concurrency: 1, items: [{ workItemId: "item-1" }] };
describe("execution batch ownership", () => {
  const nudge = vi.fn(() => Promise.resolve(new Response("{}")));
  beforeEach(() => {
    nudge.mockClear();
    vi.stubGlobal("fetch", nudge);
    vi.stubEnv("GATEWAY_URL", "https://gateway.example");
    vi.stubEnv("NUDGE_SHARED_SECRET", "fixture-secret");
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it.each(["workspace-2", null])("rejects foreign or missing item %s before creating a session", async (workspace) => {
    const { ctx, insert } = fixture(workspace);
    await expect(dispatchExecutionBatch(ctx, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(insert).not.toHaveBeenCalled();
    expect(nudge).not.toHaveBeenCalled();
  });
  it("dispatches an item from the authorized workspace", async () => {
    const { ctx, insert } = fixture("workspace-1");
    await expect(dispatchExecutionBatch(ctx, input)).resolves.toMatchObject({ total: 1, items: [{ workItemId: "item-1", sessionId: "session-1" }] });
    expect(insert).toHaveBeenCalledOnce();
    expect(nudge).toHaveBeenCalledOnce();
  });
});
