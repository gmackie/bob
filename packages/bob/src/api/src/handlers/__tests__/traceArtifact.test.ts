import { describe, expect, it, vi } from "vitest";

import type { HandlerContext } from "../context";
import { publicApiCreateArtifact } from "../publicApi";
const external = vi.hoisted(() => ({ recordTrace: vi.fn(), resolve: vi.fn(), kan: vi.fn() }));
vi.mock("../../services/forgegraph/config", () => ({ getForgeGraphClient: () => ({ recordTrace: external.recordTrace }) }));
vi.mock("../../services/forgegraph/idResolver", () => ({ resolveForgeGraphId: external.resolve }));

vi.mock("../../services/integrations/traceReport", () => ({ reportKanbangerTrace: external.kan }));

vi.mock("../../services/quotas/index.js", () => ({
  assertWithinQuotaOrThrow: vi.fn().mockResolvedValue(undefined),
}));

function fixture(authorized = true) {
  let artifact: Record<string, unknown> | undefined;
  const inserted: Record<string, unknown>[] = [];
  const tx = {
    select: () => ({
      from: () => ({ where: () => ({ for: () => Promise.resolve([]) }) }),
    }),
    query: { runArtifacts: { findFirst: () => Promise.resolve(artifact) } },
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        returning: () => {
          inserted.push(value);
          artifact = { id: "artifact-1", ...value };
          return Promise.resolve([artifact]);
        },
      }),
    }),
  };
  const db = {
    query: {
      workItems: { findFirst: vi.fn<() => Promise<unknown>>().mockResolvedValue({ id: "work-item-1", externalId: "kan-external-item" }) },
      workspaceIntegrations: { findFirst: vi.fn<() => Promise<unknown>>().mockResolvedValue({ apiKey: "lc_fixture", linearApiUrl: "https://tasks.gmac.io/graphql" }) },
      taskRuns: { findFirst: vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined) },
      agentRuns: {
        findFirst: vi.fn<() => Promise<unknown>>().mockResolvedValue({
          tenantId: "tenant-1",
          workspaceId: "workspace-1",
          workItemId: "work-item-1",
          sessionId: null,
        }),
      },
      tenantMembers: {
        findMany: () => Promise.resolve(authorized ? [{ tenantId: "tenant-1" }] : []),
      },
    },
    transaction: (fn: (value: unknown) => unknown) => fn(tx),
  };
  return { ctx: { db, userId: "user-1" } as unknown as HandlerContext, db, inserted };
}
const input = {
  runId: "run-1",
  type: "test-report" as const,
  storageKey: "untrusted",
  metadata: {
    kind: "trace_reference",
    traceId: "1".repeat(32),
    spanId: "2".repeat(16),
    sampled: true,
    workspaceId: "another-workspace",
    viewerUrl: "https://attacker.example",
    prompt: "private",
  },
};
describe("run trace artifact", () => {
  it("derives ownership and deduplicates retried trace references", async () => {
    const { ctx, inserted } = fixture();
    const first = await publicApiCreateArtifact(ctx, input);
    const second = await publicApiCreateArtifact(ctx, input);
    expect(second).toEqual(first);
    expect(inserted).toHaveLength(1);
    expect(first?.metadata).toMatchObject({
      workspaceId: "workspace-1",
      workItemId: "work-item-1",
      runId: "run-1",
      captureState: "pending",
    });
    expect(first?.metadata).not.toHaveProperty("viewerUrl");
    expect(first?.metadata).not.toHaveProperty("prompt");
  });
  it("retains the local reference when external reporting fails and retries on replay", async () => {
    external.resolve.mockResolvedValue("fg-owned-item");
    external.recordTrace.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
    const { ctx, db, inserted } = fixture();
    db.query.agentRuns.findFirst.mockResolvedValue({ tenantId: "tenant-1", workspaceId: "workspace-1", workItemId: "work-item-1", sessionId: "session-1", status: "completed" });
    db.query.taskRuns.findFirst.mockResolvedValue({ id: "task-run-1", sessionId: "session-1", planningProvider: "internal" });
    const first = await publicApiCreateArtifact(ctx, input);
    expect(first?.id).toBe("artifact-1");
    await publicApiCreateArtifact(ctx, input);
    expect(inserted).toHaveLength(1);
    expect(external.recordTrace).toHaveBeenCalledTimes(2);
    expect(external.recordTrace).toHaveBeenLastCalledWith("fg-owned-item", expect.objectContaining({ taskRunId: "task-run-1", attemptId: "2".repeat(16), outcome: "success", captureState: "pending", services: ["ooda-runner"] }));
  });
  it("reports the workspace-owned external item instead of the legacy local planning ID", async () => {
    external.kan.mockClear();
    const { ctx, db } = fixture();
    db.query.agentRuns.findFirst.mockResolvedValue({ tenantId: "tenant-1", workspaceId: "workspace-1", workItemId: "work-item-1", sessionId: "session-1", status: "completed" });
    db.query.taskRuns.findFirst.mockResolvedValue({ id: "task-run-1", sessionId: "session-1", planningProvider: "linear", planningItemId: "work-item-1" });
    await publicApiCreateArtifact(ctx, input);
    expect(external.kan).toHaveBeenCalledWith(expect.anything(), "kan-external-item", expect.objectContaining({ taskRunId: "task-run-1" }));
  });
  it("rejects a legacy run linked to a work item outside its workspace", async () => {
    external.kan.mockClear();
    const { ctx, db, inserted } = fixture();
    db.query.workItems.findFirst.mockResolvedValue(undefined);
    await expect(publicApiCreateArtifact(ctx, input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(inserted).toEqual([]);
    expect(db.query.taskRuns.findFirst).not.toHaveBeenCalled();
    expect(external.kan).not.toHaveBeenCalled();
  });
  it("rejects a non-member before storing the trace", async () => {
    const { ctx, inserted } = fixture(false);
    await expect(publicApiCreateArtifact(ctx, input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(inserted).toEqual([]);
  });
});
