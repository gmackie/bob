import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthInstance } from "@gmacko/core/auth";

vi.mock("@gmacko/ooda/db/client", () => ({ db: {} }));
import { t } from "../../trpc";
import { vaultRouter } from "../vault";
import { VaultRouteHost } from "../../../vault/vault-route-host";
import { VaultService } from "../../../vault/vault-service";
import { ForgePublicationStorage } from "../../../vault/forge-publication-storage";
import { PublicationJournal } from "../../../vault/publication-journal";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const revision = { objectId: "a".repeat(40), treeId: "b".repeat(40), objectFormat: "sha1" as const };
const createCaller = t.createCallerFactory(t.router({ vault: vaultRouter }));
function caller(host: VaultRouteHost, actor: string | null = "alice") {
  return createCaller({
    headers: new Headers(), db: {} as never, vaultHost: host,
    auth: { api: { getSession: async () => actor ? { user: { id: actor, email: "test@example.test" }, session: { id: "s" } } : null } } as unknown as AuthInstance,
  }).vault;
}
async function fixture(publish = async () => ({ outcome: "accepted" })) {
  const dir = await mkdtemp(join(tmpdir(), "bob-vault-route-"));
  directories.push(dir);
  const commit = vi.fn(async () => revision);
  const dispatch = vi.fn(publish);
  const storage = new ForgePublicationStorage(
    { tenant: "t", actor: "alice", artifact: "vault", generation: "one", repositoryId: "repo" },
    new PublicationJournal(join(dir, ".journal")),
    { currentRef: async () => "refs/heads/main", resolve: async () => revision,
      commitWorkingTree: commit, remoteHead: async () => ({ reachable: true, head: null }),
      publish: dispatch, recover: async () => ({ outcome: "observed" }) },
  );
  const service = new VaultService({ path: dir, name: "pilot", kind: "personal" }, storage);
  const host = new VaultRouteHost([{ actor: "alice", kind: "personal", service }]);
  // A configured host must take precedence over the legacy environment path.
  vi.stubEnv("PERSONAL_VAULT_PATH", "/nonexistent/legacy-vault-must-not-be-used");
  return { dir, commit, dispatch, host, api: caller(host) };
}

it("routes authenticated writes, promotions and reads through the selected Forge service", async () => {
  const f = await fixture();
  const result = await f.api.write({ vaultKind: "personal", filePath: "note.md", content: "hello" });
  expect(result.publication.state).toBe("published");
  expect(await readFile(join(f.dir, "note.md"), "utf8")).toContain("hello");
  expect((await f.api.read({ vaultKind: "personal", filePath: "note.md" })).content).toContain("hello");
  expect(await f.api.list({ vaultKind: "personal" })).toContain("note.md");
  const promoted = await f.api.promote({ vaultKind: "personal", threadId: "thread", noteId: "note", content: "promoted" });
  expect(promoted.publication.state).toBe("published");
  expect(await readFile(join(f.dir, "notes/thread/note.md"), "utf8")).toContain("promoted");
  expect(f.commit).toHaveBeenCalledTimes(2);
  expect(f.dispatch).toHaveBeenCalledTimes(2);
  await expect(f.api.sync({ vaultKind: "personal" })).rejects.toThrow("does not support local Git");
});

it("rejects anonymous and wrong-actor access before reads or filesystem mutations", async () => {
  const f = await fixture();
  for (const actor of [null, "mallory"]) {
    const api = caller(f.host, actor);
    for (const operation of [
      () => api.list({ vaultKind: "personal" }),
      () => api.read({ vaultKind: "personal", filePath: "note.md" }),
      () => api.health({ vaultKind: "personal" }),
      () => api.write({ vaultKind: "personal", filePath: "denied.md", content: "denied" }),
      () => api.promote({ vaultKind: "personal", threadId: "t", noteId: "n", content: "denied" }),
      () => api.sync({ vaultKind: "personal" }),
    ]) await expect(operation()).rejects.toMatchObject({ code: actor ? "FORBIDDEN" : "UNAUTHORIZED" });
  }
  await expect(f.api.list({ vaultKind: "research" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(readFile(join(f.dir, "denied.md"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(f.commit).not.toHaveBeenCalled();
});

it("preserves uncertain publication outcomes without a local fallback", async () => {
  const f = await fixture(async () => ({ outcome: "observed" }));
  expect((await f.api.write({ vaultKind: "personal", filePath: "note.md", content: "saved" })).publication.state).toBe("indeterminate");
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});

it("closes admissions immediately and drains a publication before generation replacement", async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const f = await fixture(async () => { entered(); await pending; return { outcome: "accepted" }; });
  const writing = f.api.write({ vaultKind: "personal", filePath: "active.md", content: "active" });
  await Promise.race([started, writing.then(() => { throw new Error("Publication was not held"); })]);
  let drained = false;
  const closing = f.host.closeAndDrain().then(() => { drained = true; });
  try {
    await expect(f.api.write({ vaultKind: "personal", filePath: "late.md", content: "late" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(drained).toBe(false);
    await expect(readFile(join(f.dir, "late.md"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { release(); }
  expect((await writing).publication.state).toBe("published");
  await closing;
  expect(drained).toBe(true);
  await f.host.closeAndDrain();
  await expect(f.api.promote({ vaultKind: "personal", threadId: "t", noteId: "stale", content: "late" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});

it("routes deletes and moves through the Forge service as published commits", async () => {
  const f = await fixture();
  await f.api.write({ vaultKind: "personal", filePath: "a.md", content: "alpha" });
  await f.api.write({ vaultKind: "personal", filePath: "keep.md", content: "keep" });
  const moved = await f.api.move({ vaultKind: "personal", from: "a.md", to: "dir/b.md" });
  expect(moved.publication.state).toBe("published");
  expect(await readFile(join(f.dir, "dir/b.md"), "utf8")).toContain("alpha");
  await expect(readFile(join(f.dir, "a.md"), "utf8")).rejects.toThrow();
  await expect(f.api.move({ vaultKind: "personal", from: "dir/b.md", to: "keep.md" }))
    .rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await readFile(join(f.dir, "keep.md"), "utf8")).toContain("keep");
  const removed = await f.api.delete({ vaultKind: "personal", filePath: "dir/b.md" });
  expect(removed.publication.state).toBe("published");
  await expect(f.api.delete({ vaultKind: "personal", filePath: "dir/b.md" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(f.api.delete({ vaultKind: "personal", filePath: "../escape.md" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(f.dispatch).toHaveBeenCalledTimes(4);
  await expect(caller(f.host, "mallory").delete({ vaultKind: "personal", filePath: "keep.md" }))
    .rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await readFile(join(f.dir, "keep.md"), "utf8")).toContain("keep");
});
