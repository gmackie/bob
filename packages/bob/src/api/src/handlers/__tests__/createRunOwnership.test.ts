import { describe, expect, it, vi } from "vitest";

import type { HandlerContext } from "../context";
import { publicApiCreateRun } from "../publicApi";

vi.mock("../../services/quotas/index.js", () => ({
  assertWithinQuotaOrThrow: vi.fn().mockResolvedValue(undefined),
}));
function fixture(workItem: unknown) {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    query: {
      workspaces: { findFirst: () => Promise.resolve({ tenantId: "tenant-1" }) },
      tenantMembers: { findMany: () => Promise.resolve([{ tenantId: "tenant-1" }]) },
      chatConversations: { findFirst: vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined) },
      workItems: { findFirst: () => Promise.resolve(workItem) },
    },
    insert: () => ({
      values: (input: Record<string, unknown>) => ({
        returning: () => {
          inserted.push(input);
          return Promise.resolve([{ id: "run-1", ...input }]);
        },
      }),
    }),
    // registerSessionAgentRun (session-bound runs) locks the session row and
    // dedups inside a transaction; the fixture's tx sees the same inserts.
    transaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn({
        select: () => ({
          from: () => ({
            where: () => ({ for: () => Promise.resolve([{ id: "22222222-2222-4222-8222-222222222222" }]) }),
          }),
        }),
        query: { agentRuns: { findFirst: () => Promise.resolve(undefined) } },
        insert: () => db.insert(),
      }),
  };
  return { ctx: { db, userId: "user-1" } as unknown as HandlerContext, db, inserted };
}
describe("run work-item ownership", () => {
  it("stores the resolved local UUID even when agentType is pinned", async () => {
    const { ctx, inserted } = fixture({
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: "workspace-1",
    });
    await publicApiCreateRun(ctx, {
      workspaceId: "workspace-1",
      workItemId: "BOB-42",
      agentType: "codex",
    });
    expect(inserted[0]?.workItemId).toBe("11111111-1111-4111-8111-111111111111");
  });
  it("rejects a UUID that does not resolve in the authorized workspace", async () => {
    const { ctx, inserted } = fixture(undefined);
    await expect(
      publicApiCreateRun(ctx, {
        workspaceId: "workspace-1",
        workItemId: "11111111-1111-4111-8111-111111111111",
        agentType: "codex",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(inserted).toEqual([]);
  });
  it("binds a reported session to its workspace-owned work item", async () => {
    const { ctx, db, inserted } = fixture({
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: "workspace-1",
    });
    db.query.chatConversations.findFirst.mockResolvedValue({
        id: "22222222-2222-4222-8222-222222222222",
        workItemId: "11111111-1111-4111-8111-111111111111",
    });
    await publicApiCreateRun(ctx, {
      workspaceId: "workspace-1",
      workItemId: "display-identifier",
      agentType: "codex",
      agentConfig: { sessionId: "22222222-2222-4222-8222-222222222222" },
    });
    expect(inserted[0]).toMatchObject({
      sessionId: "22222222-2222-4222-8222-222222222222",
      workItemId: "11111111-1111-4111-8111-111111111111",
    });
  });
  it("rejects a session from another workspace", async () => {
    const { ctx, db, inserted } = fixture(undefined);
    db.query.chatConversations.findFirst.mockResolvedValue({
        id: "22222222-2222-4222-8222-222222222222",
        workItemId: "11111111-1111-4111-8111-111111111111",
    });
    await expect(
      publicApiCreateRun(ctx, {
        workspaceId: "workspace-1",
        workItemId: "display-identifier",
        agentType: "codex",
        agentConfig: { sessionId: "22222222-2222-4222-8222-222222222222" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(inserted).toEqual([]);
  });
  it("retains the existing record-only contract for unmapped external identifiers", async () => {
    const { ctx, inserted } = fixture(undefined);
    await publicApiCreateRun(ctx, {
      workspaceId: "workspace-1",
      workItemId: "FG-unmapped",
      agentType: "codex",
    });
    expect(inserted[0]?.workItemId).toBe("FG-unmapped");
  });
});
