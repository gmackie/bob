/**
 * HTTP client for the ForgeGraph API (tasks.gmac.io).
 * Same structural pattern as planningRemoteConfig.ts.
 * Graceful degradation: returns `{ available: false }` when unreachable.
 */

type ForgeGraphEnv = NodeJS.ProcessEnv;

export function getForgeGraphBaseUrl(
  env: ForgeGraphEnv = process.env,
): string {
  return env.FORGEGRAPH_API_URL ?? "https://tasks.gmac.io/api/forgegraph";
}

export function getForgeGraphApiKey(
  env: ForgeGraphEnv = process.env,
): string | null {
  return env.FORGEGRAPH_API_KEY ?? env.PLANNING_API_KEY ?? null;
}

export type ForgeGraphResult<T> =
  | { available: true; data: T }
  | { available: false; error: string };

async function forgeGraphRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<ForgeGraphResult<T>> {
  const baseUrl = getForgeGraphBaseUrl();
  const apiKey = getForgeGraphApiKey();

  if (!apiKey) {
    return { available: false, error: "FORGEGRAPH_API_KEY not configured" };
  }

  const url = `${baseUrl}${path}`;
  const start = Date.now();

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000) as any,
    });

    const latency = Date.now() - start;
    console.log(
      `[forgegraph] ${method} ${path} → ${response.status} (${latency}ms)`,
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        available: false,
        error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as T;
    return { available: true, data };
  } catch (err) {
    const latency = Date.now() - start;
    const message =
      err instanceof Error ? err.message : "Unknown fetch error";
    console.warn(
      `[forgegraph] ${method} ${path} FAILED (${latency}ms): ${message}`,
    );
    return { available: false, error: message };
  }
}

// --- Typed API methods ---

export interface FGRepository {
  id: string;
  name: string;
  url: string;
  default_branch: string;
}

export interface FGRevision {
  id: string;
  task_id: string;
  commit_sha: string;
  branch: string;
  gates: FGGate[];
  created_at: string;
}

export interface FGGate {
  name: string;
  status: "pending" | "passed" | "failed" | "running";
  started_at?: string;
  finished_at?: string;
}

export interface FGBuild {
  id: string;
  revision_id: string;
  status: "queued" | "running" | "passed" | "failed" | "canceled";
  duration_ms?: number;
  artifact_url?: string;
  created_at: string;
}

export interface FGDeployment {
  id: string;
  revision_id: string;
  environment: string;
  status: "pending" | "deploying" | "healthy" | "unhealthy" | "rolled_back";
  revision_sha?: string;
  deployed_at?: string;
  updated_at: string;
}

export function listRepositories(workspaceId: string) {
  return forgeGraphRequest<FGRepository[]>(
    "GET",
    `/repositories?workspace_id=${encodeURIComponent(workspaceId)}`,
  );
}

export function listRevisions(params: {
  taskId?: string;
  workspaceId?: string;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params.taskId) qs.set("task_id", params.taskId);
  if (params.workspaceId) qs.set("workspace_id", params.workspaceId);
  if (params.limit) qs.set("limit", String(params.limit));
  return forgeGraphRequest<FGRevision[]>("GET", `/revisions?${qs}`);
}

export function getRevision(revisionId: string) {
  return forgeGraphRequest<FGRevision>(
    "GET",
    `/revisions/${encodeURIComponent(revisionId)}`,
  );
}

export function triggerBuild(params: {
  task_id: string;
  revision_id: string;
}) {
  return forgeGraphRequest<FGBuild>("POST", `/builds`, params);
}

export function listDeployments(params: {
  taskId?: string;
  environment?: string;
}) {
  const qs = new URLSearchParams();
  if (params.taskId) qs.set("task_id", params.taskId);
  if (params.environment) qs.set("environment", params.environment);
  return forgeGraphRequest<FGDeployment[]>("GET", `/deployments?${qs}`);
}

export function getDeploymentStatus(deploymentId: string) {
  return forgeGraphRequest<FGDeployment>(
    "GET",
    `/deployments/${encodeURIComponent(deploymentId)}`,
  );
}
