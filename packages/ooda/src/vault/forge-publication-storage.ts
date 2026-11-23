/** Opt-in Forge publication composition; it never falls back to a local push. */
import { createHash, randomUUID } from "node:crypto";
import { acquireLock } from "./git";
import { PublicationJournal, assertOperationId } from "./publication-journal";
import { publicationInputDigest } from "./local-git-storage";
import {
  VersionedStorageError,
  type CapabilityManifest,
  type PublicationRecord,
  type PublishRequest,
  type RevisionRef,
  type RevisionSelector,
  type RemoteHeadResult,
  type VersionedStoragePort,
} from "./versioned-storage";
export interface ForgeVaultBinding {
  tenant: string;
  actor: string;
  artifact: string;
  generation: string;
  repositoryId: string;
}
export interface ForgeVaultPublication {
  key: string;
  ref: string;
  expected: string | null;
  revision: {
    tenant: string;
    artifact: string;
    generation: string;
    repositoryId: string;
    objectFormat: "sha1" | "sha256";
    oid: string;
    tree: string;
  };
}
/** Trusted host clients must authenticate the bound actor on every server call.
 * Preparation must transfer objects before publish; a bare revision ID is not an upload. */
export interface ForgeVaultClient {
  resolve(selector: RevisionSelector): Promise<RevisionRef>;
  commitWorkingTree(message: string): Promise<RevisionRef | null>;
  remoteHead(ref: string): Promise<RemoteHeadResult>;
  currentRef(): Promise<string>;
  publish(input: ForgeVaultPublication): Promise<{ outcome: string }>;
  recover(input: ForgeVaultPublication): Promise<{ outcome: string }>;
}
export class ForgePublicationStorage implements VersionedStoragePort {
  private readonly binding: Readonly<ForgeVaultBinding>;
  constructor(
    binding: ForgeVaultBinding,
    private readonly journal: PublicationJournal,
    private readonly client: ForgeVaultClient,
  ) {
    if (
      Object.values(binding).some(
        (x) => typeof x !== "string" || !x || /[\x00-\x1f\x7f]/.test(x),
      )
    )
      throw new VersionedStorageError(
        "NotAuthorized",
        "Invalid configured Forge vault binding",
      );
    this.binding = Object.freeze({ ...binding });
  }
  capabilities(): CapabilityManifest {
    return {
      provider: "forge",
      expectedHeadPublish: true,
      fullAncestry: false,
      fork: false,
      serverSideMerge: false,
      atomicMultiRef: false,
    };
  }
  resolve(selector: RevisionSelector) {
    return this.client.resolve({ ...selector });
  }
  commitWorkingTree(message: string) {
    return this.client.commitWorkingTree(message);
  }
  remoteHead(ref: string) {
    return this.client.remoteHead(ref);
  }
  currentRef() {
    return this.client.currentRef();
  }
  async lastObservedRemoteHead(ref: string) {
    const head = await this.remoteHead(ref);
    if (!head.reachable)
      throw new VersionedStorageError(
        "ProviderUnavailable",
        "Forge remote head is unavailable",
      );
    return head.head;
  }
  private digest(request: PublishRequest) {
    return createHash("sha256")
      .update(
        JSON.stringify([
          this.binding,
          publicationInputDigest(
            request.ref,
            request.expectedHead,
            request.revision,
          ),
        ]),
      )
      .digest("hex");
  }
  private input(record: PublicationRecord): ForgeVaultPublication {
    const { tenant, artifact, generation, repositoryId } = this.binding;
    const i = record.intent;
    return {
      key: i.operationId,
      ref: i.ref,
      expected: i.expectedHead,
      revision: {
        tenant,
        artifact,
        generation,
        repositoryId,
        objectFormat: i.revision.objectFormat,
        oid: i.revision.objectId,
        tree: i.revision.treeId,
      },
    };
  }
  private async invoke(record: PublicationRecord, recover: boolean) {
    const next: PublicationRecord = {
      ...record,
      attempts: record.attempts + 1,
      updatedAt: new Date().toISOString(),
    };
    try {
      const input = this.input(record);
      const reply = await (recover
        ? this.client.recover(input)
        : this.client.publish(input));
      if (reply.outcome === "accepted") {
        if (record.state === "published" && record.receipt) return record;
        next.state = "published";
        next.receipt = {
          operationId: record.intent.operationId,
          ref: record.intent.ref,
          previousHead: record.intent.expectedHead,
          newHead: record.intent.revision.objectId,
          publishedAt: next.updatedAt,
          verifiedBy: "push-response",
        };
      } else if (reply.outcome === "rejected") {
        next.state = "conflict";
      } else {
        next.state = "indeterminate";
        next.lastError =
          reply.outcome === "observed"
            ? "Desired head observed; request acceptance is not established"
            : "Forge publication outcome is unresolved";
      }
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "NotPermitted" || code === "Unauthenticated")
        throw new VersionedStorageError(
          "NotAuthorized",
          "Forge publication is not authorized",
        );
      if (code === "IdempotencyMismatch" || code === "VersionConflict")
        throw new VersionedStorageError(
          "IdempotencyMismatch",
          "Forge publication binding or intent changed",
        );
      next.state = "indeterminate";
      next.lastError = "Forge publication outcome is unresolved";
    }
    await this.journal.write(next);
    return next;
  }
  async publish(request: PublishRequest): Promise<PublicationRecord> {
    const req = { ...request, revision: { ...request.revision } },
      operationId = req.operationId ?? randomUUID();
    assertOperationId(operationId);
    const digest = this.digest(req),
      release = await acquireLock("forge-journal:" + this.journal.dir);
    try {
      const old = await this.journal.read(operationId);
      if (old) {
        if (old.intent.inputDigest !== digest)
          throw new VersionedStorageError(
            "IdempotencyMismatch",
            "Publication identity or intent changed",
          );
        return await this.invoke(old, true);
      }
      const now = new Date().toISOString();
      const record: PublicationRecord = {
        intent: {
          operationId,
          ref: req.ref,
          expectedHead: req.expectedHead,
          revision: req.revision,
          createdAt: now,
          inputDigest: digest,
        },
        state: "prepared",
        attempts: 0,
        leaseHead: req.expectedHead,
        updatedAt: now,
      };
      await this.journal.write(record);
      return await this.invoke(record, false);
    } finally {
      release();
    }
  }
  /** Unlike the local compatibility backend, this only reconciles remote receipts. */
  async replayPending() {
    const release = await acquireLock("forge-journal:" + this.journal.dir);
    try {
      const out: PublicationRecord[] = [];
      for (const record of await this.journal.list()) {
        if (record.state === "published" || record.state === "conflict")
          continue;
        if (
          record.intent.inputDigest !==
          this.digest({
            ref: record.intent.ref,
            expectedHead: record.intent.expectedHead,
            revision: record.intent.revision,
          })
        )
          throw new VersionedStorageError(
            "IdempotencyMismatch",
            "Publication binding changed",
          );
        out.push(await this.invoke(record, true));
      }
      return out;
    } finally {
      release();
    }
  }
  async listUnpublished() {
    return (await this.journal.list()).filter((r) => r.state !== "published");
  }
}
