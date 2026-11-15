// BOB-80 Task 3.4: display-only ForgeGraph CI detail for watched items. Reads ForgeGraph's
// CI gate (GET /api/fg/ci/gate?app&sha, the same endpoint and FG_API_TOKEN that
// packages/bob/src/api/src/services/forgegraph/ciEvidence.ts uses) and turns it into a
// CiMessage. Never writes coordinator state, never stores anything durably.
import { safeHref, type CiMessage, type CiPhase, type ItemSnapshot, type PlanSnapshot, type RepositoryRef, type TopologyRepo } from "@bob/sdlc-view";

export const FG_TIMEOUT_MS = 5_000;
/** One gate read per app + sha per this long, whoever is watching. */
export const FG_CACHE_MS = 30_000;
/** The DO re-reads CI for watched items this often. */
export const CI_POLL_MS = 30_000;
/** At most this many distinct watched items are polled per tick. */
export const MAX_POLLED_ITEMS = 20;
const APP_CACHE_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 500;

export const CI_REASONS = {
  noCommit: "no commit yet",
  noApp: "no ForgeGraph app",
  unavailable: "live detail unavailable",
} as const;

/** The gate response (ForgeGraph /api/fg/ci/gate), as far as the edge reads it. */
export interface FgGate {
  status: "pass" | "pending" | "fail" | "none";
  builds: Array<{ id?: string; pipelineName?: string; status?: string; runUrl?: string; tests?: unknown }>;
}

const SHA = /^[a-f0-9]{40}$/;
/**
 * The commit to read CI for. ItemSnapshot carries no commit today (the execution receipt's
 * sourceSnapshot.commitSha is not projected onto it), so this only recognises an evidence
 * ref of the form `commit:<40 hex>` (or a bare 40-hex ref), the most recent one winning.
 * Until the coordinator exposes one, every item reads "no commit yet".
 */
export function commitShaOf(item: ItemSnapshot): string | null {
  for (const ref of [...(item.evidenceRefs ?? [])].reverse()) {
    const sha = ref.startsWith("commit:") ? ref.slice(7) : ref;
    if (SHA.test(sha)) return sha;
  }
  return null;
}

/**
 * owner/repo for a ForgeGraph repository: the repositoryId when it already has an owner,
 * else the one BizPulse topology slug whose last segment matches (ambiguous: null).
 */
export function fullRepoSlug(ref: RepositoryRef, topology: TopologyRepo[]): string | null {
  if (ref.integrationId !== "forgegraph") return null;
  if (ref.repositoryId.includes("/")) return ref.repositoryId;
  const id = ref.repositoryId.toLowerCase();
  const hits = topology.filter((t) => t.repoSlug.toLowerCase().split("/").at(-1) === id && t.repoSlug.includes("/"));
  return hits.length === 1 ? hits[0]!.repoSlug : null;
}

const PHASE_STATUS: Record<string, CiPhase["status"]> = {
  pass: "passed", passed: "passed", success: "passed", succeeded: "passed",
  fail: "failed", failed: "failed", failure: "failed", error: "failed",
  running: "running", in_progress: "running", started: "running",
  queued: "queued", pending: "queued", waiting: "queued", created: "queued",
  skipped: "skipped", cancelled: "skipped", canceled: "skipped",
};
const phaseStatus = (status: unknown): CiPhase["status"] => (typeof status === "string" ? PHASE_STATUS[status.toLowerCase()] : undefined) ?? "unknown";
const text = (v: unknown, fallback: string, max = 120) => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : fallback);
const SUMMARY: Record<FgGate["status"], string> = { pass: "CI passed", fail: "CI failed", pending: "CI running", none: "No CI runs for this commit" };

/**
 * Gate → phases. A build that streamed test phases (builds[].tests.phases) shows those,
 * named "<pipeline> · <phase>"; otherwise the build itself is one phase. At most 20.
 */
export function gateToPhases(gate: FgGate): CiPhase[] {
  const phases: CiPhase[] = [];
  for (const build of Array.isArray(gate.builds) ? gate.builds : []) {
    const name = text(build?.pipelineName, "build");
    const url = safeHref(build?.runUrl) ?? undefined;
    const streamed = (build?.tests as { phases?: unknown } | null | undefined)?.phases;
    if (Array.isArray(streamed) && streamed.length > 0) {
      for (const p of streamed as Array<{ phase?: unknown; status?: unknown }>) {
        phases.push({ name: `${name} · ${text(p?.phase, "phase")}`, status: phaseStatus(p?.status), ...(url ? { url } : {}) });
      }
    } else {
      phases.push({ name, status: phaseStatus(build?.status), ...(url ? { url } : {}) });
    }
  }
  return phases.slice(0, 20);
}

export function gateToCi(itemId: string, sha: string, gate: FgGate, at: string): CiMessage {
  return { type: "ci", itemId, available: true, sha, summary: SUMMARY[gate.status] ?? "CI status unknown", phases: gateToPhases(gate), at };
}

export interface FgApiConfig { baseUrl: string; token: string; fetch?: typeof fetch; timeoutMs?: number }

/** One gate read. Throws on HTTP errors, malformed bodies and after timeoutMs (default 5 s). */
export async function fetchFgGate(config: FgApiConfig, app: string, sha: string): Promise<FgGate> {
  const doFetch = config.fetch ?? fetch;
  const base = config.baseUrl.replace(/\/+$/, "");
  const response = await doFetch(`${base}/api/fg/ci/gate?app=${encodeURIComponent(app)}&sha=${encodeURIComponent(sha)}`, {
    headers: { authorization: `Bearer ${config.token}`, accept: "application/json" },
    signal: AbortSignal.timeout(config.timeoutMs ?? FG_TIMEOUT_MS),
    // The bearer token must never follow a redirect to another origin: 3xx is "unavailable".
    redirect: "manual",
  });
  if (!response.ok) throw new Error(`ForgeGraph gate failed: HTTP ${response.status}`);
  const body = (await response.json()) as Partial<FgGate> | null;
  if (!body || !["pass", "pending", "fail", "none"].includes(body.status as string)) throw new Error("ForgeGraph gate: unexpected body");
  return { status: body.status as FgGate["status"], builds: Array.isArray(body.builds) ? body.builds : [] };
}

export interface ForgejoConfig { instanceUrl: string; token: string; fetch?: typeof fetch; timeoutMs?: number }

/**
 * The ForgeGraph app bound to owner/repo, from the repo's `.forgegraph.yaml` `app:` line
 * (the mapping resolveFgAppSlug in @bob/api's trackDeployments uses). Null when there is
 * none or Forgejo cannot be read.
 */
export async function fetchForgegraphApp(config: ForgejoConfig, fullSlug: string): Promise<string | null> {
  const doFetch = config.fetch ?? fetch;
  const base = config.instanceUrl.replace(/\/+$/, "");
  const [owner, repo] = fullSlug.split("/");
  if (!owner || !repo) return null;
  try {
    const response = await doFetch(`${base}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/.forgegraph.yaml`, {
      headers: { authorization: `token ${config.token}`, accept: "application/json" },
      signal: AbortSignal.timeout(config.timeoutMs ?? FG_TIMEOUT_MS),
      redirect: "manual", // never forward the Forgejo token; a 3xx reads as "no app"
    });
    if (!response.ok) return null;
    const file = (await response.json()) as { content?: string };
    if (!file.content) return null;
    const yaml = atob(file.content.replace(/\n/g, ""));
    return /^\s*app:\s*["']?([A-Za-z0-9._-]+)["']?\s*$/m.exec(yaml)?.[1] ?? null;
  } catch {
    return null;
  }
}

export interface FgCiSourceOptions {
  /** Undefined when FG_API_TOKEN is not set: every item then reads "live detail unavailable". */
  fetchGate?: (app: string, sha: string) => Promise<FgGate>;
  /** owner/repo → app slug; undefined when no Forgejo token is set (no app can be found). */
  resolveApp?: (fullSlug: string) => Promise<string | null>;
  now?: () => number;
}

/**
 * CI detail for one item, with the gate cached FG_CACHE_MS per app + sha (a failed read is
 * cached too, so a down ForgeGraph is asked at most once per window) and the app mapping
 * cached ten minutes per repo. In memory only.
 */
export class FgCiSource {
  private readonly gates = new Map<string, { at: number; gate: FgGate | null }>();
  private readonly apps = new Map<string, { at: number; app: string | null }>();
  private readonly now: () => number;
  constructor(private readonly options: FgCiSourceOptions) {
    this.now = options.now ?? Date.now;
  }

  async message(item: ItemSnapshot, plan: PlanSnapshot | undefined, topology: TopologyRepo[]): Promise<CiMessage> {
    const at = new Date(this.now()).toISOString();
    const off = (reason: string): CiMessage => ({ type: "ci", itemId: item.itemId, available: false, reason, at });
    const sha = commitShaOf(item);
    if (!sha) return off(CI_REASONS.noCommit);
    const repository = item.execution?.target.repository ?? plan?.definition.items.find((d) => d.itemId === item.itemId)?.target.repository;
    const slug = repository ? fullRepoSlug(repository, topology) : null;
    const app = slug ? await this.app(slug) : null;
    if (!app) return off(CI_REASONS.noApp);
    const gate = await this.gate(app, sha);
    return gate ? gateToCi(item.itemId, sha, gate, at) : off(CI_REASONS.unavailable);
  }

  private async app(slug: string): Promise<string | null> {
    const key = slug.toLowerCase();
    const hit = this.apps.get(key);
    if (hit && this.now() - hit.at < APP_CACHE_MS) return hit.app;
    if (!this.options.resolveApp) return null;
    const app = await this.options.resolveApp(slug).catch(() => null);
    remember(this.apps, key, { at: this.now(), app });
    return app;
  }

  private async gate(app: string, sha: string): Promise<FgGate | null> {
    const key = `${app}@${sha}`;
    const hit = this.gates.get(key);
    if (hit && this.now() - hit.at < FG_CACHE_MS) return hit.gate;
    if (!this.options.fetchGate) return null;
    let gate: FgGate | null;
    try { gate = await this.options.fetchGate(app, sha); } catch { gate = null; }
    remember(this.gates, key, { at: this.now(), gate });
    return gate;
  }
}

function remember<V>(map: Map<string, V>, key: string, value: V) {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_CACHE_ENTRIES) map.delete(map.keys().next().value!);
}

/** The env FgCiSource reads in the DO. FG_API_TOKEN / FG_API_URL are the names the cockpit and deploy tracker use. */
export interface FgEnv {
  FG_API_TOKEN?: string;
  FG_API_URL?: string;
  BOB_FORGEJO_TOKEN?: string;
  BOB_FORGEJO_INSTANCE_URL?: string;
}

export function fgCiSourceFromEnv(env: FgEnv): FgCiSource {
  const fgToken = env.FG_API_TOKEN, forgejoToken = env.BOB_FORGEJO_TOKEN;
  return new FgCiSource({
    fetchGate: fgToken ? (app, sha) => fetchFgGate({ baseUrl: env.FG_API_URL || "https://forgegraf.com", token: fgToken }, app, sha) : undefined,
    resolveApp: forgejoToken ? (slug) => fetchForgegraphApp({ instanceUrl: env.BOB_FORGEJO_INSTANCE_URL || "https://git.forgegraf.com", token: forgejoToken }, slug) : undefined,
  });
}
