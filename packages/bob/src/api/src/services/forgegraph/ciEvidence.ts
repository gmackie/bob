/**
 * ForgeGraph CI evidence for a commit — the cockpit's second CI source.
 *
 * Forgejo commit statuses are what the merge gate reads, but several repos'
 * workflows never post them on PR heads; every workflow DOES call
 * `POST /api/fg/ci/report`, so ForgeGraph's builds table knows the truth.
 * `GET /api/fg/ci/gate?app&sha` gives gate semantics (pass/pending/fail/none)
 * and `GET /api/fg/ci/runs/:id/failures` the structured "what broke" readout
 * (`CiFailureSummary`) for a red build.
 *
 * Pure mapping functions are exported for tests; the fetcher caches 30 s per
 * app+sha because the wall polls every 10 s.
 */
import type { CheckRollup, FgCiEvidence } from "../cockpit/types.js";

export interface FgCiConfig {
  baseUrl: string;
  token: string;
}

export interface FgGateResponse {
  status: "pass" | "pending" | "fail" | "none";
  hasCIHistory: boolean;
  builds: { id: string; pipelineName: string; status: string; runUrl: string; finishedAt?: string; tests?: unknown }[];
}

/** Normalize the CheckSummary FG stores under builds.metadata.tests. */
export function normalizeTests(raw: unknown, at?: string): CheckRollup | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as { status?: string; phases?: unknown };
  if (!Array.isArray(t.phases)) return null;
  return {
    status: t.status === "passed" ? "passed" : "failed",
    at: at || new Date(0).toISOString(),
    phases: (t.phases as CheckRollup["phases"]).map((p) => ({
      phase: p.phase,
      status: p.status,
      durationMs: p.durationMs,
      counts: p.counts,
      confidence: p.confidence,
      failures: Array.isArray(p.failures) ? p.failures.slice(0, 10) : [],
    })),
  };
}

/** When CI streamed exact results, its failing tests beat the log scrape. */
export function failuresFromTests(tests: CheckRollup | null): FgCiEvidence["failures"] {
  if (!tests) return null;
  const failing = tests.phases.flatMap((p) => p.failures.map((f) => ({ ...f, phase: p.phase })));
  const redPhases = tests.phases.filter((p) => p.status === "failed");
  if (!failing.length && !redPhases.length) return null;
  const headline = redPhases
    .map((p) => (p.counts ? `${p.phase}: ${p.counts.failed} failed of ${p.counts.total ?? p.counts.passed + p.counts.failed}` : `${p.phase} failed`))
    .join("; ");
  return {
    headline: headline || `${failing.length} failing`,
    tests: failing.slice(0, 10).map((f) => ({ name: f.name, suite: f.suite, message: f.message })),
    errors: [],
  };
}

export interface FgFailuresResponse {
  headline: string;
  parsed: boolean;
  groups: {
    kind: string;
    count: number;
    tests?: { name: string; suite?: string; message?: string }[];
    errors?: string[];
  }[];
}

/** Map FG gate status onto the commit-status vocabulary pipeline.ts expects. */
export function fgGateToCiFacts(gate: Pick<FgGateResponse, "status" | "builds">): { ciState: string; ciTotal: number } {
  const ciTotal = gate.builds.length;
  switch (gate.status) {
    case "pass":
      return { ciState: "success", ciTotal: Math.max(1, ciTotal) };
    case "fail":
      return { ciState: "failure", ciTotal: Math.max(1, ciTotal) };
    case "pending":
      return { ciState: "pending", ciTotal: Math.max(1, ciTotal) };
    default:
      return { ciState: "none", ciTotal: 0 };
  }
}

/** Flatten a CiFailureSummary into what a PR row can show at a glance. */
export function flattenFailures(f: FgFailuresResponse | null): FgCiEvidence["failures"] {
  if (!f || !f.parsed) return null;
  const tests: { name: string; suite?: string; message?: string }[] = [];
  const errors: string[] = [];
  for (const g of f.groups) {
    for (const t of g.tests ?? []) tests.push({ name: t.name, suite: t.suite, message: t.message });
    for (const e of g.errors ?? []) errors.push(e);
  }
  return { headline: f.headline, tests: tests.slice(0, 10), errors: errors.slice(0, 10) };
}

const cache = new Map<string, { at: number; value: FgCiEvidence | null }>();
const TTL_MS = 30_000;

export async function fetchFgCiEvidence(
  cfg: FgCiConfig,
  appSlug: string,
  sha: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FgCiEvidence | null> {
  const key = `${appSlug}@${sha}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const headers = { Authorization: `Bearer ${cfg.token}` };
  const base = cfg.baseUrl.replace(/\/$/, "");
  let value: FgCiEvidence | null = null;
  try {
    const res = await fetchImpl(`${base}/api/fg/ci/gate?app=${encodeURIComponent(appSlug)}&sha=${encodeURIComponent(sha)}`, { headers });
    if (res.ok) {
      const gate = (await res.json()) as FgGateResponse;
      const builds = (gate.builds ?? []).map((b) => ({
        id: b.id,
        pipelineName: b.pipelineName,
        status: b.status,
        runUrl: b.runUrl,
        tests: normalizeTests(b.tests, b.finishedAt),
      }));
      let failures: FgCiEvidence["failures"] = null;
      const red = gate.status === "fail" ? builds.find((b) => b.status === "failed") : undefined;
      if (red) {
        // exact check-events failures first; the log-scrape endpoint only when CI didn't stream
        failures = failuresFromTests(red.tests);
        if (!failures) {
          const fr = await fetchImpl(`${base}/api/fg/ci/runs/${encodeURIComponent(red.id)}/failures`, { headers }).catch(() => null);
          if (fr?.ok) failures = flattenFailures((await fr.json()) as FgFailuresResponse);
        }
      }
      value = { app: appSlug, status: gate.status, hasCIHistory: gate.hasCIHistory, builds, failures };
    }
  } catch {
    value = hit?.value ?? null;
  }
  // A completed verdict is stable; keep polling only while pending/none.
  cache.set(key, { at: value && (value.status === "pass" || value.status === "fail") ? Date.now() + 4 * TTL_MS : Date.now(), value });
  return value;
}
