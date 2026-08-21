import { describe, expect, it } from "vitest";

import {
  assertHermesApproval,
  assertHermesExecutionEnvelope,
  assertHermesExecutionReceipt,
  digestHermesActionScope,
  parseHermesActionEnvelope,
} from "../index.js";

describe("Hermes action contract", () => {
  it("accepts strict inspection and proposal envelopes with canonical evidence", () => {
    const scope = {
      schemaVersion: 1,
      actionClass: "work.proposal",
      owner: "bob",
      targetRef: "work-item:42",
      parametersDigest: `sha256:${"a".repeat(64)}`,
    } as const;
    const evidence = [
      {
        kind: "work_item",
        ref: "bob:work-item:42",
        observedAt: "2026-08-21T13:00:00Z",
      },
    ] as const;

    expect(
      parseHermesActionEnvelope({
        schemaVersion: 1,
        kind: "inspection",
        inspectionId: "inspection-42",
        owner: "bob",
        scope,
        observedAt: "2026-08-21T13:00:00Z",
        evidence,
      }),
    ).toMatchObject({ kind: "inspection", inspectionId: "inspection-42" });

    expect(
      parseHermesActionEnvelope({
        schemaVersion: 1,
        kind: "proposal",
        proposalId: "proposal-42",
        inspectionId: "inspection-42",
        owner: "bob",
        scope,
        scopeDigest: digestHermesActionScope(scope),
        summary: "Create one bounded work proposal.",
        proposedAt: "2026-08-21T13:01:00Z",
        expiresAt: "2026-08-21T13:16:00Z",
        evidence,
      }),
    ).toMatchObject({ kind: "proposal", proposalId: "proposal-42" });

    expect(() =>
      parseHermesActionEnvelope({
        schemaVersion: 1,
        kind: "inspection",
        inspectionId: "inspection-42",
        owner: "bob",
        scope,
        observedAt: "2026-08-21T13:00:00Z",
        evidence,
        transcript: "must never enter the envelope",
      }),
    ).toThrow();
  });

  it("rejects a proposal that changes owner, scope digest, or validity ordering", () => {
    const scope = {
      schemaVersion: 1,
      actionClass: "fleet.dry-run",
      owner: "skillfleet",
      targetRef: "machine:gmacko-mini",
      parametersDigest: `sha256:${"d".repeat(64)}`,
    } as const;
    const base = {
      schemaVersion: 1,
      kind: "proposal",
      proposalId: "proposal-fleet-1",
      inspectionId: "inspection-fleet-1",
      owner: "skillfleet",
      scope,
      scopeDigest: digestHermesActionScope(scope),
      summary: "Preview one bounded fleet reconciliation.",
      proposedAt: "2026-08-21T13:00:00Z",
      expiresAt: "2026-08-21T13:15:00Z",
      evidence: [
        {
          kind: "machine_observation",
          ref: "skillfleet:machine:gmacko-mini",
          observedAt: "2026-08-21T12:59:00Z",
        },
      ],
    } as const;

    expect(() => parseHermesActionEnvelope({ ...base, owner: "bob" })).toThrow(
      /owner/i,
    );
    expect(() =>
      parseHermesActionEnvelope({
        ...base,
        scopeDigest: `sha256:${"e".repeat(64)}`,
      }),
    ).toThrow(/scope/i);
    expect(() =>
      parseHermesActionEnvelope({
        ...base,
        expiresAt: base.proposedAt,
      }),
    ).toThrow(/expires/i);
  });

  it("binds execution and receipt to one proposal, approval, owner, scope, and idempotency key", () => {
    const scope = {
      schemaVersion: 1,
      actionClass: "research.job",
      owner: "ooda",
      targetRef: "research:42",
      parametersDigest: `sha256:${"f".repeat(64)}`,
    } as const;
    const proposal = parseHermesActionEnvelope({
      schemaVersion: 1,
      kind: "proposal",
      proposalId: "proposal-research-42",
      inspectionId: "inspection-research-42",
      owner: "ooda",
      scope,
      scopeDigest: digestHermesActionScope(scope),
      summary: "Start one bounded research job.",
      proposedAt: "2026-08-21T13:00:00Z",
      expiresAt: "2026-08-21T13:15:00Z",
      evidence: [
        {
          kind: "research_request",
          ref: "ooda:research:42",
          observedAt: "2026-08-21T12:59:00Z",
        },
      ],
    });
    if (proposal.kind !== "proposal") throw new Error("expected proposal");
    const approval = {
      schemaVersion: 1,
      approvalId: "approval-research-42",
      proposalId: proposal.proposalId,
      actorRef: "owner:primary",
      scopeDigest: proposal.scopeDigest,
      approvedAt: "2026-08-21T13:01:00Z",
      expiresAt: proposal.expiresAt,
    } as const;
    const execution = parseHermesActionEnvelope({
      schemaVersion: 1,
      kind: "execution",
      executionId: "execution-research-42",
      proposalId: proposal.proposalId,
      approvalId: approval.approvalId,
      owner: proposal.owner,
      scope: proposal.scope,
      scopeDigest: proposal.scopeDigest,
      idempotencyKey: "hermes:research:42",
      requestedAt: "2026-08-21T13:02:00Z",
      approvalExpiresAt: approval.expiresAt,
    });
    if (execution.kind !== "execution") throw new Error("expected execution");

    expect(
      assertHermesExecutionEnvelope(execution, proposal, approval, {
        now: new Date("2026-08-21T13:02:00Z"),
        consumedApprovalIds: new Set(),
      }),
    ).toEqual(execution);
    expect(() =>
      assertHermesExecutionEnvelope(
        { ...execution, requestedAt: "2026-08-21T13:00:00Z" },
        proposal,
        approval,
        {
          now: new Date("2026-08-21T13:02:00Z"),
          consumedApprovalIds: new Set(),
        },
      ),
    ).toThrow(/approval window/i);

    const receipt = parseHermesActionEnvelope({
      schemaVersion: 1,
      kind: "receipt",
      receiptId: "receipt-research-42",
      executionId: execution.executionId,
      proposalId: proposal.proposalId,
      approvalId: approval.approvalId,
      owner: proposal.owner,
      scopeDigest: proposal.scopeDigest,
      idempotencyKey: execution.idempotencyKey,
      outcome: "succeeded",
      executedAt: "2026-08-21T13:03:00Z",
      approvalExpiresAt: approval.expiresAt,
      evidence: [
        {
          kind: "research_job",
          ref: "ooda:research-job:42",
          observedAt: "2026-08-21T13:03:00Z",
        },
      ],
    });
    if (receipt.kind !== "receipt") throw new Error("expected receipt");

    expect(assertHermesExecutionReceipt(receipt, execution)).toEqual(receipt);
    expect(() =>
      assertHermesExecutionReceipt(
        { ...receipt, idempotencyKey: "hermes:research:other" },
        execution,
      ),
    ).toThrow(/idempotency/i);
  });

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
