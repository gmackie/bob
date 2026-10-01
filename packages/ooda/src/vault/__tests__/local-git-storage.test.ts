import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import simpleGit from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalGitStorage } from "../local-git-storage";
import { PublicationJournal } from "../publication-journal";
import { VersionedStorageError } from "../versioned-storage";

// ---------------------------------------------------------------------------
// Fixture: bare remote + two independent clones so publications can compete
// ---------------------------------------------------------------------------

interface Fixture {
  base: string;
  bare: string;
  a: string;
  b: string;
}

const REF = "refs/heads/main";

async function clone(bare: string, dest: string): Promise<void> {
  await simpleGit().clone(bare, dest);
  const git = simpleGit(dest);
  await git.addConfig("user.name", "Test");
  await git.addConfig("user.email", "test@test.com");
}

async function commitFile(
  repo: string,
  name: string,
  content: string,
  message: string,
): Promise<string> {
  await writeFile(join(repo, name), content, "utf-8");
  const git = simpleGit(repo);
  await git.add(".");
  await git.commit(message);
  return (await git.revparse(["HEAD"])).trim();
}

async function remoteHead(bare: string): Promise<string> {
  return (await simpleGit(bare).revparse([REF])).trim();
}

async function createFixture(): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "versioned-storage-"));
  const bare = join(base, "bare.git");
  await simpleGit().init(true, [bare, "--initial-branch=main"]);

  const seed = join(base, "seed");
  await clone(bare, seed);
  await commitFile(seed, "README.md", "# Vault\n", "initial");
  await simpleGit(seed).push("origin", "main", ["--set-upstream"]);

  const a = join(base, "a");
  const b = join(base, "b");
  await clone(bare, a);
  await clone(bare, b);
  return { base, bare, a, b };
}

describe("LocalGitStorage", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await createFixture();
  });

  afterEach(async () => {
    await rm(fx.base, { recursive: true, force: true });
  });

  it("declares expected-head publication and full ancestry, not forks", () => {
    const caps = new LocalGitStorage(fx.a).capabilities();
    expect(caps).toMatchObject({
      provider: "local-git",
      expectedHeadPublish: true,
      fullAncestry: true,
      fork: false,
      serverSideMerge: false,
    });
  });

  it("resolves refs to exact revisions and rejects unknown ones", async () => {
    const storage = new LocalGitStorage(fx.a);
    const head = await storage.resolve({ ref: "HEAD" });
    expect(head.objectId).toMatch(/^[0-9a-f]{40}$/);
    expect(head.treeId).toMatch(/^[0-9a-f]{40}$/);
    expect(head.objectFormat).toBe("sha1");

    await expect(storage.resolve({ ref: "refs/heads/nope" })).rejects.toMatchObject({
      code: "MissingRevision",
    });
  });

  it("commitWorkingTree returns null when nothing changed", async () => {
    const storage = new LocalGitStorage(fx.a);
    expect(await storage.commitWorkingTree("noop")).toBeNull();
    await writeFile(join(fx.a, "x.md"), "x\n", "utf-8");
    const rev = await storage.commitWorkingTree("add x");
    expect(rev?.objectId).toBe((await simpleGit(fx.a).revparse(["HEAD"])).trim());
  });

  it("publishes under the expected head and records a receipt in the journal", async () => {
    const storage = new LocalGitStorage(fx.a);
    const expectedHead = await storage.lastObservedRemoteHead(REF);
    const revision = await storage.resolve({
      revision: await commitFile(fx.a, "a.md", "a\n", "from a"),
    });

    const record = await storage.publish({
      ref: REF,
      expectedHead,
      revision,
      operationId: "op-publish",
    });

    expect(record.state).toBe("published");
    expect(record.attempts).toBe(1);
    expect(record.receipt).toMatchObject({
      operationId: "op-publish",
      ref: REF,
      previousHead: expectedHead,
      newHead: revision.objectId,
      verifiedBy: "push-response",
    });
    expect(await remoteHead(fx.bare)).toBe(revision.objectId);

    const journal = await PublicationJournal.forRepo(fx.a);
    expect(journal.dir).toBe(join(fx.a, ".git", "ooda", "publications"));
    const stored = JSON.parse(
      await readFile(join(journal.dir, "op-publish.json"), "utf-8"),
    );
    expect(stored.state).toBe("published");
    expect(await storage.listUnpublished()).toEqual([]);
  });

  it("two competing publications yield exactly one accepted transition and one explicit conflict", async () => {
    const a = new LocalGitStorage(fx.a);
    const b = new LocalGitStorage(fx.b);
    const base = await a.lastObservedRemoteHead(REF);

    const revA = await a.resolve({ revision: await commitFile(fx.a, "a.md", "a\n", "from a") });
    const revB = await b.resolve({ revision: await commitFile(fx.b, "b.md", "b\n", "from b") });

    const first = await b.publish({ ref: REF, expectedHead: base, revision: revB });
    const second = await a.publish({ ref: REF, expectedHead: base, revision: revA });

    expect(first.state).toBe("published");
    expect(second.state).toBe("conflict");
    expect(second.observedRemoteHead).toBe(revB.objectId);
    expect(second.receipt).toBeUndefined();
    // No lost update, no silent force: the remote still has b's revision.
    expect(await remoteHead(fx.bare)).toBe(revB.objectId);
    expect((await a.listUnpublished()).map((r) => r.state)).toEqual(["conflict"]);

    // A replay must not retry a conflict on its own.
    expect(await a.replayPending()).toEqual([]);
  });

  it("marks a publication pending when the remote is unreachable and replays it later", async () => {
    const storage = new LocalGitStorage(fx.a);
    const expectedHead = await storage.lastObservedRemoteHead(REF);
    const revision = await storage.resolve({
      revision: await commitFile(fx.a, "offline.md", "o\n", "offline"),
    });

    const parked = `${fx.bare}.parked`;
    await rename(fx.bare, parked);
    const pending = await storage.publish({
      ref: REF,
      expectedHead,
      revision,
      operationId: "op-offline",
    });
    expect(pending.state).toBe("pending");
    expect(pending.lastError).toMatch(/unreachable/);

    await rename(parked, fx.bare);
    const replayed = await storage.replayPending();
    expect(replayed).toHaveLength(1);
    expect(replayed[0]!.state).toBe("published");
    expect(replayed[0]!.attempts).toBe(2);
    expect(await remoteHead(fx.bare)).toBe(revision.objectId);
  });

  it("replays a chain of offline publications in order, renewing the lease on fast-forward", async () => {
    const storage = new LocalGitStorage(fx.a);
    const base = await storage.lastObservedRemoteHead(REF);
    const parked = `${fx.bare}.parked`;
    await rename(fx.bare, parked);

    const rev1 = await storage.resolve({ revision: await commitFile(fx.a, "1.md", "1\n", "one") });
    const p1 = await storage.publish({ ref: REF, expectedHead: base, revision: rev1, operationId: "op-1" });
    const rev2 = await storage.resolve({ revision: await commitFile(fx.a, "2.md", "2\n", "two") });
    // The tracking ref never advanced, so the second intent's expected head is still `base`.
    const p2 = await storage.publish({ ref: REF, expectedHead: base, revision: rev2, operationId: "op-2" });
    expect([p1.state, p2.state]).toEqual(["pending", "pending"]);

    await rename(parked, fx.bare);
    const replayed = await storage.replayPending();
    expect(replayed.map((r) => [r.intent.operationId, r.state])).toEqual([
      ["op-1", "published"],
      ["op-2", "published"],
    ]);
    // op-2's intent is unchanged, but its effective lease was renewed to rev1.
    expect(replayed[1]!.intent.expectedHead).toBe(base);
    expect(replayed[1]!.leaseHead).toBe(rev1.objectId);
    expect(replayed[1]!.receipt?.previousHead).toBe(rev1.objectId);
    expect(await remoteHead(fx.bare)).toBe(rev2.objectId);
  });

  it("resolves a lost push response by inspecting the remote instead of forcing", async () => {
    const storage = new LocalGitStorage(fx.a);
    const expectedHead = await storage.lastObservedRemoteHead(REF);
    const revision = await storage.resolve({
      revision: await commitFile(fx.a, "lost.md", "l\n", "lost response"),
    });

    // Simulate: intent persisted, push landed, but the process died before
    // the outcome was recorded.
    const journal = await PublicationJournal.forRepo(fx.a);
    await journal.write({
      intent: {
        operationId: "op-lost",
        ref: REF,
        expectedHead,
        revision,
        createdAt: new Date().toISOString(),
        inputDigest: "ignored-by-replay",
      },
      state: "prepared",
      attempts: 1,
      leaseHead: expectedHead,
      updatedAt: new Date().toISOString(),
    });
    await simpleGit(fx.a).push(["origin", `${revision.objectId}:${REF}`]);

    const [replayed] = await storage.replayPending();
    expect(replayed!.state).toBe("published");
    expect(replayed!.receipt?.verifiedBy).toBe("remote-inspection");
    expect(await remoteHead(fx.bare)).toBe(revision.objectId);
  });

  it("rejects reusing an operationId with different inputs and is idempotent for identical ones", async () => {
    const storage = new LocalGitStorage(fx.a);
    const expectedHead = await storage.lastObservedRemoteHead(REF);
    const rev1 = await storage.resolve({ revision: await commitFile(fx.a, "i.md", "1\n", "i1") });

    const first = await storage.publish({ ref: REF, expectedHead, revision: rev1, operationId: "op-same" });
    expect(first.state).toBe("published");

    const again = await storage.publish({ ref: REF, expectedHead, revision: rev1, operationId: "op-same" });
    expect(again.attempts).toBe(1); // no second push
    expect(again.receipt).toEqual(first.receipt);

    const rev2 = await storage.resolve({ revision: await commitFile(fx.a, "i.md", "2\n", "i2") });
    await expect(
      storage.publish({ ref: REF, expectedHead, revision: rev2, operationId: "op-same" }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof VersionedStorageError && err.code === "IdempotencyMismatch",
    );
  });

  it("refuses a non-fast-forward publication before touching the remote", async () => {
    const storage = new LocalGitStorage(fx.a);
    const expectedHead = await storage.lastObservedRemoteHead(REF);
    // Orphan commit that does not descend from the remote head.
    const git = simpleGit(fx.a);
    await git.checkout(["--orphan", "rewrite"]);
    await writeFile(join(fx.a, "README.md"), "rewritten\n", "utf-8");
    await git.add(".");
    await git.commit("rewrite history");
    const orphan = await storage.resolve({ ref: "HEAD" });

    const record = await storage.publish({ ref: REF, expectedHead, revision: orphan });
    expect(record.state).toBe("conflict");
    expect(record.lastError).toMatch(/does not descend/);
    expect(await remoteHead(fx.bare)).toBe(expectedHead);
  });

  it("publishes a new ref when expectedHead is null and the ref is absent", async () => {
    const storage = new LocalGitStorage(fx.a);
    const revision = await storage.resolve({ ref: "HEAD" });
    const newRef = "refs/heads/feature";

    const record = await storage.publish({ ref: newRef, expectedHead: null, revision });
    expect(record.state).toBe("published");
    expect(record.receipt?.previousHead).toBeNull();

    // A second writer expecting the ref to be absent must now conflict.
    const b = new LocalGitStorage(fx.b);
    const revB = await b.resolve({ revision: await commitFile(fx.b, "b.md", "b\n", "b") });
    const clash = await b.publish({ ref: newRef, expectedHead: null, revision: revB });
    expect(clash.state).toBe("conflict");
    expect(clash.observedRemoteHead).toBe(revision.objectId);
  });

  it("reports the remote head without side effects", async () => {
    const storage = new LocalGitStorage(fx.a);
    const head = await storage.remoteHead(REF);
    expect(head).toEqual({ reachable: true, head: await remoteHead(fx.bare) });
    expect(await storage.remoteHead("refs/heads/missing")).toEqual({
      reachable: true,
      head: null,
    });
  });
});
