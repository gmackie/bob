import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ForgePublicationStorage } from "../forge-publication-storage";
import { PublicationJournal } from "../publication-journal";
const revision = {
  objectId: "a".repeat(40),
  treeId: "b".repeat(40),
  objectFormat: "sha1" as const,
};
const request = {
  operationId: "op",
  ref: "refs/heads/main",
  expectedHead: null,
  revision,
};
it("maps only authoritative acceptance to published and reconciles without resending", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-forge-"));
  try {
    let writes = 0,
      reads = 0;
    let outcome = "pending";
    const make = () =>
      new ForgePublicationStorage(
        {
          tenant: "t",
          actor: "alice",
          artifact: "vault",
          generation: "one",
          repositoryId: "repo",
        },
        new PublicationJournal(dir),
        {
          currentRef: async () => "refs/heads/main",
          resolve: async () => revision,
          commitWorkingTree: async () => revision,
          remoteHead: async () => ({
            reachable: true,
            head: revision.objectId,
          }),
          publish: async (input) => {
            writes++;
            expect(input.revision.repositoryId).toBe("repo");
            return { outcome };
          },
          recover: async () => {
            reads++;
            return { outcome };
          },
        },
      );
    expect((await make().publish(request)).state).toBe("indeterminate");
    outcome = "observed";
    expect((await make().replayPending())[0]?.state).toBe("indeterminate");
    expect(writes).toBe(1);
    expect(reads).toBe(1);
    outcome = "accepted";
    expect((await make().replayPending())[0]?.state).toBe("published");
    expect((await make().publish(request)).state).toBe("published");
    expect(writes).toBe(1);
    await expect(
      make().publish({ ...request, expectedHead: "c".repeat(40) }),
    ).rejects.toMatchObject({ code: "IdempotencyMismatch" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("does not turn provider errors into local-adapter writes or expose raw details", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-forge-"));
  try {
    const storage = new ForgePublicationStorage(
      {
        tenant: "t",
        actor: "alice",
        artifact: "vault",
        generation: "one",
        repositoryId: "repo",
      },
      new PublicationJournal(dir),
      {
        currentRef: async () => "refs/heads/main",
        resolve: async () => revision,
        commitWorkingTree: async () => revision,
        remoteHead: async () => ({ reachable: false, error: "redacted" }),
        publish: async () => {
          throw Error("private-token");
        },
        recover: async () => {
          throw Error("private-token");
        },
      },
    );
    const record = await storage.publish(request);
    expect(record.state).toBe("indeterminate");
    expect(JSON.stringify(record)).not.toContain("private-token");
    expect(await storage.listUnpublished()).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("reauthorizes terminal replay and fences a changed binding", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-forge-auth-"));
  try {
    let permitted = true;
    const binding = {
      tenant: "t",
      actor: "alice",
      artifact: "vault",
      generation: "one",
      repositoryId: "repo",
    };
    const client = {
      currentRef: async () => request.ref,
      resolve: async () => revision,
      commitWorkingTree: async () => revision,
      remoteHead: async () => ({ reachable: true as const, head: null }),
      publish: async () => ({ outcome: "accepted" }),
      recover: async () => {
        if (!permitted) throw { code: "NotPermitted" };
        return { outcome: "accepted" };
      },
    };
    const storage = new ForgePublicationStorage(
      binding,
      new PublicationJournal(dir),
      client,
    );
    await storage.publish(request);
    permitted = false;
    await expect(storage.publish(request)).rejects.toMatchObject({
      code: "NotAuthorized",
    });
    await expect(
      new ForgePublicationStorage(
        { ...binding, generation: "two" },
        new PublicationJournal(dir),
        client,
      ).publish(request),
    ).rejects.toMatchObject({ code: "IdempotencyMismatch" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("wires VaultService writes through the opted-in publication port", async () => {
  const { VaultService } = await import("../vault-service");
  const { readFile } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "bob-forge-service-"));
  try {
    let commits = 0,
      writes = 0;
    const storage = new ForgePublicationStorage(
      {
        tenant: "t",
        actor: "alice",
        artifact: "vault",
        generation: "one",
        repositoryId: "repo",
      },
      new PublicationJournal(join(dir, ".journal")),
      {
        currentRef: async () => request.ref,
        resolve: async () => revision,
        commitWorkingTree: async () => {
          commits++;
          return revision;
        },
        remoteHead: async () => ({ reachable: true, head: null }),
        publish: async () => {
          writes++;
          return { outcome: "accepted" };
        },
        recover: async () => ({ outcome: "accepted" }),
      },
    );
    const service = new VaultService(
      { path: dir, name: "pilot", kind: "personal" },
      storage,
    );
    expect((await service.write("notes/test.md", "body")).state).toBe(
      "published",
    );
    expect(await readFile(join(dir, "notes/test.md"), "utf8")).toBe("body");
    expect(commits).toBe(1);
    expect(writes).toBe(1);
    await expect(service.sync()).rejects.toMatchObject({code: "UnsupportedCapability"});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
