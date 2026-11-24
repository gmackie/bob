import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@bob/api/handlers/workItems", () => ({
  BIZPULSE_CREDENTIAL_SETUP: "bizpulse-credential",
  workItemsList: vi.fn(async () => []),
  workItemsDispatch: vi.fn(async () => ({ sessionId: "s1", identifier: "B-1", status: "pending" })),
}));
vi.mock("@bob/api/handlers/publicApi", () => ({
  workspaceRunSummaries: vi.fn(async () => []),
}));
import { workspaceRunSummaries } from "@bob/api/handlers/publicApi";
import { workItemsDispatch } from "@bob/api/handlers/workItems";
import type { Db } from "@bob/db/client";
import { makePlanning, workspacePollSeconds } from "./planning";
import type { OAuthGrant } from "./types";

const workItemId = "aaaabbbb-1111-4000-8000-000000000002";
const grant: OAuthGrant = {
  id: "grant",
  clientId: "client",
  userId: "alice",
  workspaceId: "aaaabbbb-1111-4000-8000-000000000001",
  scopes: ["bob:read", "bob:write"],
  resource: "https://bob.example/mcp",
  expiresAt: new Date(Date.now() + 10_000),
  revokedAt: null,
};
const row = { id: workItemId, title: "Ship it", description: null, status: "todo", projectId: null, updatedAt: new Date() };

/** A db whose approval row and claim result the test sets; records every update's `set`. */
function fixture(approval: { dispatchedAt: Date | null } | undefined, claimed: unknown[]) {
  const sets: unknown[] = [];
  const db = {
    query: {
      workItems: { findFirst: vi.fn(async () => row) },
      mcpDispatchApprovals: { findFirst: vi.fn(async () => approval) },
    },
    update: () => ({
      set: (values: unknown) => {
        sets.push(values);
        return { where: () => Object.assign(Promise.resolve(), { returning: async () => claimed }) };
      },
    }),
  } as unknown as Db;
  return { planning: makePlanning(db), sets };
}

beforeEach(() => vi.stubEnv("BOB_OODA_DISPATCH_ENABLED", "true"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(workItemsDispatch).mockClear();
});

describe("planning review dispatch", () => {
  it("refuses an unapproved work item without spending anything", async () => {
    const { planning, sets } = fixture(undefined, []);
    await expect(planning.dispatch(grant, { workItemId })).rejects.toThrow("must be approved");
    expect(sets).toEqual([]);
    expect(workItemsDispatch).not.toHaveBeenCalled();
  });

  it("dispatches once per approval: a lost claim does not dispatch", async () => {
    const lost = fixture({ dispatchedAt: null }, []);
    await expect(lost.planning.dispatch(grant, { workItemId })).rejects.toThrow("already requested");
    expect(workItemsDispatch).not.toHaveBeenCalled();

    const won = fixture({ dispatchedAt: null }, [{ workItemId }]);
    await expect(won.planning.dispatch(grant, { workItemId, agentType: "codex" })).resolves.toMatchObject({ dispatched: { sessionId: "s1" } });
    expect(vi.mocked(workItemsDispatch).mock.calls[0]?.[1]).toEqual({ workItemId, agentType: "codex" });
  });

  it("keeps a spent approval when the review refresh fails after dispatch", async () => {
    vi.mocked(workspaceRunSummaries).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("refresh failed"));
    const { planning, sets } = fixture({ dispatchedAt: null }, [{ workItemId }]);
    await expect(planning.dispatch(grant, { workItemId })).rejects.toThrow("refresh failed");
    expect(workItemsDispatch).toHaveBeenCalledOnce();
    expect(sets).toEqual([{ dispatchedAt: expect.any(Date) }]);
  });

  it("gives the approval back when Bob refuses the dispatch", async () => {
    vi.mocked(workItemsDispatch).mockRejectedValueOnce(new Error("quota"));
    const { planning, sets } = fixture({ dispatchedAt: null }, [{ workItemId }]);
    await expect(planning.dispatch(grant, { workItemId })).rejects.toThrow();
    expect(sets).toEqual([{ dispatchedAt: expect.any(Date) }, { dispatchedAt: null }]);
  });

  it("stays off while API execution dispatch is disabled", async () => {
    vi.stubEnv("BOB_OODA_DISPATCH_ENABLED", "");
    const { planning, sets } = fixture({ dispatchedAt: null }, [{ workItemId }]);
    await expect(planning.dispatch(grant, { workItemId })).rejects.toThrow("disabled");
    expect(sets).toEqual([]);
  });
});

it("applies the plugin polling bounds on the service", () => {
  expect(["", "x", "0", "30.7", "10000"].map(workspacePollSeconds)).toEqual([60, 60, 15, 31, 3600]);
});
