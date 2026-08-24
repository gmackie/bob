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

describe("fetchFgCiEvidence", () => {
  it("reads the gate and, for a red build, its structured failures", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/fg/ci/gate")) {
        return new Response(JSON.stringify({ status: "fail", hasCIHistory: true, builds: [{ id: "b1", pipelineName: "ci", status: "failed", runUrl: "https://x/1" }] }));
      }
      if (u.includes("/api/fg/ci/runs/b1/failures")) {
        return new Response(JSON.stringify({ headline: "1 test failure", parsed: true, groups: [{ kind: "test", count: 1, tests: [{ name: "boom" }] }] }));
      }
      return new Response("nope", { status: 404 });
    });
    const ev = await fetchFgCiEvidence({ baseUrl: "https://fg.test/", token: "t" }, "habitplay", "abc123", fetchImpl as unknown as typeof fetch);
    expect(ev?.status).toBe("fail");
    expect(ev?.builds[0]?.runUrl).toBe("https://x/1");
    expect(ev?.failures?.tests[0]?.name).toBe("boom");
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: "Bearer t" } });
    // cached: a second call for the same app+sha does not refetch
    await fetchFgCiEvidence({ baseUrl: "https://fg.test/", token: "t" }, "habitplay", "abc123", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns null (not a throw) when the gate call fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const ev = await fetchFgCiEvidence({ baseUrl: "https://fg.test", token: "t" }, "app", "deadbeef", fetchImpl as unknown as typeof fetch);
    expect(ev).toBeNull();
  });
});
