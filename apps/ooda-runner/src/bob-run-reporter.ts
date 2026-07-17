/**
 * Reports runner work to the Bob backend via its public run API so runs are
 * monitorable (status) and reviewable (streamed output) in the Bob dashboard.
 *
 * This is best-effort and MUST NOT affect execution: every call is wrapped so a
 * reporting failure (network, auth, bob down) only logs a warning and never
 * throws into the runner's hot path.
 *
 * REST contract (see apps/bob/src/app/api/v1/runs):
 *   POST  /api/v1/runs                  { workItemId, workspaceId, agentType, agentConfig? } -> { id }
 *   PATCH /api/v1/runs/:runId           { status, summary? }
 *   POST  /api/v1/runs/:runId/artifacts { type, storageKey, metadata? }
 * Auth: Authorization: Bearer <bob api key>.
 */

export interface BobRunReporterConfig {
  /** Base URL of the Bob app, e.g. https://bob.blder.bot */
  baseUrl?: string;
  /** Bob API key (bob_live_...) with write permission */
  apiKey?: string;
  /** Bob workspace id to record runs under */
  workspaceId?: string;
}

export interface BobHeartbeatInput {
  agentTypes?: string[];
  capabilities?: string[];
  runtime?: {
    execution?: Record<string, unknown>;
    t3code?: Record<string, unknown>;
  };
}

/** Keep inline log payloads bounded — full output is tailed, not unbounded. */
const MAX_LOG_CHARS = 60_000;

export class BobRunReporter {
  private readonly baseUrl: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly workspaceId: string | undefined;
  readonly enabled: boolean;

  constructor(config: BobRunReporterConfig) {
    this.baseUrl = config.baseUrl?.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.workspaceId = config.workspaceId;
    this.enabled = Boolean(this.baseUrl && this.apiKey && this.workspaceId);
    if (!this.enabled) {
      console.log(
        "[bob-report] disabled (set BOB_API_URL, BOB_API_KEY, BOB_WORKSPACE_ID to enable)",
      );
    }
  }

  private async call(
    method: "POST" | "PATCH",
    path: string,
    body: unknown,
  ): Promise<any | null> {
    if (!this.enabled) return null;
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn(`[bob-report] ${method} ${path} -> ${res.status}`);
        return null;
      }
      return await res.json().catch(() => ({}));
    } catch (err) {
      console.warn(`[bob-report] ${method} ${path} failed:`, err);
      return null;
    }
  }

  /**
   * Open a run and mark it running. Returns the bob run id, or null if
   * reporting is disabled or the call failed (callers treat null as a no-op).
   */
  async startRun(input: {
    workItemId: string;
    agentType: string;
    title?: string;
    agentConfig?: Record<string, unknown>;
  }): Promise<string | null> {
    if (!this.enabled) return null;
    const created = await this.call("POST", "/api/v1/runs", {
      workItemId: input.workItemId,
      workspaceId: this.workspaceId,
      agentType: input.agentType,
      agentConfig: { title: input.title, ...input.agentConfig },
    });
    const runId: string | undefined = created?.id;
    if (!runId) return null;
    await this.call("PATCH", `/api/v1/runs/${runId}`, { status: "running" });
    return runId;
  }

  /**
   * Attach the current output as a `log` artifact so it's reviewable mid-run.
   * Output is stored inline in artifact metadata (tailed to MAX_LOG_CHARS) so
   * no blob storage is required.
   */
  async pushLog(runId: string | null, output: string): Promise<void> {
    if (!runId || !this.enabled || !output) return;
    const tail =
      output.length > MAX_LOG_CHARS ? output.slice(-MAX_LOG_CHARS) : output;
    await this.call("POST", `/api/v1/runs/${runId}/artifacts`, {
      type: "log",
      storageKey: `inline:${runId}:log`,
      metadata: { content: tail, truncated: output.length > MAX_LOG_CHARS },
    });
  }

  /** Publish node/runtime status to Bob so the dashboard can monitor capacity. */
  async heartbeat(input: BobHeartbeatInput): Promise<void> {
    if (!this.enabled) return;
    await this.call(
      "POST",
      `/api/v1/workspaces/${this.workspaceId}/heartbeat`,
      input,
    );
  }

  /** Attach a unified diff as a `diff` artifact (inline in metadata). */
  async pushDiff(runId: string | null, diff: string): Promise<void> {
    if (!runId || !this.enabled || !diff) return;
    const tail = diff.length > MAX_LOG_CHARS ? diff.slice(-MAX_LOG_CHARS) : diff;
    await this.call("POST", `/api/v1/runs/${runId}/artifacts`, {
      type: "diff",
      storageKey: `inline:${runId}:diff`,
      metadata: { content: tail, truncated: diff.length > MAX_LOG_CHARS },
    });
  }

  /** Close the run with a terminal status and a short summary. */
  async finishRun(
    runId: string | null,
    status: "completed" | "failed",
    summary?: Record<string, unknown>,
  ): Promise<void> {
    if (!runId || !this.enabled) return;
    await this.call("PATCH", `/api/v1/runs/${runId}`, { status, summary });
  }
}

/** Build a reporter from the standard runner env vars. */
export function bobRunReporterFromEnv(): BobRunReporter {
  return new BobRunReporter({
    baseUrl: process.env.BOB_API_URL,
    apiKey: process.env.BOB_API_KEY,
    workspaceId: process.env.BOB_WORKSPACE_ID,
  });
}
