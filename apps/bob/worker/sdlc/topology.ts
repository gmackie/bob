import type { TopologyRepo } from "@bob/sdlc-view";

export interface BizPulseTopologyOptions { apiUrl: string; apiKey: string; fetch?: typeof fetch; timeoutMs?: number }

/**
 * Reads BizPulse's startup-to-repo mapping. BizPulse serves tRPC with superjson (see
 * packages/bob/src/api/src/services/intake/bizpulseIntake.ts): `repos.list` takes
 * `{ startupId? }` and returns `{ repos }`, each row a startup_repo record plus
 * `startupName` and `cloneUrl`. Only ForgeGraph repos
 * can join coordinator items. Throws on any failure or after timeoutMs (default 5 s), so
 * the caller keeps its last topology. The caller sorts the result before comparing it.
 */
export async function fetchBizPulseRepos(options: BizPulseTopologyOptions): Promise<TopologyRepo[]> {
  const doFetch = options.fetch ?? fetch;
  const base = options.apiUrl.replace(/\/+$/, "");
  const input = encodeURIComponent(JSON.stringify({ json: {} }));
  const response = await doFetch(`${base}/api/trpc/repos.list?input=${input}`, {
    method: "GET",
    signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
    headers: { authorization: `Bearer ${options.apiKey}`, accept: "application/json" },
  });
  if (!response.ok) throw new Error(`BizPulse repos.list failed: HTTP ${response.status}`);
  const body = (await response.json()) as { result?: { data?: unknown }; error?: { json?: { message?: string } } };
  if (body.error) throw new Error(`BizPulse repos.list error: ${body.error.json?.message ?? "unknown"}`);
  const data = body.result?.data;
  const payload = data && typeof data === "object" && "json" in data ? (data as { json: unknown }).json : data;
  const repos = payload && typeof payload === "object" ? (payload as { repos?: unknown }).repos : undefined;
  if (!Array.isArray(repos)) throw new Error("BizPulse repos.list returned no repo list");
  return repos.flatMap((row: unknown) => {
    const r = row as Record<string, unknown> | null;
    return r?.provider === "forgegraph" && typeof r.startupId === "string" && typeof r.repoSlug === "string"
      ? [{ startupId: r.startupId, startupName: typeof r.startupName === "string" ? r.startupName : "Unknown", repoSlug: r.repoSlug }]
      : [];
  });
}
