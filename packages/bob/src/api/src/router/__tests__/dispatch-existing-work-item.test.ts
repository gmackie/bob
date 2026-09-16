import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter } from "../../trpc";
import type { createTRPCContext } from "../../trpc";
import { publicApiRouter } from "../publicApi";
import { workItemsDispatch } from "../../handlers/workItems";

vi.mock("../../handlers/workItems", () => ({ workItemsDispatch: vi.fn() }));
const router = createTRPCRouter({ publicApi: publicApiRouter });
function caller(permissions: string[] | null, db: unknown = {}) {
  return router.createCaller({ session: { user: { id: "user-1" } }, db, apiKeyAuth: permissions ? { keyId: "key-1", permissions, userId: "user-1" } : null } as unknown as Awaited<ReturnType<typeof createTRPCContext>>);
}
const input = { workItemId: "11111111-1111-4111-8111-111111111111", agentType: "codex" };
afterEach(() => { vi.unstubAllEnvs(); vi.mocked(workItemsDispatch).mockReset(); });
describe("API-key dispatch of an existing owned work item", () => {
  it.each([null, ["read"]])("rejects insufficient credentials before execution: %s", async (permissions) => {
    vi.stubEnv("BOB_OODA_DISPATCH_ENABLED", "true");
    await expect(caller(permissions).publicApi.dispatchExistingWorkItem(input)).rejects.toMatchObject({ code: permissions ? "FORBIDDEN" : "UNAUTHORIZED" });
    expect(workItemsDispatch).not.toHaveBeenCalled();
  });
  it("retains the unattended dispatch rollout gate", async () => {
    vi.stubEnv("BOB_OODA_DISPATCH_ENABLED", "false");
    await expect(caller(["write"]).publicApi.dispatchExistingWorkItem(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(workItemsDispatch).not.toHaveBeenCalled();
  });
  it("uses the normal handler and preserves its ownership denial", async () => {
    vi.stubEnv("BOB_OODA_DISPATCH_ENABLED", "true");
    vi.mocked(workItemsDispatch).mockRejectedValueOnce(new TRPCError({ code: "NOT_FOUND" }));
    await expect(caller(["write"]).publicApi.dispatchExistingWorkItem(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(workItemsDispatch).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1" }), input);
  });
});

describe("API-key report resource ownership", () => {
  const runId = "22222222-2222-4222-8222-222222222222";
  function resourceDb(member: boolean) {
    return { query: {
      agentRuns: { findFirst: vi.fn().mockResolvedValue({ id: runId, workspaceId: "workspace-1", artifacts: [] }) },
      workspaceMembers: { findFirst: vi.fn().mockResolvedValue(member ? { id: "membership-1" } : undefined) },
    } };
  }
  it("allows a read key to read a run in its user's workspace", async () => {
    await expect(caller(["read"], resourceDb(true)).publicApi.getRunTraceResource({ runId })).resolves.toMatchObject({ id: runId });
  });
  it("rejects a missing key before reading the run", async () => {
    const db = resourceDb(true);
    await expect(caller(null, db).publicApi.getRunTraceResource({ runId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(db.query.agentRuns.findFirst).not.toHaveBeenCalled();
  });
  it("denies a valid key whose user lacks workspace membership", async () => {
    await expect(caller(["read"], resourceDb(false)).publicApi.getRunTraceResource({ runId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
