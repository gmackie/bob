/**
 * The phone's list of sessions.
 *
 * The gateway's workspace snapshot lists every session, live or finished, but
 * on the phone the only place it surfaced was the "Running now" work-item
 * section on Home, which links to work items rather than to the sessions
 * themselves. A person checking in from the road wants the sessions grouped by
 * what they need: the ones paused on a decision first, then the ones going,
 * then what finished recently.
 */

import type { Href } from "expo-router";

import type { SessionSummaryTone } from "./session-summary-model";
import { getSessionHref } from "~/features/planning/navigation";
import { formatStatusLabel } from "~/features/tablet/queue";
import { timestampToMillis } from "~/lib/timestamps";
import {
  formatRelative,
  isActiveSessionStatus,
  toneForStatus,
} from "./session-summary-model";

export interface SessionListInput {
  sessionId: string;
  status: string;
  agentType?: string | null;
  sessionType?: string | null;
  title?: string | null;
  lastActivityAt?: string | null;
  workItemId?: string | null;
  workItemIdentifier?: string | null;
}

export type SessionListSectionKey = "needs_you" | "running" | "finished";

export interface SessionListRow {
  sessionId: string;
  title: string;
  identifier: string | null;
  agentLabel: string;
  statusLabel: string;
  tone: SessionSummaryTone;
  lastActivityLabel: string;
  href: Extract<Href, string>;
  accessibilityLabel: string;
}

export interface SessionListSection {
  key: SessionListSectionKey;
  title: string;
  rows: SessionListRow[];
  total: number;
}

export interface SessionList {
  sections: SessionListSection[];
  isEmpty: boolean;
  needsYouCount: number;
  runningCount: number;
}

const SECTION_TITLES: Record<SessionListSectionKey, string> = {
  needs_you: "Needs you",
  running: "Running now",
  finished: "Finished",
};

export const FINISHED_SESSION_LIMIT = 30;

function isPlanningSession(session: SessionListInput): boolean {
  if (session.sessionType === "planning") return true;
  if (session.sessionType === "execution") return false;
  const agentType = (session.agentType ?? "").toLowerCase();
  return agentType.includes("plan");
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : null;
}

function toMillis(value: string | null | undefined): number {
  return timestampToMillis(value) ?? 0;
}

export function buildSessionListRow(
  session: SessionListInput,
  options: { now?: Date; workspaceId?: string | null } = {},
): SessionListRow {
  const now = options.now ?? new Date();
  const identifier = nonEmpty(session.workItemIdentifier);
  const title =
    nonEmpty(session.title) ??
    identifier ??
    `Session ${session.sessionId.slice(0, 8)}`;
  const agentLabel = formatStatusLabel(session.agentType ?? "agent");
  const statusLabel = formatStatusLabel(session.status);
  const activity = toMillis(session.lastActivityAt);
  const lastActivityLabel =
    activity > 0 ? formatRelative(activity, now.getTime()) : "No activity";
  return {
    sessionId: session.sessionId,
    title,
    identifier,
    agentLabel,
    statusLabel,
    tone: toneForStatus(session.status),
    lastActivityLabel,
    href: getSessionHref(session.sessionId, options.workspaceId),
    accessibilityLabel: `${title}, ${statusLabel}, ${agentLabel}, ${lastActivityLabel}`,
  };
}

export function buildSessionList(
  sessions: readonly SessionListInput[],
  options: {
    now?: Date;
    workspaceId?: string | null;
    finishedLimit?: number;
  } = {},
): SessionList {
  const finishedLimit = options.finishedLimit ?? FINISHED_SESSION_LIMIT;
  // Freshest first everywhere: on a phone the top of the list is what gets read.
  const execution = sessions
    .filter((session) => !isPlanningSession(session))
    .sort((a, b) => toMillis(b.lastActivityAt) - toMillis(a.lastActivityAt));

  const needsYou = execution.filter(
    (s) => toneForStatus(s.status) === "attention",
  );
  const running = execution.filter(
    (s) =>
      toneForStatus(s.status) !== "attention" &&
      isActiveSessionStatus(s.status),
  );
  const finished = execution.filter((s) => !isActiveSessionStatus(s.status));

  const toRows = (items: SessionListInput[]) =>
    items.map((session) => buildSessionListRow(session, options));

  const allSections: SessionListSection[] = [
    {
      key: "needs_you",
      title: SECTION_TITLES.needs_you,
      rows: toRows(needsYou),
      total: needsYou.length,
    },
    {
      key: "running",
      title: SECTION_TITLES.running,
      rows: toRows(running),
      total: running.length,
    },
    {
      key: "finished",
      title: SECTION_TITLES.finished,
      rows: toRows(finished.slice(0, finishedLimit)),
      total: finished.length,
    },
  ];
  const sections = allSections.filter((section) => section.total > 0);

  return {
    sections,
    isEmpty: sections.length === 0,
    needsYouCount: needsYou.length,
    runningCount: running.length,
  };
}
