import { describe, expect, it } from "vitest";

import {
  assertHermesApproval,
  digestHermesActionScope,
} from "../index.js";

describe("Hermes action contract", () => {
  it("produces a stable scope digest independent of object key order", () => {
    const scope = {
      schemaVersion: 1,
      actionClass: "work.proposal",
      owner: "bob",
      targetRef: "work-item:42",
      parametersDigest: `sha256:${"b".repeat(64)}`,
    } as const;

    expect(digestHermesActionScope(scope)).toBe(
      digestHermesActionScope({
        targetRef: scope.targetRef,
        owner: scope.owner,
        parametersDigest: scope.parametersDigest,
        actionClass: scope.actionClass,
        schemaVersion: scope.schemaVersion,
      }),
    );
    expect(digestHermesActionScope(scope)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("accepts one live exact-scope approval and rejects expiry, replay, or escalation", () => {
    const scope = {
      schemaVersion: 1,
      actionClass: "capture.event",
      owner: "ooda",
      targetRef: "conversation:42",
      parametersDigest: `sha256:${"c".repeat(64)}`,
    } as const;
    const approval = {
      schemaVersion: 1,
      approvalId: "approval-42",
      proposalId: "proposal-42",
      actorRef: "owner:primary",
      scopeDigest: digestHermesActionScope(scope),
      approvedAt: "2026-08-21T13:00:00Z",
      expiresAt: "2026-08-21T13:15:00Z",
    } as const;

    expect(
      assertHermesApproval(approval, scope, {
        now: new Date("2026-08-21T13:05:00Z"),
        consumedApprovalIds: new Set(),
      }),
    ).toEqual(approval);
    expect(() =>
      assertHermesApproval(approval, scope, {
        now: new Date("2026-08-21T13:16:00Z"),
        consumedApprovalIds: new Set(),
      }),
    ).toThrow(/expired/i);
    expect(() =>
      assertHermesApproval(approval, scope, {
        now: new Date("2026-08-21T13:05:00Z"),
        consumedApprovalIds: new Set([approval.approvalId]),
      }),
    ).toThrow(/consumed/i);
    expect(() =>
      assertHermesApproval(
        approval,
        { ...scope, targetRef: "conversation:other" },
        {
          now: new Date("2026-08-21T13:05:00Z"),
          consumedApprovalIds: new Set(),
        },
      ),
    ).toThrow(/scope/i);
  });
});
