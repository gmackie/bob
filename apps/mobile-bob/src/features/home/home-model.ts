import type { Href } from "expo-router";
import type { HostSnapshotWire } from "@bob/ws";
import { buildProxyPanel } from "@bob/ws";

/**
 * Phone home: triage.
 *
 * home-mode-model already specified this — `defaultPhoneTab` returns "inbox"
 * with the note "Phone home is always triage, regardless of mode" — but
 * getAuthenticatedHomeHref hardcoded "/chat", so the phone opened on a
 * conversation instead of on what needs attention.
 *
 * The ordering follows what the notification defaults already treat as
 * push-worthy: items waiting on a person come first, then what is running, then
 * what is queued behind it.
 */

export type HomeSectionKey = "needs_you" | "running" | "up_next";
export type HomeTone = "danger" | "warning" | "accent" | "muted";

export interface HomeWorkItemInput {
  id: string;
  identifier?: string | null;
  title?: string | null;
  status: string;
  updatedAt?: string | Date | null;
}

export interface HomeRow {
  id: string;
  /**
   * A work item, or something about the machinery that stops work — an
   * unreachable inference proxy, a provider with no ready account. The latter
   * link to Nodes, not to a work item.
   */
  kind: "work_item" | "infrastructure";
  identifier: string;
  title: string;
  status: string;
  statusLabel: string;
  tone: HomeTone;
  href: Extract<Href, string>;
}

export interface HomeSection {
  key: HomeSectionKey;
  title: string;
  rows: HomeRow[];
  /** Rows beyond the display cap, so the header can say "+3 more". */
  overflowCount: number;
  total: number;
}

export interface HomeTriage {
  sections: HomeSection[];
  /** True when nothing anywhere needs attention — drives the empty state. */
  isAllClear: boolean;
  needsYouCount: number;
}

const SECTION_TITLES: Record<HomeSectionKey, string> = {
  needs_you: "Needs you",
  running: "Running now",
  up_next: "Up next",
};

const STATUS_LABELS: Record<string, string> = {
  blocked: "Blocked",
  in_review: "Review ready",
  failed: "Failed",
  running: "Running",
  queued: "Queued",
  planning: "Planning",
  done: "Done",
};

const TONES: Record<string, HomeTone> = {
  failed: "danger",
  blocked: "warning",
  in_review: "accent",
  running: "accent",
};

/** Statuses that mean a person is the blocker, not the agent. */
const NEEDS_YOU = new Set(["blocked", "in_review", "failed"]);

export const HOME_SECTION_LIMIT = 5;

function toMillis(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function toRow(item: HomeWorkItemInput): HomeRow {
  const identifier = item.identifier?.trim();
  const title = item.title?.trim();
  return {
    id: item.id,
    kind: "work_item",
    identifier: identifier?.length ? identifier : item.id.slice(0, 8),
    title: title?.length ? title : "Untitled",
    status: item.status,
    statusLabel: STATUS_LABELS[item.status] ?? item.status,
    tone: TONES[item.status] ?? "muted",
    href: `/work-items/${item.id}`,
  };
}

/**
 * Rows for the machinery that stops work. Derived from the same proxy
 * view-model the Nodes screen renders, so the phone's home and its Nodes page
 * agree on what counts as an outage. A stale snapshot yields nothing: an old
 * "unreachable" is not evidence of an outage now.
 */
function infrastructureRows(snapshot: HostSnapshotWire | null | undefined, now: Date): HomeRow[] {
  if (!snapshot) return [];
  const panel = buildProxyPanel(snapshot, now);
  if (!panel || panel.tone === "grey") return [];
  const rows: HomeRow[] = [];
  if (!panel.reachable) {
    rows.push({
      id: "proxy:unreachable",
      kind: "infrastructure",
      identifier: "Proxy",
      title: "Inference proxy unreachable — no run can be served",
      status: "proxy_unreachable",
      statusLabel: "Check proxy",
      tone: "danger",
      href: "/nodes",
    });
  }
  for (const provider of panel.providers) {
    if (provider.ready > 0) continue;
    rows.push({
      id: `proxy:${provider.provider}`,
      kind: "infrastructure",
      identifier: "Proxy",
      title: `${provider.label} has no ready account on the proxy`,
      status: "provider_no_ready_accounts",
      statusLabel: provider.cooling > 0 ? "Cooling down" : "Sign in",
      tone: "warning",
      href: "/nodes",
    });
  }
  return rows;
}

function section(
  key: HomeSectionKey,
  items: readonly HomeWorkItemInput[],
  limit: number,
): HomeSection {
  // Freshest first: on a phone the top of each list is all that gets read.
  const ordered = [...items].sort(
    (a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt),
  );
  return {
    key,
    title: SECTION_TITLES[key],
    rows: ordered.slice(0, limit).map(toRow),
    overflowCount: Math.max(0, ordered.length - limit),
    total: ordered.length,
  };
}

export function buildHomeTriage(
  input: { workItems: readonly HomeWorkItemInput[]; hostSnapshot?: HostSnapshotWire | null },
  options: { limit?: number; now?: Date } = {},
): HomeTriage {
  const limit = options.limit ?? HOME_SECTION_LIMIT;
  const now = options.now ?? new Date();
  const items = input.workItems;

  const needsYou = items.filter((i) => NEEDS_YOU.has(i.status));
  const running = items.filter((i) => i.status === "running");
  const upNext = items.filter((i) => i.status === "queued");

  // Machinery outages outrank any single work item: nothing below can move
  // until they are fixed, so they go first and are never cut by the cap.
  const infrastructure = infrastructureRows(input.hostSnapshot, now);
  const needsYouSection = section("needs_you", needsYou, limit);
  needsYouSection.rows = [...infrastructure, ...needsYouSection.rows];
  needsYouSection.total += infrastructure.length;

  const sections = [
    needsYouSection,
    section("running", running, limit),
    section("up_next", upNext, limit),
  ].filter((s) => s.total > 0);

  return {
    sections,
    isAllClear: sections.length === 0,
    needsYouCount: needsYou.length + infrastructure.length,
  };
}
