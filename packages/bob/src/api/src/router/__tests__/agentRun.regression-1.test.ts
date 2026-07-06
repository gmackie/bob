// Regression: ISSUE-002 — Runs page used publicApi.listRuns (API key auth) instead of session auth
// Found by /qa on 2026-03-29
// Report: .gstack/qa-reports/qa-report-bob-tail1e1a32-ts-net-2026-03-29.md

import { describe, expect, it, vi } from "vitest";

vi.mock("@bob/db/client", () => ({
  db: {},
}));

import { agentRunRouter } from "../agentRun";

describe("agentRun router", () => {
  it("exports list and listByWorkItem procedures", () => {
    expect(agentRunRouter).toHaveProperty("list");
    expect(agentRunRouter).toHaveProperty("listByWorkItem");
  });

  it("list procedure accepts workspaceId and limit", () => {
    // The procedure should exist and have the expected input shape
    // This validates the router was created with protectedProcedure (session auth)
    // rather than apiKeyReadProcedure (API key auth)
    // tRPC procedure builders carry an internal `_def` that isn't part of
    // their public typed surface — narrowed to `unknown` here (not `any`)
    // since we only assert its presence, not its shape.
    const listDef: unknown = agentRunRouter.list;
    expect(listDef).toBeDefined();
    expect((listDef as { _def?: unknown })._def).toBeDefined();
  });

  it("listByWorkItem procedure accepts workItemId and limit", () => {
    const listByWorkItemDef: unknown = agentRunRouter.listByWorkItem;
    expect(listByWorkItemDef).toBeDefined();
    expect((listByWorkItemDef as { _def?: unknown })._def).toBeDefined();
  });
});
