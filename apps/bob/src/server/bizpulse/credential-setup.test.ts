import type { Db } from "@bob/db/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { credentialSetupRequest, makeCredentialSetup } from "./credential-setup";

const { getPlan, dispatch } = vi.hoisted(() => ({
  getPlan: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("./client", () => ({
  bizpulseConfig: () => ({ origin: "https://bizpulse.example" }),
  useClient: async (_config: unknown, _token: unknown, run: (client: unknown) => unknown) =>
    run({ callTool: getPlan }),
}));
vi.mock("./link", () => ({ bizPulseAccess: async () => "fixture-token" }));
vi.mock("@bob/api/handlers/workItems", () => ({
  BIZPULSE_CREDENTIAL_SETUP: "bizpulse-credential",
  workItemsDispatch: dispatch,
}));

const actor = { workspaceId: "5247aa66-11c8-44cf-adc5-85105e1a556c", userId: "owner" };
const workspaceId = "9eb6e97a-49e9-4aa1-98d0-0c07224ad94b";
const workItemId = "fca59397-f7e6-44db-9b9b-1b2226bd5efa";
const planId = "cc5848a8-9059-4088-97f8-91914721983a";
const startupId = "3efc9953-f59d-4b97-aaa0-3dbcc1a07061";
const digest = "0".repeat(64);
const input = credentialSetupRequest.parse({
  operationKey: `bizpulse:${workspaceId}:${planId}`,
  planId,
  startupId,
  environment: "staging",
  destinations: [{ app: "demo", stage: "staging", key: "DEMO_TOKEN" }],
});
const plan = {
  id: planId,
  workspaceId,
  startupId,
  digest,
  approvedDigest: digest,
  approvedBy: "owner",
  approvalExpiresAt: "2099-01-01T00:00:00.000Z",
  status: "approved",
  spec: {
    environment: "staging",
    steps: [{ type: "deliver", app: "demo", stage: "staging", variable: "DEMO_TOKEN" }],
  },
};
const remotePlan = (record: typeof plan) => ({
  content: [{ type: "text", text: JSON.stringify(record) }],
});

function fixture() {
  let item: { id: string; sourceMetadata: unknown } | undefined;
  let approval: { dispatchedAt: Date } | undefined;
  const insert = vi.fn(() => ({
    values: (row: { sourceMetadata?: unknown; dispatchedAt?: Date }) => ({
      onConflictDoNothing: () => {
        if (row.sourceMetadata) {
          item ??= { id: workItemId, sourceMetadata: row.sourceMetadata };
          return Promise.resolve();
        }
        return {
          returning: () => {
            if (approval || !row.dispatchedAt) return [];
            approval = { dispatchedAt: row.dispatchedAt };
            return [{ workItemId }];
          },
        };
      },
    }),
  }));
  const db = {
    insert,
    query: {
      workItems: { findFirst: async () => item },
      mcpDispatchApprovals: { findFirst: async () => approval },
      taskRuns: {
        findFirst: async () => ({ id: "run-fixture", status: "running" }),
      },
    },
  } as unknown as Db;
  return { insert, setup: makeCredentialSetup(db) };
}

describe("BizPulse credential setup handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlan.mockResolvedValue(remotePlan(plan));
  });

  it("returns one draft for concurrent and repeated requests without dispatching", async () => {
    const { setup } = fixture();
    const results = await Promise.all([setup.request(actor, input), setup.request(actor, input)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ workItemId, dispatchApproval: "required", ownerAction: "approve_dispatch" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects a different destination, unapproved plan, and denied startup before writing", async () => {
    const { setup, insert } = fixture();
    await expect(setup.request(actor, { ...input, destinations: [{ app: "other", stage: "staging", key: "DEMO_TOKEN" }] })).rejects.toThrow("Destinations");
    getPlan.mockResolvedValueOnce(remotePlan({ ...plan, status: "proposed" }));
    await expect(setup.request(actor, input)).rejects.toThrow("Approve");
    getPlan.mockResolvedValueOnce({ isError: true, content: [] });
    await expect(setup.request(actor, input)).rejects.toThrow("startup scope");
    expect(insert).not.toHaveBeenCalled();
  });

  it("checks the plan again before owner dispatch and reports the exact run once", async () => {
    const { setup } = fixture();
    await setup.request(actor, input);
    const changed = "1".repeat(64);
    getPlan.mockResolvedValueOnce(remotePlan({ ...plan, digest: changed, approvedDigest: changed }));
    await expect(setup.approveAndDispatch(actor, workItemId)).rejects.toThrow("current BizPulse plan");
    await setup.approveAndDispatch(actor, workItemId);
    await expect(setup.approveAndDispatch(actor, workItemId)).rejects.toThrow("already requested");
    expect(dispatch).toHaveBeenCalledOnce();
    await expect(setup.status(actor, workItemId, input.operationKey)).resolves.toMatchObject({
      dispatchApproval: "dispatched",
      credentialApproval: "required",
      runId: "run-fixture",
    });
  });
});
