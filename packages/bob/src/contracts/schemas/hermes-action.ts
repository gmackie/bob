import { createHash } from "node:crypto";

import { Schema } from "effect";

const IdentifierSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(256)),
);

const Sha256DigestSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
);

const TimestampSchema = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
    ),
  ),
);

const HermesOwnerSchema = Schema.Literals([
  "ooda",
  "bob",
  "skillfleet",
  "forgegraph",
]);

export const HermesCanonicalEvidenceSchema = Schema.Struct({
  kind: IdentifierSchema,
  ref: IdentifierSchema,
  observedAt: TimestampSchema,
});

export type HermesCanonicalEvidence = typeof HermesCanonicalEvidenceSchema.Type;

const HermesEvidenceSchema = Schema.Array(HermesCanonicalEvidenceSchema).pipe(
  Schema.check(Schema.isMinLength(1)),
);

export const HermesActionScopeSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  actionClass: Schema.Literals([
    "capture.event",
    "research.job",
    "work.proposal",
    "fleet.dry-run",
    "automation.pause",
  ]),
  owner: HermesOwnerSchema,
  targetRef: IdentifierSchema,
  parametersDigest: Sha256DigestSchema,
});

export type HermesActionScope = typeof HermesActionScopeSchema.Type;

export const HermesApprovalSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  approvalId: IdentifierSchema,
  proposalId: IdentifierSchema,
  actorRef: IdentifierSchema,
  scopeDigest: Sha256DigestSchema,
  approvedAt: TimestampSchema,
  expiresAt: TimestampSchema,
});

export type HermesApproval = typeof HermesApprovalSchema.Type;

export const HermesInspectionEnvelopeSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("inspection"),
  inspectionId: IdentifierSchema,
  owner: HermesOwnerSchema,
  scope: HermesActionScopeSchema,
  observedAt: TimestampSchema,
  evidence: HermesEvidenceSchema,
});

export type HermesInspectionEnvelope =
  typeof HermesInspectionEnvelopeSchema.Type;

export const HermesProposalEnvelopeSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("proposal"),
  proposalId: IdentifierSchema,
  inspectionId: IdentifierSchema,
  owner: HermesOwnerSchema,
  scope: HermesActionScopeSchema,
  scopeDigest: Sha256DigestSchema,
  summary: IdentifierSchema,
  proposedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  evidence: HermesEvidenceSchema,
});

export type HermesProposalEnvelope = typeof HermesProposalEnvelopeSchema.Type;

export const HermesExecutionEnvelopeSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("execution"),
  executionId: IdentifierSchema,
  proposalId: IdentifierSchema,
  approvalId: IdentifierSchema,
  owner: HermesOwnerSchema,
  scope: HermesActionScopeSchema,
  scopeDigest: Sha256DigestSchema,
  idempotencyKey: IdentifierSchema,
  requestedAt: TimestampSchema,
  approvalExpiresAt: TimestampSchema,
});

export type HermesExecutionEnvelope = typeof HermesExecutionEnvelopeSchema.Type;

export const HermesExecutionReceiptSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("receipt"),
  receiptId: IdentifierSchema,
  executionId: IdentifierSchema,
  proposalId: IdentifierSchema,
  approvalId: IdentifierSchema,
  owner: HermesOwnerSchema,
  scopeDigest: Sha256DigestSchema,
  idempotencyKey: IdentifierSchema,
  outcome: Schema.Literals(["succeeded", "prevented", "failed"]),
  executedAt: TimestampSchema,
  approvalExpiresAt: TimestampSchema,
  evidence: HermesEvidenceSchema,
});

export type HermesExecutionReceipt = typeof HermesExecutionReceiptSchema.Type;

export const HermesActionEnvelopeSchema = Schema.Union([
  HermesInspectionEnvelopeSchema,
  HermesProposalEnvelopeSchema,
  HermesExecutionEnvelopeSchema,
  HermesExecutionReceiptSchema,
]);

export type HermesActionEnvelope = typeof HermesActionEnvelopeSchema.Type;

export function parseHermesActionEnvelope(
  input: unknown,
): HermesActionEnvelope {
  const envelope = Schema.decodeUnknownSync(HermesActionEnvelopeSchema)(input, {
    errors: "all",
    onExcessProperty: "error",
  });
  if (envelope.kind !== "receipt" && envelope.owner !== envelope.scope.owner) {
    throw new Error(
      "Hermes envelope owner does not match the action scope owner",
    );
  }
  if (envelope.kind === "proposal") {
    if (envelope.scopeDigest !== digestHermesActionScope(envelope.scope)) {
      throw new Error(
        "Hermes proposal scope digest does not match its action scope",
      );
    }
    const proposedAt = Date.parse(envelope.proposedAt);
    const expiresAt = Date.parse(envelope.expiresAt);
    if (!Number.isFinite(proposedAt) || !Number.isFinite(expiresAt)) {
      throw new Error("Hermes proposal contains an invalid timestamp");
    }
    if (expiresAt <= proposedAt) {
      throw new Error("Hermes proposal expires before it becomes active");
    }
  }
  if (
    envelope.kind === "execution" &&
    envelope.scopeDigest !== digestHermesActionScope(envelope.scope)
  ) {
    throw new Error(
      "Hermes execution scope digest does not match its action scope",
    );
  }
  return envelope;
}

export function assertHermesExecutionEnvelope(
  executionInput: unknown,
  proposalInput: unknown,
  approvalInput: unknown,
  check: HermesApprovalCheck,
): HermesExecutionEnvelope {
  const execution = parseHermesActionEnvelope(executionInput);
  const proposal = parseHermesActionEnvelope(proposalInput);
  if (execution.kind !== "execution" || proposal.kind !== "proposal") {
    throw new Error(
      "Hermes execution requires execution and proposal envelopes",
    );
  }
  const approval = assertHermesApproval(approvalInput, proposal.scope, check);
  if (
    execution.proposalId !== proposal.proposalId ||
    approval.proposalId !== proposal.proposalId
  ) {
    throw new Error("Hermes execution proposal does not match its approval");
  }
  if (execution.approvalId !== approval.approvalId) {
    throw new Error("Hermes execution approval ID does not match");
  }
  if (execution.owner !== proposal.owner) {
    throw new Error("Hermes execution owner does not match its proposal");
  }
  if (
    execution.scopeDigest !== proposal.scopeDigest ||
    approval.scopeDigest !== proposal.scopeDigest
  ) {
    throw new Error(
      "Hermes execution scope does not match its proposal and approval",
    );
  }
  if (execution.approvalExpiresAt !== approval.expiresAt) {
    throw new Error("Hermes execution approval expiry does not match");
  }
  const requestedAt = Date.parse(execution.requestedAt);
  const proposalExpiresAt = Date.parse(proposal.expiresAt);
  if (Date.parse(approval.expiresAt) > proposalExpiresAt) {
    throw new Error("Hermes approval extends beyond the proposal expiry");
  }
  if (requestedAt >= proposalExpiresAt) {
    throw new Error("Hermes proposal expired before execution was requested");
  }
  if (
    !Number.isFinite(requestedAt) ||
    requestedAt < Date.parse(approval.approvedAt) ||
    requestedAt >= Date.parse(approval.expiresAt)
  ) {
    throw new Error("Hermes execution request is outside the approval window");
  }
  return execution;
}

export function assertHermesExecutionReceipt(
  receiptInput: unknown,
  executionInput: unknown,
): HermesExecutionReceipt {
  const receipt = parseHermesActionEnvelope(receiptInput);
  const execution = parseHermesActionEnvelope(executionInput);
  if (receipt.kind !== "receipt" || execution.kind !== "execution") {
    throw new Error(
      "Hermes receipt validation requires receipt and execution envelopes",
    );
  }
  const bindings = [
    ["execution", receipt.executionId, execution.executionId],
    ["proposal", receipt.proposalId, execution.proposalId],
    ["approval", receipt.approvalId, execution.approvalId],
    ["owner", receipt.owner, execution.owner],
    ["scope", receipt.scopeDigest, execution.scopeDigest],
    ["idempotency", receipt.idempotencyKey, execution.idempotencyKey],
    ["approval expiry", receipt.approvalExpiresAt, execution.approvalExpiresAt],
  ] as const;
  for (const [name, actual, expected] of bindings) {
    if (actual !== expected) {
      throw new Error(
        `Hermes receipt ${name} binding does not match execution`,
      );
    }
  }
  const executedAt = Date.parse(receipt.executedAt);
  if (
    !Number.isFinite(executedAt) ||
    executedAt < Date.parse(execution.requestedAt) ||
    executedAt >= Date.parse(receipt.approvalExpiresAt)
  ) {
    throw new Error(
      "Hermes receipt execution timestamp is outside the approval window",
    );
  }
  return receipt;
}

export function digestHermesActionScope(input: unknown): string {
  const scope = Schema.decodeUnknownSync(HermesActionScopeSchema)(input, {
    errors: "all",
    onExcessProperty: "error",
  });
  const canonical = JSON.stringify([
    scope.schemaVersion,
    scope.actionClass,
    scope.owner,
    scope.targetRef,
    scope.parametersDigest,
  ]);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export interface HermesApprovalCheck {
  readonly now: Date;
  readonly consumedApprovalIds: ReadonlySet<string>;
  readonly expectedActorRef: string;
}

export function assertHermesApproval(
  approvalInput: unknown,
  expectedScope: unknown,
  check: HermesApprovalCheck,
): HermesApproval {
  const approval = Schema.decodeUnknownSync(HermesApprovalSchema)(
    approvalInput,
    {
      errors: "all",
      onExcessProperty: "error",
    },
  );
  const approvedAt = Date.parse(approval.approvedAt);
  const expiresAt = Date.parse(approval.expiresAt);
  if (!Number.isFinite(approvedAt) || !Number.isFinite(expiresAt)) {
    throw new Error("Hermes approval contains an invalid timestamp");
  }
  if (approvedAt > check.now.getTime()) {
    throw new Error("Hermes approval is not active yet");
  }
  if (expiresAt <= check.now.getTime() || expiresAt <= approvedAt) {
    throw new Error("Hermes approval is expired");
  }
  if (check.consumedApprovalIds.has(approval.approvalId)) {
    throw new Error("Hermes approval has already been consumed");
  }
  if (approval.actorRef !== check.expectedActorRef) {
    throw new Error("Hermes approval actor does not match the authenticated actor");
  }
  if (approval.scopeDigest !== digestHermesActionScope(expectedScope)) {
    throw new Error(
      "Hermes approval scope does not match the requested action",
    );
  }
  return approval;
}
