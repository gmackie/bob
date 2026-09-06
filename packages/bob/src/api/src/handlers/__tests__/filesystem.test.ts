import type { Effect as EffectType } from "effect";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { HandlerContext } from "../context";
import {
  filesystemCopy,
  filesystemMove,
  filesystemGitStatus,
  filesystemList,
  filesystemRead,
  filesystemSearch,
  filesystemWrite,
} from "../filesystem";

const roots: string[] = [];
const ctx = { db: {}, userId: "user-1", filesystem: { kind: "local-operator", userId: "user-1", roots } } as unknown as HandlerContext;

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "bob-filesystem-")));
  tempDirs.push(dir);
  roots.push(dir);
  return dir;
}

afterEach(() => {
  roots.length = 0;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("filesystem handlers", () => {
  it("does not let git status discover a repository above the granted root", async () => {
    const root = makeTempDir();
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
    const child = path.join(root, "bounded");
    await filesystemWrite(ctx, { path: path.join(child, "file"), content: "local" });
    const bounded = { ...ctx, filesystem: { kind: "local-operator" as const, userId: ctx.userId, roots: [child] } };
    await expect(filesystemGitStatus(bounded, { path: child })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not follow nested links while listing, searching, copying, or moving trees", async () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    const local = { ...ctx, filesystem: { kind: "local-operator" as const, userId: ctx.userId, roots: [root] } };
    writeFileSync(path.join(outside, "private.txt"), "needle private");
    symlinkSync(outside, path.join(root, "escape"), "dir");
    await expect(filesystemSearch(local, { path: root, pattern: "needle" })).resolves.toEqual([]);
    await expect(filesystemList(local, { path: root })).resolves.toEqual([]);
    await filesystemWrite(local, { path: path.join(root, "source", "file"), content: "safe" });
    symlinkSync(outside, path.join(root, "source", "nested"), "dir");
    await expect(filesystemCopy(local, { source: path.join(root, "source"), destination: path.join(root, "copy") }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(filesystemMove(local, { source: path.join(root, "source"), destination: path.join(outside, "move") }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("enforces canonical roots for existing reads and future writes through symlinks", async () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    const local = { ...ctx, filesystem: { kind: "local-operator" as const, userId: ctx.userId, roots: [root] } };
    writeFileSync(path.join(outside, "private.txt"), "private");
    symlinkSync(outside, path.join(root, "escape"), "dir");
    for (const candidate of [path.join(outside, "private.txt"), path.join(root, "escape", "private.txt")]) {
      await expect(filesystemRead(local, { path: candidate })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(filesystemWrite(local, { path: path.join(root, "escape", "new", "file"), content: "blocked" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("denies authenticated hosted callers without a local operator capability", async () => {
    const root = makeTempDir();
    await expect(filesystemList({ db: {}, userId: "user-1" } as HandlerContext, { path: root }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("writes, reads, and lists files", async () => {
    const root = makeTempDir();
    const filePath = path.join(root, "src", "hello.txt");

    await filesystemWrite(ctx, {
      path: filePath,
      content: "hello from bob",
      createDirs: true,
    });

    await expect(
      filesystemRead(ctx, { path: filePath, encoding: "utf-8" }),
    ).resolves.toEqual({ content: "hello from bob" });

    const rootEntries = await filesystemList(ctx, {
      path: root,
      showHidden: false,
    });
    expect(rootEntries).toMatchObject([
      {
        name: "src",
        path: path.join(root, "src"),
        isDirectory: true,
        isFile: false,
      },
    ]);
  });

  it("searches text files recursively", async () => {
    const root = makeTempDir();
    const filePath = path.join(root, "notes.md");

    await filesystemWrite(ctx, {
      path: filePath,
      content: "first line\nneedle here\nlast line",
    });

    await expect(
      filesystemSearch(ctx, { path: root, pattern: "needle", maxResults: 10 }),
    ).resolves.toEqual([
      {
        path: filePath,
        matches: [{ line: 2, content: "needle here" }],
      },
    ]);
  });

  it("returns porcelain git status entries with UI-compatible file aliases", async () => {
    const root = makeTempDir();
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });

    const filePath = path.join(root, "README.md");
    await filesystemWrite(ctx, { path: filePath, content: "initial\n" });
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: root });

    await filesystemWrite(ctx, { path: filePath, content: "changed\n" });

    await expect(
      filesystemGitStatus(ctx, { path: root }),
    ).resolves.toContainEqual({
      path: "README.md",
      file: "README.md",
      status: "M",
    });
  });
});

it("encodes denied filesystem access using the declared Effect RPC error contract", async () => {
  const { Effect, Schema } = await import("effect");
  const { AgentFilesystemReadRpc } = await import("@gmacko/core/contracts/groups/agent");
  const { makeFilesystemRpcHandlers } = await import("../../rpc-handlers/filesystem");
  const handlers = makeFilesystemRpcHandlers({ db: {}, userId: "hosted" } as HandlerContext);
  const error = await Effect.runPromise(handlers["filesystem.read"]({ path: "/private" }).pipe(Effect.flip));
  expect(Schema.encodeSync(AgentFilesystemReadRpc.errorSchema)(error)).toMatchObject({ _tag: "UnauthorizedError" });
});

it("passes the real lifted filesystem RPC payload to an authorized local operator", async () => {
  const { Effect, ServiceMap } = await import("effect");
  const { CurrentUser } = await import("@gmacko/core/rpc/context");
  const { GmackoDb } = await import("@gmacko/core/db");
  const { makeAgentHandlers } = await import("../../rpc-layers/agent");
  const { liftHandlers } = await import("../../rpc-server");
  const root = makeTempDir();
  writeFileSync(path.join(root, "local.txt"), "local content");
  // Until capability injection is wired this fails closed; the positive
  // outcome pins both the server composition service and payload adapter.
  const { LocalFilesystemAuthority } = await import("../local-filesystem-authority");
  const services = ServiceMap.empty().pipe(
    ServiceMap.add(GmackoDb, {} as never),
    ServiceMap.add(CurrentUser, { userId: ctx.userId } as never),
    ServiceMap.add(LocalFilesystemAuthority, { kind: "local-operator", userId: ctx.userId, roots: [root] }),
  );
  const handler = liftHandlers(makeAgentHandlers)["agent.filesystem.read"];
  const effect = handler({ path: path.join(root, "local.txt") } as never).pipe(Effect.provideServices(services));
  await expect(Effect.runPromise(effect as EffectType.Effect<unknown, unknown, never>)).resolves.toEqual({ content: "local content" });
});

it("propagates server-granted filesystem authority through tRPC and denies hosted callers", async () => {
  const { appRouter } = await import("../../root");
  type Context = Parameters<typeof appRouter.createCaller>[0];
  const root = makeTempDir();
  const file = path.join(root, "local.txt");
  writeFileSync(file, "local content");
  const base = { db: {}, session: { user: { id: ctx.userId } }, apiKeyAuth: null };
  const denied = appRouter.createCaller(base as unknown as Context);
  await expect(denied.filesystem.read({ path: file })).rejects.toMatchObject({ code: "FORBIDDEN" });
  const local = appRouter.createCaller({ ...base, filesystem: { kind: "local-operator", userId: ctx.userId, roots: [root] } } as unknown as Context);
  await expect(local.filesystem.read({ path: file })).resolves.toEqual({ content: "local content" });
  const other = appRouter.createCaller({ ...base, filesystem: { kind: "local-operator", userId: "different-user", roots: [root] } } as unknown as Context);
  await expect(other.filesystem.read({ path: file })).rejects.toMatchObject({ code: "FORBIDDEN" });
});
