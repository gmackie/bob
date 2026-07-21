export type MissionControlSection =
  | "provider-capacity"
  | "work-pipeline"
  | "running-now";

const MISSION_CONTROL_SECTIONS: MissionControlSection[] = [
  "provider-capacity",
  "work-pipeline",
  "running-now",
];

export function getMissionControlSections(): MissionControlSection[] {
  return [...MISSION_CONTROL_SECTIONS];
}

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  grok: "Grok",
  "cursor-agent": "Cursor",
};

export function buildHostMissionControl(snapshot: HostSnapshotWire, now = new Date()) {
  const checkedAt = Date.parse(snapshot.checkedAt);
  const online = Number.isFinite(checkedAt) && now.getTime() - checkedAt <= 90_000;
  return {
    hostId: snapshot.hostId,
    daemonVersion: snapshot.daemonVersion,
    statusLabel: online ? "Online" : "Stale",
    queueLabel: `${snapshot.queueDepth} active`,
    providers: snapshot.providers.map((provider) => ({
      provider: provider.provider,
      label: PROVIDER_LABELS[provider.provider] ?? provider.provider,
      version: provider.version,
      statusLabel:
        provider.status === "ready"
          ? "Ready"
          : provider.status === "unauthenticated"
            ? "Sign in required"
            : provider.status === "degraded"
              ? "Degraded"
              : "Unavailable",
      controls: [
        provider.capabilities.approval ? "approve" : null,
        provider.capabilities.followUp ? "follow-up" : null,
        provider.capabilities.resume ? "resume" : null,
        provider.capabilities.cancel ? "cancel" : null,
      ].filter((control): control is string => control !== null),
    })),
  };
}

export function buildHostMissionControlFromHeartbeat(
  workspace: { hostId: string; lastHeartbeat?: Date | string | null },
  now = new Date(),
) {
  const checkedAt = workspace.lastHeartbeat
    ? new Date(workspace.lastHeartbeat).getTime()
    : Number.NaN;
  const online = Number.isFinite(checkedAt) && now.getTime() - checkedAt <= 90_000;

  return {
    hostId: workspace.hostId,
    daemonVersion: undefined,
    statusLabel: online ? "Online" : "Stale",
    queueLabel: "Activity unavailable",
    providers: [],
  };
}
import type { HostSnapshotWire } from "@bob/ws";
