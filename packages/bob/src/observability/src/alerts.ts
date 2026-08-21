export type AlertSeverity = "critical" | "high" | "warning";

export interface ObservabilityAlertDefinition {
  id: string;
  name: string;
  service: string;
  surface: "api" | "job" | "gateway" | "infra";
  severity: AlertSeverity;
  description: string;
  /** Sentry issue tag used when capturing matching failures. */
  sentryTag: string;
  /** PostHog event name emitted on matching failures. */
  posthogEvent: string;
  /** Guidance for on-call / Sentry alert rule configuration. */
  runbook: string;
}

export const OBSERVABILITY_ALERTS: readonly ObservabilityAlertDefinition[] = [
  {
    id: "api-trpc-5xx",
    name: "API tRPC 5xx failures",
    service: "bob-api",
    surface: "api",
    severity: "critical",
    description:
      "Server-side tRPC procedures returning HTTP 5xx. Indicates unhandled exceptions in API handlers.",
    sentryTag: "surface:api",
    posthogEvent: "critical_api_failure",
    runbook:
      "Inspect Sentry issues tagged surface:api. Check recent deploys and database connectivity.",
  },
  {
    id: "gateway-persistence-failure",
    name: "Gateway session persistence failures",
    service: "bob-ws-gateway",
    surface: "gateway",
    severity: "critical",
    description:
      "ws-gateway failed to persist session events to Postgres. Real-time session history may be incomplete.",
    sentryTag: "surface:gateway",
    posthogEvent: "critical_gateway_failure",
    runbook:
      "Verify DATABASE_URL, gateway disk/memory, and Postgres connection pool. Replay may be needed for lost events.",
  },
  {
    id: "gateway-auth-failure-spike",
    name: "Gateway auth validation failures",
    service: "bob-ws-gateway",
    surface: "gateway",
    severity: "high",
    description:
      "Repeated daemon or browser auth rejections at the WebSocket gateway.",
    sentryTag: "surface:gateway",
    posthogEvent: "critical_gateway_failure",
    runbook:
      "Check NUDGE_SHARED_SECRET rotation, BOB_API_KEY validity, and AUTH_BASE_URL reachability.",
  },
  {
    id: "job-session-failure",
    name: "Execution session failures",
    service: "bob-execution",
    surface: "job",
    severity: "critical",
    description:
      "Agent execution daemon failed to run or complete a dispatched session.",
    sentryTag: "surface:job",
    posthogEvent: "critical_job_failure",
    runbook:
      "Inspect executor logs for sessionId/workspaceId. Verify GATEWAY_WS_URL, working directory, and agent CLI availability.",
  },
  {
    id: "job-gateway-disconnect",
    name: "Execution gateway disconnect",
    service: "bob-execution",
    surface: "job",
    severity: "high",
    description:
      "Execution daemon lost its WebSocket connection to ws-gateway.",
    sentryTag: "surface:job",
    posthogEvent: "critical_job_failure",
    runbook:
      "Check ws-gateway health (/health), network path, and executor reconnect logs.",
  },
  {
    id: "auto-drain-failure",
    name: "Autonomous backlog drain failures",
    service: "bob-worker",
    surface: "job",
    severity: "high",
    description:
      "Cloudflare cron auto-drain failed to dispatch ready work items.",
    sentryTag: "surface:job",
    posthogEvent: "critical_job_failure",
    runbook:
      "Review worker scheduled handler logs, BOB_AUTO_DRAIN_ENABLED, and database/Hyperdrive bindings.",
  },
  {
    id: "auto-merge-auth-failure",
    name: "Auto-merge git-host auth failure (silent dead loop)",
    service: "bob-worker",
    surface: "job",
    severity: "high",
    description:
      "The auto-merge reaper is failing git-host auth (401/403) on most or all scanned PRs — the review→repair→merge loop is effectively dead while the cron keeps firing. Distinguishes a revoked/expired shared Forgejo token from ordinary per-PR skips, which otherwise look identical in the [auto-merge] counters.",
    sentryTag: "surface:job",
    posthogEvent: "critical_job_failure",
    runbook:
      "The BOB_FORGEJO_TOKEN (and/or BOB_REVIEW_FORGEJO_TOKEN) worker secret is likely revoked/expired. Verify against git.forgegraf.com, rotate via `wrangler secret put`, and update the hetzner-bob runner git auth. See ForgeGraph docs/ops/2026-07-29-forgejo-token-revocation-bob-dispatch-outage.md.",
  },
  {
    id: "session-reap-spike",
    name: "Stuck-session reap spike (runner failing to claim work)",
    service: "bob-worker",
    surface: "job",
    severity: "high",
    description:
      "The stuck-session reaper cleared an abnormal number of sessions in a single cron tick. Steady-state reaps 0; a spike means many sessions went dead at once — typically a runner crashed, restarted, or (as in the 2026-07-29 outage) kept dispatching-but-never-claiming while its git auth was broken. Early warning that a runner is unhealthy, before the backlog visibly starves.",
    sentryTag: "surface:job",
    posthogEvent: "critical_job_failure",
    runbook:
      "Check runner_leases.last_heartbeat_at for stale/restarted runners, and the hetzner-bob/vanuc ooda-runner services. The reaped sessions are tagged last_error.code='reaped_stuck_session'; group them by workspace/agent_type to find which runner failed. See [[bob-runner-dispatch-ops]] and the 2026-07-29 token-outage ops note.",
  },
  {
    id: "auto-drain-starved",
    name: "Autonomous dispatch starved (work waiting, slots free, nothing running)",
    service: "bob-worker",
    surface: "job",
    severity: "high",
    description:
      "Dispatchable work items exist, the daily cap has headroom and runner slots are free, yet no execute run has started for over the window (default 2h). The cron counters look healthy in this state; every 2026-08-21 outage (read-only worktree volume, revoked git token, permission-parked agents, sessions stuck pending) presented exactly like this.",
    sentryTag: "surface:job",
    posthogEvent: "critical_job_failure",
    runbook:
      "Check the newest chat_conversations rows: are sessions being created at all (worker/auto-drain) and are they being claimed (ws-gateway daemonCount, ooda-runner on hetzner-bob)? Look at last_error on the most recent error/failed sessions — EROFS, 401 on git push, and 'blocked' with no awaiting-input question are the known shapes. See [[bob-sdlc-kanbanger-loop]].",
  },
  {
    id: "linear-sync-stale",
    name: "Tracker (Linear/Kanbanger) sync stale — queue not being fed",
    service: "bob-worker",
    surface: "job",
    severity: "high",
    description:
      "The 15-minute tracker sync has not completed successfully for over an hour for an enabled Linear/Kanbanger integration. New Todo cards stop reaching Bob and auto-drain starves while the tracker fills up — the 2026-08-14 Kanbanger API outage went unnoticed for 6 days because the sync threw every tick and nothing alerted.",
    sentryTag: "surface:job",
    posthogEvent: "critical_job_failure",
    runbook:
      "Check workspace_integrations.last_sync_result for the captured error. Probe the tracker: `{ issues(first:1){ nodes { id } } }` against linear_api_url with the stored key. If the API 500s on list resolvers but `viewer` works, redeploy the tasks.gmac.io worker (2026-08-21 fix). If the key is rejected, rotate it in Settings → Integrations.",
  },
] as const;

export function getAlertsForSurface(
  surface: ObservabilityAlertDefinition["surface"],
): ObservabilityAlertDefinition[] {
  return OBSERVABILITY_ALERTS.filter((alert) => alert.surface === surface);
}

export function getAlertById(id: string): ObservabilityAlertDefinition | undefined {
  return OBSERVABILITY_ALERTS.find((alert) => alert.id === id);
}
