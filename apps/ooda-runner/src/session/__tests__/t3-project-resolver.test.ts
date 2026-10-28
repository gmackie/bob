import { describe, expect, it } from "vitest";

import { createT3ProjectResolver, readT3ProjectRegistry } from "../t3-project-resolver";

const registry = JSON.stringify({
  projects: {
    "lf-aaaa": { worktreePath: "/games/a", title: "Game A" },
    "lf-bbbb": { worktreePath: "/games/b", t3codeProjectId: "pinned-b" },
    broken: { nope: true },
  },
});

function snapshotFetch(projects: Array<{ id: string; workspaceRoot: string; deletedAt?: string | null }>) {
  return (async () => new Response(JSON.stringify({ projects }), { status: 200 })) as unknown as typeof fetch;
}

describe("readT3ProjectRegistry", () => {
  it("tolerates a missing or malformed file and drops invalid entries", async () => {
    expect(await readT3ProjectRegistry("/nope", async () => { throw new Error("ENOENT"); })).toEqual({});
    expect(await readT3ProjectRegistry("/bad", async () => "{not json")).toEqual({});
    const parsed = await readT3ProjectRegistry("/ok", async () => registry);
    expect(Object.keys(parsed).sort()).toEqual(["lf-aaaa", "lf-bbbb"]);
  });
});

describe("createT3ProjectResolver", () => {
  it("returns null for threads that are not registered", async () => {
    const resolver = createT3ProjectResolver({
      registryFile: "/r", serverUrl: "http://t3.test", readRegistry: async () => registry,
      fetchImpl: snapshotFetch([]),
    });
    expect(await resolver.resolve("lf-unknown")).toBeNull();
  });

  it("uses a pinned project id without touching t3code", async () => {
    let fetched = 0;
    const resolver = createT3ProjectResolver({
      registryFile: "/r", serverUrl: "http://t3.test", readRegistry: async () => registry,
      fetchImpl: (async () => { fetched += 1; return new Response("{}"); }) as unknown as typeof fetch,
    });
    expect(await resolver.resolve("lf-bbbb")).toEqual({ projectId: "pinned-b", worktreePath: "/games/b" });
    expect(fetched).toBe(0);
  });

  it("finds an existing t3code project by workspaceRoot and caches it", async () => {
    let fetched = 0;
    const fetchImpl = (async () => { fetched += 1; return new Response(JSON.stringify({ projects: [
      { id: "dead", workspaceRoot: "/games/a", deletedAt: "2026-01-01" },
      { id: "live-a", workspaceRoot: "/games/a" },
    ] })); }) as unknown as typeof fetch;
    const resolver = createT3ProjectResolver({
      registryFile: "/r", serverUrl: "http://t3.test", readRegistry: async () => registry, fetchImpl,
    });
    expect(await resolver.resolve("lf-aaaa")).toEqual({ projectId: "live-a", worktreePath: "/games/a" });
    expect(await resolver.resolve("lf-aaaa")).toEqual({ projectId: "live-a", worktreePath: "/games/a" });
    expect(fetched).toBe(1);
  });

  it("creates the t3code project when none matches", async () => {
    const calls: string[][] = [];
    const resolver = createT3ProjectResolver({
      registryFile: "/r", serverUrl: "http://t3.test", readRegistry: async () => registry,
      fetchImpl: snapshotFetch([]), t3BaseDir: "/base",
      exec: async (_file, args) => { calls.push(args); return { stdout: "Added project 11111111-2222-4333-8444-555555555555 (Game A) at /games/a.\n" }; },
    });
    expect(await resolver.resolve("lf-aaaa")).toEqual({ projectId: "11111111-2222-4333-8444-555555555555", worktreePath: "/games/a" });
    expect(calls).toEqual([["project", "add", "--base-dir", "/base", "--title", "Game A", "/games/a"]]);
  });

  it("refuses to create a project without a base dir", async () => {
    const resolver = createT3ProjectResolver({
      registryFile: "/r", serverUrl: "http://t3.test", readRegistry: async () => registry, fetchImpl: snapshotFetch([]),
    });
    await expect(resolver.resolve("lf-aaaa")).rejects.toThrow(/OODA_T3CODE_BASE_DIR/);
  });
});
