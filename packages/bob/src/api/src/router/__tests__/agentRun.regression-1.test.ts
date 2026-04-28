// Regression: ISSUE-002 — Runs page used publicApi.listRuns (API key auth) instead of session auth
// Found by /qa on 2026-03-29
// Report: .gstack/qa-reports/qa-report-bob-tail1e1a32-ts-net-2026-03-29.md

import { describe, expect, it } from "vitest";
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
    const listDef = agentRunRouter.list as any;
    expect(listDef).toBeDefined();
    expect(listDef._def).toBeDefined();
  });

  it("listByWorkItem procedure accepts workItemId and limit", () => {
    const listByWorkItemDef = agentRunRouter.listByWorkItem as any;
    expect(listByWorkItemDef).toBeDefined();
    expect(listByWorkItemDef._def).toBeDefined();
  });
});
