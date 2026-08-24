import { describe, expect, it, vi } from "vitest";

import { fetchFgCiEvidence, fgGateToCiFacts, flattenFailures } from "../ciEvidence.js";

describe("fgGateToCiFacts", () => {
  it("maps gate statuses onto commit-status vocabulary with a non-zero total", () => {
    expect(fgGateToCiFacts({ status: "pass", builds: [{ id: "a", pipelineName: "ci", status: "passed", runUrl: "" }] })).toEqual({ ciState: "success", ciTotal: 1 });
    expect(fgGateToCiFacts({ status: "fail", builds: [] })).toEqual({ ciState: "failure", ciTotal: 1 });
    expect(fgGateToCiFacts({ status: "pending", builds: [] })).toEqual({ ciState: "pending", ciTotal: 1 });
    expect(fgGateToCiFacts({ status: "none", builds: [] })).toEqual({ ciState: "none", ciTotal: 0 });
  });
});

describe("flattenFailures", () => {
  it("returns null for unparsed summaries and flattens groups otherwise", () => {
    expect(flattenFailures({ headline: "x", parsed: false, groups: [] })).toBeNull();
    const flat = flattenFailures({
      headline: "2 test failures; 1 type error",
      parsed: true,
      groups: [
        { kind: "test", count: 2, tests: [{ name: "adds", suite: "math.test.ts", message: "expected 2" }, { name: "subs" }] },
        { kind: "typecheck", count: 1, errors: ["src/a.ts(3,1): error TS2322"] },
      ],
    });
    expect(flat?.headline).toBe("2 test failures; 1 type error");
    expect(flat?.tests.map((t) => t.name)).toEqual(["adds", "subs"]);
    expect(flat?.errors).toEqual(["src/a.ts(3,1): error TS2322"]);
  });
});

/**
 * Extract the URL from whatever `fetch` was handed. `String(url)` gives
 * "[object Object]" for a Request, so every `includes()` match below would
 * quietly stop matching rather than fail loudly — the trap no-base-to-string
 * is pointing at.
 */
function requestUrl(url: string | URL | Request): string {
  if (typeof url === "string") return url;
  return url instanceof URL ? url.href : url.url;
}

describe("fetchFgCiEvidence", () => {
  it("reads the gate and, for a red build, its structured failures", async () => {
    // Not `async`: nothing here awaits, so the promise is returned explicitly.
    const fetchImpl = vi.fn((url: string | URL | Request, _init?: RequestInit) => {
      const u = requestUrl(url);
      if (u.includes("/api/fg/ci/gate")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "fail", hasCIHistory: true, builds: [{ id: "b1", pipelineName: "ci", status: "failed", runUrl: "https://x/1" }] })),
        );
      }
      if (u.includes("/api/fg/ci/runs/b1/failures")) {
        return Promise.resolve(
          new Response(JSON.stringify({ headline: "1 test failure", parsed: true, groups: [{ kind: "test", count: 1, tests: [{ name: "boom" }] }] })),
        );
      }
      return Promise.resolve(new Response("nope", { status: 404 }));
    });
    const ev = await fetchFgCiEvidence({ baseUrl: "https://fg.test/", token: "t" }, "habitplay", "abc123", fetchImpl);
    expect(ev?.status).toBe("fail");
    expect(ev?.builds[0]?.runUrl).toBe("https://x/1");
    expect(ev?.failures?.tests[0]?.name).toBe("boom");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: "Bearer t" } });
    // cached: a second call for the same app+sha does not refetch
    await fetchFgCiEvidence({ baseUrl: "https://fg.test/", token: "t" }, "habitplay", "abc123", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns null (not a throw) when the gate call fails", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error("ECONNRESET")));
    const ev = await fetchFgCiEvidence({ baseUrl: "https://fg.test", token: "t" }, "app", "deadbeef", fetchImpl);
    expect(ev).toBeNull();
  });
});

describe("check-events summaries from FG builds", () => {
  it("normalizes metadata.tests and derives failures from exact results before scraping", async () => {
    const { normalizeTests, failuresFromTests } = await import("../ciEvidence.js");
    const rollup = normalizeTests(
      {
        status: "failed",
        phases: [
          { phase: "typecheck", status: "passed", durationMs: 900, failures: [] },
          { phase: "test", status: "failed", durationMs: 8120, confidence: "exact", counts: { passed: 57, failed: 1, total: 58 }, failures: [{ name: "computeStreak › gaps", suite: "streak.test.ts", message: "expected 3, got 4" }] },
        ],
      },
      "2026-08-24T00:00:00.000Z",
    );
    expect(rollup?.status).toBe("failed");
    expect(rollup?.phases.map((p) => p.phase)).toEqual(["typecheck", "test"]);
    const f = failuresFromTests(rollup);
    expect(f?.headline).toBe("test: 1 failed of 58");
    expect(f?.tests[0]).toEqual({ name: "computeStreak › gaps", suite: "streak.test.ts", message: "expected 3, got 4" });
    expect(normalizeTests(null)).toBeNull();
    expect(normalizeTests({ status: "passed" })).toBeNull();
    expect(failuresFromTests(normalizeTests({ status: "passed", phases: [{ phase: "test", status: "passed", failures: [] }] }))).toBeNull();
  });

  it("skips the failures endpoint when the red build streamed exact results", async () => {
    const { fetchFgCiEvidence } = await import("../ciEvidence.js");
    const fetchImpl = vi.fn((url: string | URL | Request, _init?: RequestInit) => {
      if (requestUrl(url).includes("/api/fg/ci/gate")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "fail", hasCIHistory: true, builds: [{ id: "b9", pipelineName: "ci", status: "failed", runUrl: "", tests: { status: "failed", phases: [{ phase: "test", status: "failed", counts: { passed: 3, failed: 2, total: 5 }, failures: [{ name: "a" }, { name: "b" }] }] } }] })),
        );
      }
      throw new Error("failures endpoint should not be called");
    });
    const ev = await fetchFgCiEvidence({ baseUrl: "https://fg.test", token: "t" }, "exact-app", "sha9", fetchImpl);
    expect(ev?.failures?.tests.map((t) => t.name)).toEqual(["a", "b"]);
    expect(ev?.builds[0]?.tests?.phases[0]?.counts?.total).toBe(5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
