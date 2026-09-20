import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { HandlerContext } from "../context";
import { dispatchExecutionBatch } from "../dispatch";
import { workItemsDispatch } from "../workItems";
import { chatConversations, taskRuns } from "@bob/db/schema";

const mapping = vi.hoisted(() => ({ mismatch: false, unavailable: false }));
const carrier = { traceparent: "00-11111111111111111111111111111111-2222222222222222-01" };
vi.mock("@gmacko/core/telemetry/deep", () => ({ captureTraceCarrier: () => ({ traceparent: "00-11111111111111111111111111111111-2222222222222222-01" }) }));
vi.mock("../../services/forgegraph/config", () => ({ getForgeGraphClient: () => ({ getWorkItemByExternalId: (id: string) => { if (mapping.unavailable) return Promise.reject(new Error("mapping unavailable")); return Promise.resolve({ id: "fg-1", externalId: mapping.mismatch ? "other-item" : id }); } }) }));
vi.mock("../../services/quotas/index.js", () => ({ assertWithinQuotaOrThrow: vi.fn() }));

function fixture(itemWorkspace: string | null, failTaskRun = false) {
  const rows: { table: unknown; value: Record<string, unknown> }[] = [];
  const insert = vi.fn((table: unknown) => ({ values: (value: Record<string, unknown>) => { rows.push({ table, value }); return { returning: () => failTaskRun && table === taskRuns ? Promise.reject(new Error("task run insert failed")) : Promise.resolve([{ ...value, id: table === taskRuns ? "task-run-1" : "session-1", title: "Owned task" }]) }; } }));
  const db = {
    query: {
      workspaces: { findFirst: () => Promise.resolve({ defaultAgentType: "codex" }) },
      workspaceMembers: { findFirst: () => Promise.resolve({ id: "membership-1" }) },
      workItems: { findFirst: ({ where }: { where: SQL }) => {
        const query = new PgDialect().sqlToQuery(where);
        const scoped = query.params.includes("workspace-1");
        return Promise.resolve(itemWorkspace && (!scoped || itemWorkspace === "workspace-1")
          ? { id: "item-1", workspaceId: itemWorkspace, ownerUserId: "user-1", externalProvider: "linear", externalId: "issue-1", title: "Owned task", description: "Context", project: null, sequenceNumber: 1 } : undefined);
      } },
    },
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ max: 1 }]) }) }),
    insert,
  };
  const contextDb = { ...db, transaction: (fn: (tx: typeof db) => Promise<unknown>) => fn(db) };
  return { ctx: { db: contextDb, userId: "user-1" } as unknown as HandlerContext, insert, rows };
}
const input = { workspaceId: "workspace-1", agentType: "codex", concurrency: 1, items: [{ workItemId: "item-1" }] };
describe("execution batch ownership", () => {
  const nudge = vi.fn(() => Promise.resolve(new Response("{}")));
  beforeEach(() => {
    nudge.mockClear();
    mapping.mismatch = false;
    mapping.unavailable = false;
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
    const { ctx, insert, rows } = fixture("workspace-1");
    await expect(dispatchExecutionBatch(ctx, input)).resolves.toMatchObject({ total: 1, items: [{ workItemId: "item-1", sessionId: "session-1" }] });
    expect(insert).toHaveBeenCalledTimes(2);
    expect(rows.find(row => row.table === taskRuns)?.value).toMatchObject({ sessionId: "session-1", workItemId: "item-1", planningWorkspaceId: "workspace-1", planningProvider: "linear" });
    expect(rows.find(row => row.table === chatConversations)?.value).toMatchObject({ personaMetadata: { metadata: { traceCarrier: carrier }, traceReportScope: { workItemId: "item-1", workspaceId: "workspace-1", issueId: "issue-1", forgeGraphWorkItemId: "fg-1" } } });
    expect(nudge).toHaveBeenCalledOnce();
  });
  it.each(["mismatch", "unavailable"] as const)("keeps owned execution available without trusting an invalid FG mapping: %s", async (failure) => {
    mapping[failure] = true;
    const { ctx, rows } = fixture("workspace-1");
    await dispatchExecutionBatch(ctx, input);
    const persona = rows.find(row => row.table === chatConversations)?.value.personaMetadata;
    expect(persona).toMatchObject({ traceReportScope: { workItemId: "item-1", issueId: "issue-1" } });
    expect(JSON.stringify(persona)).not.toContain("fg-1");
    expect(nudge).toHaveBeenCalledOnce();
  });
  it("does not deliver execution when report ownership could not persist", async () => {
    const { ctx } = fixture("workspace-1", true);
    await expect(dispatchExecutionBatch(ctx, input)).rejects.toThrow("task run insert failed");
    expect(nudge).not.toHaveBeenCalled();
  });
  it("tracks UI dispatch with owned task and a persisted producer carrier", async () => {
    const { ctx, rows } = fixture("workspace-1");
    await workItemsDispatch(ctx, { workItemId: "item-1", agentType: "codex" });
    expect(rows.find(row => row.table === taskRuns)?.value).toMatchObject({ sessionId: "session-1", workItemId: "item-1", planningWorkspaceId: "workspace-1", planningProvider: "linear" });
    expect(rows.find(row => row.table === chatConversations)?.value).toMatchObject({ personaMetadata: { metadata: { traceCarrier: carrier }, traceReportScope: { workItemId: "item-1", workspaceId: "workspace-1", issueId: "issue-1", forgeGraphWorkItemId: "fg-1" } } });
  });
});
