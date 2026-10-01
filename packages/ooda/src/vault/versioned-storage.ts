/**
 * Versioned-storage port for the vault boundary.
 *
 * This is the first implementation seam of the "versioned artifacts"
 * primitive described in docs/plans/2026-10-01-bob-forge-versioned-artifacts.html.
 * It deliberately covers only what the vault needs today: resolving exact
 * revisions, committing a working tree, and publishing a revision to a
 * mutable ref under an expected-head precondition with a durable, replayable
 * publication record.
 *
 * Vocabulary follows the plan: a local commit is "saved locally"; a push
 * whose outcome is unknown is "indeterminate"; only an accepted expected-head
 * transition that was observed (push response or remote inspection) counts
 * as "published". No caller may report success for anything else.
 */

export type ObjectFormat = "sha1" | "sha256";

/** Immutable reference to an exact revision of a versioned tree. */
export interface RevisionRef {
  /** Provider object id. For Git this is the commit OID. */
  objectId: string;
  objectFormat: ObjectFormat;
  /** Content/tree digest at the revision (Git tree OID). */
  treeId: string;
}

export type VersionedStorageErrorCode =
  | "RefConflict"
  | "IdempotencyMismatch"
  | "NotAuthorized"
  | "UnsupportedCapability"
  | "NotReady"
  | "MissingRevision"
  | "BudgetExceeded"
  | "ProviderUnavailable"
  | "IndeterminatePublication";

export class VersionedStorageError extends Error {
  readonly code: VersionedStorageErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: VersionedStorageErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "VersionedStorageError";
    this.code = code;
    this.details = details;
  }
}

/**
 * What a provider can actually guarantee. Callers must consult this before
 * relying on a semantic; unsupported operations fail before side effects.
 */
export interface CapabilityManifest {
  provider: string;
  /** Ref updates are compare-and-swapped against an expected old head. */
  expectedHeadPublish: boolean;
  /** Full parent DAG is available, not only a first-parent listing. */
  fullAncestry: boolean;
  fork: boolean;
  serverSideMerge: boolean;
  atomicMultiRef: boolean;
}

/** Durable description of a requested publication, written before any push. */
export interface PublicationIntent {
  operationId: string;
  /** Fully qualified ref, e.g. `refs/heads/main`. */
  ref: string;
  /** Expected current remote head; `null` means the ref must not exist yet. */
  expectedHead: string | null;
  revision: RevisionRef;
  createdAt: string;
  /** Digest of (ref, expectedHead, revision). A retry with a different digest is rejected. */
  inputDigest: string;
}

export type PublicationState =
  /** Intent persisted; no push attempted or outcome not yet recorded. */
  | "prepared"
  /** Remote accepted the expected-head transition and that was verified. */
  | "published"
  /** Remote unreachable or rejected for a retryable reason; safe to replay. */
  | "pending"
  /** Remote head moved to a revision we do not contain. Needs reconciliation. */
  | "conflict"
  /** Outcome could not be established from evidence. Do not force. */
  | "indeterminate";

export interface PublicationReceipt {
  operationId: string;
  ref: string;
  previousHead: string | null;
  newHead: string;
  publishedAt: string;
  verifiedBy: "push-response" | "remote-inspection";
}

export interface PublicationRecord {
  intent: PublicationIntent;
  state: PublicationState;
  attempts: number;
  /**
   * The head actually used as the compare-and-swap lease on the last attempt.
   * Differs from `intent.expectedHead` only when the remote advanced to an
   * ancestor of our revision (a pure fast-forward) and the lease was renewed.
   */
  leaseHead: string | null;
  observedRemoteHead?: string | null;
  lastError?: string;
  receipt?: PublicationReceipt;
  updatedAt: string;
}

export interface PublishRequest {
  ref: string;
  expectedHead: string | null;
  revision: RevisionRef;
  /** Stable id for retries. Generated when omitted. */
  operationId?: string;
}

export type RemoteHeadResult =
  | { reachable: true; head: string | null }
  | { reachable: false; error: string };

export type RevisionSelector = { ref: string } | { revision: string };

export interface VersionedStoragePort {
  capabilities(): CapabilityManifest;
  /** Resolve a ref or object id to an exact revision. Throws MissingRevision. */
  resolve(selector: RevisionSelector): Promise<RevisionRef>;
  /** Commit all working-tree changes. Returns `null` when there is nothing to commit. */
  commitWorkingTree(message: string): Promise<RevisionRef | null>;
  /** Inspect the remote's current head for a ref without changing anything. */
  remoteHead(ref: string): Promise<RemoteHeadResult>;
  /** Publish a revision to a ref under an expected-head precondition. Never throws for remote outcomes. */
  publish(request: PublishRequest): Promise<PublicationRecord>;
  /** Re-attempt every non-final publication record, oldest first. */
  replayPending(): Promise<PublicationRecord[]>;
  /** Non-final publication records (prepared, pending, indeterminate, conflict). */
  listUnpublished(): Promise<PublicationRecord[]>;
}

export function isDurablyPublished(record: PublicationRecord): boolean {
  return record.state === "published" && record.receipt !== undefined;
}

/** States that a replay may legitimately re-attempt. Conflicts need a human or a merge first. */
export const REPLAYABLE_STATES: ReadonlySet<PublicationState> = new Set([
  "prepared",
  "pending",
  "indeterminate",
]);
