export interface EnvironmentFleetWorkspace {
  id: string;
  name?: string | null;
  slug: string;
  machineId?: string | null;
  lastHeartbeat?: Date | string | null;
  agentConfigs?: Record<string, unknown> | null;
}

export interface EnvironmentFleetRepository {
  id: string;
  workspaceId?: string | null;
  dirty?: boolean | null;
  stale?: boolean | null;
}

export interface EnvironmentFleetRun {
  id: string;
  workspaceId?: string | null;
  status?: string | null;
}

export type EnvironmentStatus = "online" | "offline";

export interface EnvironmentFleetRow {
  id: string;
  name: string;
  slug: string;
  machineId: string;
  href: string;
  status: EnvironmentStatus;
  statusLabel: "Online" | "Offline";
  runtimeLabel: "T3 control plane" | "Bob native" | "T3 + Bob";
  lastSeenLabel: string;
  lastHeartbeatMs: number;
  providerCount: number;
  readyProviders: number;
  repositoryCount: number;
  activeRunCount: number;
  failedRunCount: number;
  attentionCount: number;
}

const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "provisioning",
  "starting",
  "running",
  "blocked",
  "host_unknown",
]);

const FAILED_RUN_STATUSES = new Set(["failed", "error", "interrupted"]);
const ONLINE_WINDOW_MS = 5 * 60 * 1_000;

function parseHeartbeat(value: Date | string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function formatLastSeen(timestamp: number, nowMs: number): string {
  if (!Number.isFinite(timestamp)) return "Never connected";
  const elapsed = Math.max(0, nowMs - timestamp);
  if (elapsed < 60_000) return "Seen just now";
  if (elapsed < 3_600_000) return `Seen ${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000)
    return `Seen ${Math.floor(elapsed / 3_600_000)}h ago`;
  return `Seen ${Math.floor(elapsed / 86_400_000)}d ago`;
}

function getAgentConfig(config: unknown): Record<string, unknown> {
  return typeof config === "object" && config !== null
    ? (config as Record<string, unknown>)
    : {};
}

function getRuntimeLabel(
  agentConfigs: Record<string, unknown> | null | undefined,
): EnvironmentFleetRow["runtimeLabel"] {
  const runtimes = new Set(
    Object.values(agentConfigs ?? {}).map((config) => {
      const runtime = getAgentConfig(config).runtime;
      return runtime === "t3" ? "t3" : "bob";
    }),
  );
  if (runtimes.has("t3") && runtimes.has("bob")) return "T3 + Bob";
  return runtimes.has("t3") ? "T3 control plane" : "Bob native";
}

function isProviderReady(config: unknown): boolean {
  return getAgentConfig(config).available !== false;
}

export function buildEnvironmentFleet(input: {
  environments: EnvironmentFleetWorkspace[];
  repositories: EnvironmentFleetRepository[];
  runs: EnvironmentFleetRun[];
  now?: Date;
}) {
  const nowMs = (input.now ?? new Date()).getTime();
  const environments = input.environments
    .map((environment): EnvironmentFleetRow => {
      const lastHeartbeatMs = parseHeartbeat(environment.lastHeartbeat);
      const online = nowMs - lastHeartbeatMs < ONLINE_WINDOW_MS;
      const repositories = input.repositories.filter(
        (repository) => repository.workspaceId === environment.id,
      );
      const runs = input.runs.filter(
        (run) => run.workspaceId === environment.id,
      );
      const activeRunCount = runs.filter((run) =>
        ACTIVE_RUN_STATUSES.has(run.status ?? ""),
      ).length;
      const failedRunCount = runs.filter((run) =>
        FAILED_RUN_STATUSES.has(run.status ?? ""),
      ).length;
      const providers = Object.values(environment.agentConfigs ?? {});
      const unavailableProviderCount = providers.filter(
        (provider) => !isProviderReady(provider),
      ).length;
      const repositoryAttentionCount = repositories.filter(
        (repository) => repository.dirty || repository.stale,
      ).length;
      const machineId = environment.machineId || environment.slug;

      return {
        id: environment.id,
        name: environment.name || machineId,
        slug: environment.slug,
        machineId,
        href: `/nodes/${encodeURIComponent(machineId)}`,
        status: online ? "online" : "offline",
        statusLabel: online ? "Online" : "Offline",
        runtimeLabel: getRuntimeLabel(environment.agentConfigs),
        lastSeenLabel: formatLastSeen(lastHeartbeatMs, nowMs),
        lastHeartbeatMs,
        providerCount: providers.length,
        readyProviders: providers.filter(isProviderReady).length,
        repositoryCount: repositories.length,
        activeRunCount,
        failedRunCount,
        attentionCount:
          (online ? 0 : 1) +
          unavailableProviderCount +
          repositoryAttentionCount +
          failedRunCount,
      };
    })
    .sort((left, right) => right.lastHeartbeatMs - left.lastHeartbeatMs);

  return {
    environments,
    summary: {
      total: environments.length,
      online: environments.filter(
        (environment) => environment.status === "online",
      ).length,
      activeRuns: environments.reduce(
        (total, environment) => total + environment.activeRunCount,
        0,
      ),
      needsAttention: environments.filter(
        (environment) => environment.attentionCount > 0,
      ).length,
    },
  };
}
