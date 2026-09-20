/**
 * The status strip at the bottom of the sidebar: one glance answers whether
 * the proxy is up, whether the agents are usable, and whether anything is
 * queued. Rendered on every page, so it must say "unknown" rather than
 * defaulting to green before the host has reported or after it goes quiet.
 *
 * Derived from the same @bob/ws models the Nodes page renders, so the strip
 * never disagrees with the page it links to.
 */

import type { HostSnapshotWire } from "@bob/ws";
import { buildHostMissionControl, buildProxyPanel } from "@bob/ws";

export type SidebarStatusTone = "green" | "amber" | "red" | "grey";

export interface SidebarStatusRow {
  label: "Proxy" | "Agents" | "Queue";
  value: string;
  tone: SidebarStatusTone;
}

export interface SidebarStatus {
  tone: SidebarStatusTone;
  headline: string;
  detail?: string;
  href: "/nodes";
  rows: SidebarStatusRow[];
}

/** Same threshold as the agent lights: several missed heartbeats. */
const STALE_AFTER_MS = 90_000;

export function buildSidebarStatus(snapshot: HostSnapshotWire | null, now = new Date()): SidebarStatus {
  if (!snapshot) {
    return {
      tone: "grey",
      headline: "No host reporting",
      detail: "Waiting for the runner's first heartbeat",
      href: "/nodes",
      rows: [],
    };
  }

  const checkedAt = Date.parse(snapshot.checkedAt);
  const stale = !Number.isFinite(checkedAt) || now.getTime() - checkedAt > STALE_AFTER_MS;
  const control = buildHostMissionControl(snapshot, now);
  const proxy = buildProxyPanel(snapshot, now);

  const total = control.providers.length;
  const ready = control.providers.filter((p) => p.status === "ready").length;
  const needsAttention = control.providers.filter((p) => p.remedy !== null).length;

  const rows: SidebarStatusRow[] = [];
  if (proxy) {
    rows.push({
      label: "Proxy",
      value: proxy.statusLabel,
      tone: proxy.tone,
    });
  }
  rows.push({
    label: "Agents",
    value: total === 0 ? "none reported" : `${ready} of ${total} ready`,
    tone: stale ? "grey" : total > 0 && ready === total ? "green" : ready > 0 ? "amber" : "red",
  });
  rows.push({
    label: "Queue",
    value: control.queueLabel,
    tone: stale ? "grey" : "green",
  });

  if (stale) {
    return {
      tone: "grey",
      headline: "Host stale",
      detail: `Last heartbeat ${control.statusLabel.toLowerCase()}; showing the last known state`,
      href: "/nodes",
      rows,
    };
  }
  if (proxy && !proxy.reachable) {
    return { tone: "red", headline: "Inference proxy unreachable", detail: "No run can be served", href: "/nodes", rows };
  }
  if (control.dispatchPaused) {
    return { tone: "red", headline: "Dispatch paused", detail: "Every agent is confirmed unavailable", href: "/nodes", rows };
  }
  if (needsAttention > 0) {
    return {
      tone: "amber",
      headline: `${needsAttention} agent${needsAttention === 1 ? "" : "s"} need${needsAttention === 1 ? "s" : ""} attention`,
      href: "/nodes",
      rows,
    };
  }
  if (proxy && proxy.alerts.length > 0) {
    return { tone: "amber", headline: proxy.alerts[0]!, href: "/nodes", rows };
  }
  return { tone: "green", headline: "All systems go", href: "/nodes", rows };
}
