import type { Href } from "expo-router";

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
    identifier: identifier?.length ? identifier : item.id.slice(0, 8),
    title: title?.length ? title : "Untitled",
    status: item.status,
    statusLabel: STATUS_LABELS[item.status] ?? item.status,
    tone: TONES[item.status] ?? "muted",
    href: `/work-items/${item.id}`,
  };
}

function section(
  key: HomeSectionKey,
  items: HomeWorkItemInput[],
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
  input: { workItems: HomeWorkItemInput[] },
  options: { limit?: number } = {},
): HomeTriage {
  const limit = options.limit ?? HOME_SECTION_LIMIT;
  const items = input.workItems;

  const needsYou = items.filter((i) => NEEDS_YOU.has(i.status));
  const running = items.filter((i) => i.status === "running");
  const upNext = items.filter((i) => i.status === "queued");

  const sections = [
    section("needs_you", needsYou, limit),
    section("running", running, limit),
    section("up_next", upNext, limit),
  ].filter((s) => s.total > 0);

  return {
    sections,
    isAllClear: sections.length === 0,
    needsYouCount: needsYou.length,
  };
}
