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
] as const;

export function getAlertsForSurface(
  surface: ObservabilityAlertDefinition["surface"],
): ObservabilityAlertDefinition[] {
  return OBSERVABILITY_ALERTS.filter((alert) => alert.surface === surface);
}

export function getAlertById(id: string): ObservabilityAlertDefinition | undefined {
  return OBSERVABILITY_ALERTS.find((alert) => alert.id === id);
}
