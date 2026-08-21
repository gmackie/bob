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

export const HermesActionScopeSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  actionClass: Schema.Literals([
    "capture.event",
    "research.job",
    "work.proposal",
    "fleet.dry-run",
    "automation.pause",
  ]),
  owner: Schema.Literals(["ooda", "bob", "skillfleet", "forgegraph"]),
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
}

export function assertHermesApproval(
  approvalInput: unknown,
  expectedScope: unknown,
  check: HermesApprovalCheck,
): HermesApproval {
  const approval = Schema.decodeUnknownSync(HermesApprovalSchema)(approvalInput, {
    errors: "all",
    onExcessProperty: "error",
  });
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
  if (approval.scopeDigest !== digestHermesActionScope(expectedScope)) {
    throw new Error("Hermes approval scope does not match the requested action");
  }
  return approval;
}
