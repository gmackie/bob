// BOB-80 Task 3.4: display-only ForgeGraph CI detail.
import { describe, expect, it, vi } from "vitest";
import type { ItemSnapshot, PlanSnapshot, TopologyRepo } from "@bob/sdlc-view";
import {
  CI_REASONS, commitShaOf, FG_CACHE_MS, FgCiSource, fetchFgGate, fetchForgegraphApp, fgCiSourceFromEnv, fullRepoSlug, gateToPhases, type FgGate,
} from "./fg";

const SHA = "b".repeat(40);
const target = (repositoryId = "bob", integrationId = "forgegraph") => ({ environmentId: "e", projectId: "bob", repository: { integrationId, repositoryId } });
const item = (evidenceRefs: string[] = [`commit:${SHA}`], repositoryId = "bob"): ItemSnapshot => ({
  itemId: "i1", planId: "p1", resourceVersion: 3, state: "validating", currentAttemptId: "a1",
  execution: { attemptId: "a1", target: target(repositoryId), thread: { environmentId: "e", projectId: "bob", threadId: "t" } },
  achievedMilestones: [], operationIds: [], evidenceRefs,
});
const plan: PlanSnapshot = { planId: "p1", resourceVersion: 1, state: "active", definition: { items: [], dependencies: [], concurrencyLimit: 1 } };
const topology: TopologyRepo[] = [{ startupId: "s", startupName: "Bob", repoSlug: "gmackie/bob" }];
const gate: FgGate = {
  status: "fail",
  builds: [
    { id: "b1", pipelineName: "ci", status: "failed", runUrl: "https://forgegraf.com/runs/1", tests: { phases: [{ phase: "lint", status: "passed" }, { phase: "test", status: "failed" }] } },
    { id: "b2", pipelineName: "deploy", status: "queued", runUrl: "javascript:alert(1)" },
  ],
};

describe("commitShaOf", () => {
  it("is null for what ItemSnapshot carries today (opaque evidence refs, no commit)", () => {
    expect(commitShaOf(item([]))).toBeNull();
    expect(commitShaOf(item(["execution-log", "log"]))).toBeNull();
    expect(commitShaOf(item(["commit:abc"]))).toBeNull();
  });
  it("reads a commit:<sha> (or bare sha) evidence ref, the latest winning", () => {
    expect(commitShaOf(item([`commit:${"a".repeat(40)}`, "log", `commit:${SHA}`]))).toBe(SHA);
    expect(commitShaOf(item([SHA]))).toBe(SHA);
  });
  it("prefers the release's published head over the (never pushed) checkpoint evidence", () => {
    const release = { attemptId: "a1", stage: "checks-running" as const, autoMerge: false, updatedAt: "2026-11-15T00:00:00Z" };
    const head = "c".repeat(40);
    expect(commitShaOf({ ...item([`commit:${SHA}`]), release: { ...release, headSha: head } })).toBe(head);
    expect(commitShaOf({ ...item([`commit:${SHA}`]), release })).toBe(SHA);
  });
});

describe("fullRepoSlug", () => {
  it("joins a bare ForgeGraph repository id to the one topology slug with that last segment", () => {
    expect(fullRepoSlug(target("bob").repository, topology)).toBe("gmackie/bob");
    expect(fullRepoSlug(target("other/bob").repository, topology)).toBe("other/bob");
  });
  it("is null when ambiguous, unknown or not ForgeGraph", () => {
    expect(fullRepoSlug(target("bob").repository, [...topology, { startupId: "x", startupName: "X", repoSlug: "x/bob" }])).toBeNull();
    expect(fullRepoSlug(target("nope").repository, topology)).toBeNull();
    expect(fullRepoSlug(target("bob", "github").repository, topology)).toBeNull();
  });
});

describe("gateToPhases", () => {
  it("expands streamed test phases, maps statuses and keeps only http(s) run urls", () => {
    expect(gateToPhases(gate)).toEqual([
      { name: "ci · lint", status: "passed", url: "https://forgegraf.com/runs/1" },
      { name: "ci · test", status: "failed", url: "https://forgegraf.com/runs/1" },
      { name: "deploy", status: "queued" },
    ]);
  });
  it("maps unknown statuses to unknown and tolerates junk builds", () => {
    expect(gateToPhases({ status: "pending", builds: [{ status: "weird" }, null as never, { status: "success", pipelineName: "x" }] }))
      .toEqual([{ name: "build", status: "unknown" }, { name: "build", status: "unknown" }, { name: "x", status: "passed" }]);
  });
});

describe("FgCiSource", () => {
  function source(over: { fetchGate?: (a: string, s: string) => Promise<FgGate>; resolveApp?: (slug: string) => Promise<string | null> } = {}) {
    let clock = 1_000_000;
    const fetchGate = vi.fn(over.fetchGate ?? (async () => gate));
    const resolveApp = vi.fn(over.resolveApp ?? (async () => "bob"));
    const ci = new FgCiSource({ fetchGate, resolveApp, now: () => clock });
    return { ci, fetchGate, resolveApp, tick: (ms: number) => { clock += ms; } };
  }

  it("maps the gate for a known sha and app", async () => {
    const { ci, fetchGate, resolveApp } = source();
    const message = await ci.message(item(), plan, topology);
    expect(message).toMatchObject({ type: "ci", itemId: "i1", available: true, sha: SHA, summary: "CI failed" });
    expect(message.available && message.phases).toHaveLength(3);
    expect(resolveApp).toHaveBeenCalledWith("gmackie/bob");
    expect(fetchGate).toHaveBeenCalledWith("bob", SHA);
  });
  it("reports no commit yet without touching ForgeGraph", async () => {
    const { ci, fetchGate, resolveApp } = source();
    expect(await ci.message(item([]), plan, topology)).toMatchObject({ available: false, reason: CI_REASONS.noCommit });
    expect(fetchGate).not.toHaveBeenCalled();
    expect(resolveApp).not.toHaveBeenCalled();
  });
  it("reports no ForgeGraph app when the repo cannot be mapped or has no .forgegraph.yaml", async () => {
    const unmapped = source();
    expect(await unmapped.ci.message(item(undefined, "unknown-repo"), plan, topology)).toMatchObject({ available: false, reason: CI_REASONS.noApp });
    const noYaml = source({ resolveApp: async () => null });
    expect(await noYaml.ci.message(item(), plan, topology)).toMatchObject({ available: false, reason: CI_REASONS.noApp });
    expect(noYaml.fetchGate).not.toHaveBeenCalled();
  });
  it("falls back to the plan's target when the item has no execution yet", async () => {
    const { ci, resolveApp } = source();
    const withPlan: PlanSnapshot = { ...plan, definition: { ...plan.definition, items: [{ itemId: "i1", issue: { integrationId: "k", workspaceId: "w", teamId: "t", projectId: "p", issueId: "x" }, target: target("bob"), completionTarget: "execution" }] } };
    await ci.message({ ...item(), execution: null }, withPlan, topology);
    expect(resolveApp).toHaveBeenCalledWith("gmackie/bob");
  });
  it("caches the gate 30 s per app + sha, failures included, then reads again", async () => {
    let fail = true;
    const s = source({ fetchGate: async () => { if (fail) throw new Error("down"); return gate; } });
    expect(await s.ci.message(item(), plan, topology)).toMatchObject({ available: false, reason: CI_REASONS.unavailable });
    fail = false;
    s.tick(FG_CACHE_MS - 1);
    expect(await s.ci.message(item(), plan, topology)).toMatchObject({ available: false });
    expect(s.fetchGate).toHaveBeenCalledTimes(1);
    s.tick(2);
    expect(await s.ci.message(item(), plan, topology)).toMatchObject({ available: true });
    expect(s.fetchGate).toHaveBeenCalledTimes(2);
    expect(s.resolveApp).toHaveBeenCalledTimes(1); // the app mapping is cached longer
  });
  it("reads live detail unavailable when ForgeGraph is not configured", async () => {
    const ci = fgCiSourceFromEnv({ BOB_FORGEJO_TOKEN: undefined, FG_API_TOKEN: undefined });
    expect(await ci.message(item(), plan, topology)).toMatchObject({ available: false, reason: CI_REASONS.noApp });
    const noFg = new FgCiSource({ resolveApp: async () => "bob" });
    expect(await noFg.message(item(), plan, topology)).toMatchObject({ available: false, reason: CI_REASONS.unavailable });
  });
});

describe("fetchFgGate", () => {
  it("calls the gate with the bearer and parses it", async () => {
    const fetch = vi.fn(async () => Response.json(gate)) as unknown as typeof globalThis.fetch;
    expect(await fetchFgGate({ baseUrl: "https://fg.test/", token: "tok", fetch }, "bob", SHA)).toEqual(gate);
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe(`https://fg.test/api/fg/ci/gate?app=bob&sha=${SHA}`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(init.redirect).toBe("manual");
  });
  it("never follows a redirect with the token: a 3xx is unavailable", async () => {
    const redirect = (async () => new Response(null, { status: 302, headers: { location: "https://evil.test/" } })) as unknown as typeof globalThis.fetch;
    await expect(fetchFgGate({ baseUrl: "https://fg.test", token: "t", fetch: redirect }, "bob", SHA)).rejects.toThrow(/HTTP 302/);
  });
  it("throws on HTTP errors and unexpected bodies", async () => {
    const status = (s: number) => (async () => new Response("x", { status: s })) as unknown as typeof globalThis.fetch;
    await expect(fetchFgGate({ baseUrl: "https://fg.test", token: "t", fetch: status(500) }, "bob", SHA)).rejects.toThrow();
    const junk = (async () => Response.json({ status: "maybe" })) as unknown as typeof globalThis.fetch;
    await expect(fetchFgGate({ baseUrl: "https://fg.test", token: "t", fetch: junk }, "bob", SHA)).rejects.toThrow();
  });
  it("times out", async () => {
    const hang = ((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
    })) as unknown as typeof globalThis.fetch;
    const started = Date.now();
    await expect(fetchFgGate({ baseUrl: "https://fg.test", token: "t", fetch: hang, timeoutMs: 20 }, "bob", SHA)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
  it("a timeout surfaces as live detail unavailable through FgCiSource", async () => {
    const hang = ((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
    })) as unknown as typeof globalThis.fetch;
    const ci = new FgCiSource({ resolveApp: async () => "bob", fetchGate: (a, s) => fetchFgGate({ baseUrl: "https://fg.test", token: "t", fetch: hang, timeoutMs: 20 }, a, s) });
    expect(await ci.message(item(), plan, topology)).toMatchObject({ available: false, reason: CI_REASONS.unavailable });
  });
});

describe("fetchForgegraphApp", () => {
  it("reads the app: line of .forgegraph.yaml through the Forgejo contents API", async () => {
    const fetch = vi.fn(async () => Response.json({ content: btoa("version: 1\napp: bob\nstages: []\n") })) as unknown as typeof globalThis.fetch;
    expect(await fetchForgegraphApp({ instanceUrl: "https://git.test", token: "ft", fetch }, "gmackie/bob")).toBe("bob");
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("https://git.test/api/v1/repos/gmackie/bob/contents/.forgegraph.yaml");
    expect((init.headers as Record<string, string>).authorization).toBe("token ft");
    expect(init.redirect).toBe("manual");
  });
  it("is null on a redirect (the token is never forwarded)", async () => {
    const redirect = (async () => new Response(null, { status: 301, headers: { location: "https://evil.test/" } })) as never;
    expect(await fetchForgegraphApp({ instanceUrl: "https://git.test", token: "t", fetch: redirect }, "gmackie/bob")).toBeNull();
  });
  it("is null on 404, a missing app line, or a malformed slug", async () => {
    expect(await fetchForgegraphApp({ instanceUrl: "https://git.test", token: "t", fetch: (async () => new Response("", { status: 404 })) as never }, "gmackie/bob")).toBeNull();
    expect(await fetchForgegraphApp({ instanceUrl: "https://git.test", token: "t", fetch: (async () => Response.json({ content: btoa("stages: []") })) as never }, "gmackie/bob")).toBeNull();
    expect(await fetchForgegraphApp({ instanceUrl: "https://git.test", token: "t", fetch: (async () => { throw new Error("x"); }) as never }, "bob")).toBeNull();
  });
});
