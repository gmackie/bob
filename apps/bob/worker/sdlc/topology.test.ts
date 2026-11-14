import { describe, expect, it } from "vitest";
import { fetchBizPulseRepos } from "./topology";

// A row as BizPulse's repos.list returns it: the startup_repo columns plus startupName and cloneUrl,
// wrapped as { repos } in tRPC's superjson envelope.
const row = (startupId: string, startupName: string, provider: string, repoSlug: string) => ({
  id: `r-${repoSlug}`, startupId, provider, repoSlug, defaultBranch: "main", description: null, isMonorepo: false,
  monorepoPath: null, language: null, localPaths: {}, lastScannedAt: null, createdAt: "2026-06-01T00:00:00.000Z",
  startupName, cloneUrl: `https://git.forgegraf.com/${repoSlug}`,
});
const reply = (json: unknown) => (async () => Response.json({ result: { data: { json, meta: { values: {} } } } })) as unknown as typeof globalThis.fetch;

describe("fetchBizPulseRepos", () => {
  it("reads repos.list and keeps only ForgeGraph repos", async () => {
    const seen: string[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      seen.push(url); expect((init.headers as Record<string, string>).authorization).toBe("Bearer key");
      return Response.json({ result: { data: { json: { repos: [
        row("s1", "Bob", "forgegraph", "gmackie/bob"),
        row("s2", "Other", "github", "x/y"),
      ] } } } });
    }) as unknown as typeof globalThis.fetch;
    expect(await fetchBizPulseRepos({ apiUrl: "https://pulse.test/", apiKey: "key", fetch })).toEqual([{ startupId: "s1", startupName: "Bob", repoSlug: "gmackie/bob" }]);
    expect(seen[0]).toBe("https://pulse.test/api/trpc/repos.list?input=%7B%22json%22%3A%7B%7D%7D");
  });
  it("throws on HTTP errors so the controller keeps the old topology", async () => {
    const fetch = (async () => new Response("no", { status: 500 })) as unknown as typeof globalThis.fetch;
    await expect(fetchBizPulseRepos({ apiUrl: "https://pulse.test", apiKey: "key", fetch })).rejects.toThrow(/HTTP 500/);
  });
  it("throws on a tRPC error body", async () => {
    const fetch = (async () => Response.json({ error: { json: { message: "UNAUTHORIZED" } } })) as unknown as typeof globalThis.fetch;
    await expect(fetchBizPulseRepos({ apiUrl: "https://pulse.test", apiKey: "key", fetch })).rejects.toThrow(/UNAUTHORIZED/);
  });
  it("throws when the body is not repos.list's { repos } shape, rather than clearing the topology", async () => {
    await expect(fetchBizPulseRepos({ apiUrl: "https://pulse.test", apiKey: "key", fetch: reply([row("s1", "Bob", "forgegraph", "bob")]) })).rejects.toThrow(/no repo list/);
    await expect(fetchBizPulseRepos({ apiUrl: "https://pulse.test", apiKey: "key", fetch: reply(null) })).rejects.toThrow(/no repo list/);
  });
  it("accepts an empty workspace and skips malformed rows", async () => {
    expect(await fetchBizPulseRepos({ apiUrl: "https://pulse.test", apiKey: "key", fetch: reply({ repos: [] }) })).toEqual([]);
    const rows = [null, { provider: "forgegraph", repoSlug: "a" }, { ...row("s1", "Bob", "forgegraph", "bob"), startupName: null }];
    expect(await fetchBizPulseRepos({ apiUrl: "https://pulse.test", apiKey: "key", fetch: reply({ repos: rows }) })).toEqual([{ startupId: "s1", startupName: "Unknown", repoSlug: "bob" }]);
  });
});
