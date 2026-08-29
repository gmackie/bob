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

const PROVIDER_STATUS_LABELS: Record<string, string> = {
  ready: "Ready",
  unauthenticated: "Sign in required",
  no_credit: "Out of credit",
  degraded: "Degraded",
  unavailable: "Unavailable",
};

export type ProviderRemedy = "sign_in" | "top_up" | "install";

const PROVIDER_REMEDIES: Record<string, ProviderRemedy> = {
  unauthenticated: "sign_in",
  no_credit: "top_up",
  unavailable: "install",
};

/** Where an operator goes to add credit. Shown instead of a sign-in button. */
export const PROVIDER_BILLING_URLS: Record<string, string> = {
  claude: "https://claude.com/settings/billing",
  codex: "https://platform.openai.com/settings/organization/billing",
  grok: "https://console.x.ai",
  "cursor-agent": "https://cursor.com/settings",
};

export function buildHostMissionControl(snapshot: HostSnapshotWire, now = new Date()) {
  const checkedAt = Date.parse(snapshot.checkedAt);
  const online = Number.isFinite(checkedAt) && now.getTime() - checkedAt <= 90_000;
  // Mirrors providers/dispatch-gate.ts on the runner: dispatch is paused only
  // when EVERY provider is confirmed dead. An unrecognised status is uncertain,
  // never confirmation — a health bug must not read as "everything is down".
  const blocked = snapshot.providers.filter((p) => PROVIDER_REMEDIES[p.status]);
  const dispatchPaused =
    snapshot.providers.length > 0 && blocked.length === snapshot.providers.length;
  return {
    dispatchPaused,
    blockedProviders: blocked.map((p) => p.provider),
    hostId: snapshot.hostId,
    daemonVersion: snapshot.daemonVersion,
    statusLabel: online ? "Online" : "Stale",
    queueLabel: `${snapshot.queueDepth} active`,
    providers: snapshot.providers.map((provider) => ({
      provider: provider.provider,
      label: PROVIDER_LABELS[provider.provider] ?? provider.provider,
      version: provider.version,
      statusLabel: PROVIDER_STATUS_LABELS[provider.status] ?? "Unavailable",
      // The remedy, not just the state. Re-authenticating does not buy credit,
      // so an exhausted balance must never offer a "Sign in" button — that is
      // how an operator loops on the wrong action for a week.
      remedy: PROVIDER_REMEDIES[provider.status] ?? null,
      /** The provider's own wording, already redacted daemon-side. */
      detail: provider.detail,
      status: provider.status,
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
