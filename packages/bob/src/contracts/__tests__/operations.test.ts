import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { OperationsRpc } from "../groups/operations.js";

describe("desktop operations contracts", () => {
  it("exposes all remaining control and collaboration procedures", () => {
    for (const tag of [
      "cockpit.status",
      "cockpit.stopSession",
      "cockpit.reviewPr",
      "agentAuth.start",
      "dispatchControl.set",
      "planning.session.listMessages",
      "planning.session.commitAsChecklist",
      "planning.skill.stats",
      "external.forgegraph.importAllApps",
    ]) {
      expect(OperationsRpc.requests.has(tag)).toBe(true);
    }
  });
  it("retains validation on host authentication and budget controls", () => {
    const auth = OperationsRpc.requests.get("agentAuth.start")!;
    expect(() =>
      Schema.decodeUnknownSync(auth.payloadSchema)({
        workspaceId: "wrong",
        provider: "arbitrary-command",
        requestId: "x",
      }),
    ).toThrow();
    const budget = OperationsRpc.requests.get("cockpit.setBudget")!;
    expect(() =>
      Schema.decodeUnknownSync(budget.payloadSchema)({ concurrency: 10000 }),
    ).toThrow();
  });
});

import { WorkItemRequirementListRpc } from "../groups/work-items.js";
import { ActivityRecordSchema } from "../schemas/work-item-sub.js";
import { PlanDraftRecordSchema } from "../schemas/planning-session.js";

describe("renderer response parity", () => {
  it("preserves grouped requirements and totals", () => {
    const value = { functional: { items: [], total: 0, done: 0 } };
    expect(
      Schema.decodeUnknownSync(WorkItemRequirementListRpc.successSchema)(value),
    ).toEqual(value);
  });
  it("preserves activity labels and unlinked agent results", () => {
    const value = {
      id: "a",
      workItemId: null,
      type: "agent_completed",
      createdAt: "2026-09-16",
      workItemTitle: "Result",
      workItemIdentifier: null,
    };
    expect(Schema.decodeUnknownSync(ActivityRecordSchema)(value)).toEqual(
      value,
    );
  });
  it("retains draft fields used by the graph and controls", () => {
    const value = {
      id: "d",
      sessionId: "s",
      workspaceId: "w",
      projectId: "p",
      title: "Draft",
      kind: "task",
      priority: "urgent",
      sortOrder: 0,
      status: "draft",
      createdAt: "2026-09-16",
    };
    expect(Schema.decodeUnknownSync(PlanDraftRecordSchema)(value)).toEqual(
      value,
    );
  });
});
