/**
 * The agent lights, as a phone shows them.
 *
 * The point of this screen is watching state change while a run is going —
 * seeing a light go green on its own. So the model is honest about three
 * things a person reads at a glance: is the host reporting at all, is each
 * agent usable, and is work actually moving.
 *
 * The status → meaning rules come from @bob/ws's shared provider-health model
 * rather than a copy, so this screen, the web dashboard and the tablet cockpit
 * cannot disagree about the same agent.
 */

import { buildHostMissionControl } from "@bob/ws";
import type { HostSnapshotWire } from "@bob/ws";

/**
 * Amber is "you can fix this" — sign in, top up, wait out a quota. Grey is
 * "nothing to act on here" — not installed, or the host has gone quiet.
 * Collapsing the two is how a person stops reading the colour at all.
 */
export type LightTone = "green" | "amber" | "grey";

export interface AgentLight {
  provider: string;
  label: string;
  statusLabel: string;
  tone: LightTone;
  /** The provider's own words. Without them "Out of credit" is not actionable. */
  detail?: string;
  version?: string;
}

export interface NodeLights {
  hostId: string | null;
  lights: AgentLight[];
  allReady: boolean;
  /** True when the host has stopped reporting, or has never reported. */
  isStale: boolean;
  activityLabel: string;
}

/**
 * The daemon heartbeats roughly every 30s, so a snapshot older than 90s means
 * several were missed. A frozen light is worse than no light: it claims
 * "green" about a host that stopped answering minutes ago.
 */
const STALE_AFTER_MS = 90_000;

function toneFor(status: string, stale: boolean): LightTone {
  if (stale) return "grey";
  if (status === "ready") return "green";
  // Everything with a remedy a person can act on.
  if (status === "unauthenticated" || status === "no_credit" || status === "rate_limited") {
    return "amber";
  }
  return "grey";
}

export function buildNodeLights(
  snapshot: HostSnapshotWire | null,
  options: { activeRunCount: number; now?: Date },
): NodeLights {
  const now = options.now ?? new Date();
  const activityLabel =
    options.activeRunCount > 0 ? `${options.activeRunCount} running` : "Idle";

  // No snapshot yet is not the same as "all fine" — say so rather than
  // rendering an empty green screen.
  if (!snapshot) {
    return { hostId: null, lights: [], allReady: false, isStale: true, activityLabel };
  }

  const checkedAt = Date.parse(snapshot.checkedAt);
  const isStale =
    !Number.isFinite(checkedAt) || now.getTime() - checkedAt > STALE_AFTER_MS;

  const model = buildHostMissionControl(snapshot, now);

  return {
    hostId: snapshot.hostId,
    lights: model.providers.map((provider) => ({
      provider: provider.provider,
      label: provider.label,
      statusLabel: provider.statusLabel,
      tone: toneFor(provider.status, isStale),
      detail: provider.detail,
      version: provider.version,
    })),
    allReady:
      !isStale &&
      model.providers.length > 0 &&
      model.providers.every((p) => p.status === "ready"),
    isStale,
    activityLabel,
  };
}
