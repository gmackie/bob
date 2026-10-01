import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";

import simpleGit, { type SimpleGit } from "simple-git";

import { PublicationJournal } from "./publication-journal";
import {
  REPLAYABLE_STATES,
  VersionedStorageError,
  type CapabilityManifest,
  type ObjectFormat,
  type PublicationRecord,
  type PublishRequest,
  type RemoteHeadResult,
  type RevisionRef,
  type RevisionSelector,
  type VersionedStoragePort,
} from "./versioned-storage";

export interface LocalGitStorageOptions {
  /** Remote name used for publication. Defaults to `origin`. */
  remote?: string;
  /** Committer identity set locally so merges never depend on host config. */
  identity?: { name: string; email: string };
}

const DEFAULT_IDENTITY = { name: "OODA", email: "ooda@local" };

const execFileAsync = promisify(execFile);

/**
 * Run git and report the exit code. simple-git's `raw` treats a non-zero
 * exit with empty stderr as success, which is exactly how predicates like
 * `merge-base --is-ancestor` and `cat-file -e` report "no". Those checks
 * must never be optimistic, so they bypass simple-git.
 */
async function gitExitCode(cwd: string, args: string[]): Promise<number> {
  try {
    await execFileAsync("git", args, { cwd });
    return 0;
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "number" ? code : 128;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function nowIso(): string {
  return new Date().toISOString();
}

export function publicationInputDigest(
  ref: string,
  expectedHead: string | null,
  revision: RevisionRef,
): string {
  return createHash("sha256")
    .update(`${ref}\0${expectedHead ?? ""}\0${revision.objectId}\0${revision.treeId}`)
    .digest("hex");
}

/**
 * Git-backed implementation of the versioned-storage port for a local clone
 * with a single publication remote.
 *
 * Expected-head publication is enforced at the authoritative ref update via
 * `git push --force-with-lease=<ref>:<expectedHead>`; the receiving
 * repository compares and swaps under its own ref lock. A process-local
 * mutex is not used here on purpose: callers hold the vault lock, and the
 * CAS is what protects against other writers reaching the remote.
 */
export class LocalGitStorage implements VersionedStoragePort {
  private readonly remote: string;
  private readonly identity: { name: string; email: string };
  private formatCache: ObjectFormat | undefined;
  private journalCache: PublicationJournal | undefined;

  constructor(
    readonly path: string,
    options: LocalGitStorageOptions = {},
  ) {
    this.remote = options.remote ?? "origin";
    this.identity = options.identity ?? DEFAULT_IDENTITY;
  }

  capabilities(): CapabilityManifest {
    return {
      provider: "local-git",
      expectedHeadPublish: true,
      fullAncestry: true,
      fork: false,
      serverSideMerge: false,
      atomicMultiRef: false,
    };
  }

  private git(): SimpleGit {
    return simpleGit(this.path);
  }

  private async journal(): Promise<PublicationJournal> {
    this.journalCache ??= await PublicationJournal.forRepo(this.path);
    return this.journalCache;
  }

  async objectFormat(): Promise<ObjectFormat> {
    if (!this.formatCache) {
      const out = (await this.git().revparse(["--show-object-format"])).trim();
      this.formatCache = out === "sha256" ? "sha256" : "sha1";
    }
    return this.formatCache;
  }

  /** Fully qualified ref the working tree is on, e.g. `refs/heads/main`. */
  async currentRef(): Promise<string> {
    try {
      return (await this.git().raw(["symbolic-ref", "-q", "HEAD"])).trim();
    } catch (err) {
      throw new VersionedStorageError(
        "NotReady",
        `HEAD is not on a branch at ${this.path}: ${errorMessage(err)}`,
      );
    }
  }

  /** Last head of `ref` this clone observed on the remote (tracking ref), or null. */
  async lastObservedRemoteHead(ref: string): Promise<string | null> {
    const short = ref.replace(/^refs\/heads\//, "");
    try {
      return (
        await this.git().revparse([`refs/remotes/${this.remote}/${short}`])
      ).trim();
    } catch {
      return null;
    }
  }

  async resolve(selector: RevisionSelector): Promise<RevisionRef> {
    const target = "ref" in selector ? selector.ref : selector.revision;
    try {
      const git = this.git();
      const objectId = (await git.revparse([`${target}^{commit}`])).trim();
      const treeId = (await git.revparse([`${objectId}^{tree}`])).trim();
      return { objectId, treeId, objectFormat: await this.objectFormat() };
    } catch (err) {
      throw new VersionedStorageError(
        "MissingRevision",
        `Cannot resolve ${target} at ${this.path}: ${errorMessage(err)}`,
        { selector },
      );
    }
  }

  async commitWorkingTree(message: string): Promise<RevisionRef | null> {
    const git = this.git();
    await git.addConfig("user.name", this.identity.name, true, "local");
    await git.addConfig("user.email", this.identity.email, true, "local");
    await git.add("-A");
    const status = await git.status();
    if (status.isClean()) return null;
    await git.commit(message);
    return this.resolve({ ref: "HEAD" });
  }

  async remoteHead(ref: string): Promise<RemoteHeadResult> {
    try {
      const out = await this.git().listRemote([this.remote, ref]);
      const line = out
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.endsWith(`\t${ref}`));
      return { reachable: true, head: line ? line.split("\t")[0]! : null };
    } catch (err) {
      return { reachable: false, error: errorMessage(err) };
    }
  }

  private async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    return (
      (await gitExitCode(this.path, [
        "merge-base",
        "--is-ancestor",
        ancestor,
        descendant,
      ])) === 0
    );
  }

  private async hasCommit(objectId: string): Promise<boolean> {
    return (
      (await gitExitCode(this.path, ["cat-file", "-e", `${objectId}^{commit}`])) === 0
    );
  }

  async publish(request: PublishRequest): Promise<PublicationRecord> {
    const operationId = request.operationId ?? randomUUID();
    const inputDigest = publicationInputDigest(
      request.ref,
      request.expectedHead,
      request.revision,
    );
    const journal = await this.journal();

    const existing = await journal.read(operationId);
    if (existing) {
      if (existing.intent.inputDigest !== inputDigest) {
        throw new VersionedStorageError(
          "IdempotencyMismatch",
          `operationId ${operationId} was already used with different inputs`,
          { operationId },
        );
      }
      if (!REPLAYABLE_STATES.has(existing.state)) return existing;
      return this.attempt(existing);
    }

    const record: PublicationRecord = {
      intent: {
        operationId,
        ref: request.ref,
        expectedHead: request.expectedHead,
        revision: request.revision,
        createdAt: nowIso(),
        inputDigest,
      },
      state: "prepared",
      attempts: 0,
      leaseHead: request.expectedHead,
      updatedAt: nowIso(),
    };
    await journal.write(record);
    return this.attempt(record);
  }

  async replayPending(): Promise<PublicationRecord[]> {
    const journal = await this.journal();
    const results: PublicationRecord[] = [];
    for (const record of await journal.list()) {
      if (!REPLAYABLE_STATES.has(record.state)) continue;
      results.push(await this.attempt(record));
    }
    return results;
  }

  async listUnpublished(): Promise<PublicationRecord[]> {
    const journal = await this.journal();
    return (await journal.list()).filter((r) => r.state !== "published");
  }

  // -------------------------------------------------------------------------
  // Publication protocol: prepared -> (push CAS) -> published | pending |
  // conflict | indeterminate. A lost response is resolved by inspecting the
  // remote, never by forcing.
  // -------------------------------------------------------------------------

  private async attempt(record: PublicationRecord): Promise<PublicationRecord> {
    const journal = await this.journal();
    const { ref, revision } = record.intent;
    const isReplay = record.attempts > 0;
    record.attempts += 1;

    if (!(await this.hasCommit(revision.objectId))) {
      throw new VersionedStorageError(
        "MissingRevision",
        `Revision ${revision.objectId} for operation ${record.intent.operationId} is not present locally`,
      );
    }

    let lease = record.leaseHead;
    let renewedLease = false;

    if (isReplay) {
      // An earlier attempt may have landed without us seeing the response.
      // Establish that from the remote before pushing again; a push of an
      // already-present revision would report "up to date" without ever
      // exercising the lease, which would misattribute the verification.
      const observed = await this.remoteHead(ref);
      if (observed.reachable && observed.head === revision.objectId) {
        return this.finish(journal, record, {
          state: "published",
          leaseHead: lease,
          observedRemoteHead: observed.head,
          receipt: {
            operationId: record.intent.operationId,
            ref,
            previousHead: lease,
            newHead: revision.objectId,
            publishedAt: nowIso(),
            verifiedBy: "remote-inspection",
          },
        });
      }
    }

    for (;;) {
      if (lease !== null && !(await this.isAncestor(lease, revision.objectId))) {
        return this.finish(journal, record, {
          state: "conflict",
          leaseHead: lease,
          lastError: `Revision ${revision.objectId} does not descend from expected head ${lease}`,
        });
      }

      try {
        await this.git().push([
          `--force-with-lease=${ref}:${lease ?? ""}`,
          this.remote,
          `${revision.objectId}:${ref}`,
        ]);
        return this.finish(journal, record, {
          state: "published",
          leaseHead: lease,
          receipt: {
            operationId: record.intent.operationId,
            ref,
            previousHead: lease,
            newHead: revision.objectId,
            publishedAt: nowIso(),
            verifiedBy: "push-response",
          },
        });
      } catch (pushErr) {
        const pushMessage = errorMessage(pushErr);
        let observed: RemoteHeadResult;
        try {
          observed = await this.remoteHead(ref);
        } catch (inspectErr) {
          return this.finish(journal, record, {
            state: "indeterminate",
            leaseHead: lease,
            lastError: `push failed (${pushMessage}); remote inspection failed (${errorMessage(inspectErr)})`,
          });
        }

        if (!observed.reachable) {
          return this.finish(journal, record, {
            state: "pending",
            leaseHead: lease,
            lastError: `remote unreachable: ${observed.error}`,
          });
        }

        const head = observed.head;
        if (head === revision.objectId) {
          // The transition landed even though we did not see the response.
          return this.finish(journal, record, {
            state: "published",
            leaseHead: lease,
            observedRemoteHead: head,
            receipt: {
              operationId: record.intent.operationId,
              ref,
              previousHead: lease,
              newHead: revision.objectId,
              publishedAt: nowIso(),
              verifiedBy: "remote-inspection",
            },
          });
        }

        if (head === lease) {
          return this.finish(journal, record, {
            state: "pending",
            leaseHead: lease,
            observedRemoteHead: head,
            lastError: `push rejected while remote head unchanged: ${pushMessage}`,
          });
        }

        if (
          head !== null &&
          record.intent.expectedHead !== null &&
          !renewedLease &&
          (await this.isAncestor(head, revision.objectId))
        ) {
          // The remote moved, but only to history we already contain
          // (e.g. an earlier replayed publication from this clone). Renew
          // the lease once and retry; nothing on the remote would be lost.
          // Never applied to a create intent: "ref must not exist" is a
          // stronger precondition than "ref is at X".
          lease = head;
          renewedLease = true;
          continue;
        }

        return this.finish(journal, record, {
          state: "conflict",
          leaseHead: lease,
          observedRemoteHead: head,
          lastError: `remote head ${head ?? "(absent)"} is not contained in ${revision.objectId}: ${pushMessage}`,
        });
      }
    }
  }

  private async finish(
    journal: PublicationJournal,
    record: PublicationRecord,
    patch: Partial<PublicationRecord> & { state: PublicationRecord["state"] },
  ): Promise<PublicationRecord> {
    Object.assign(record, patch, { updatedAt: nowIso() });
    if (record.state === "published") delete record.lastError;
    await journal.write(record);
    return record;
  }
}
