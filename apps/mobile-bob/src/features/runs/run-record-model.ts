/**
 * A run record, for the runs that have no session to open.
 *
 * Work-item run rows linked to `/runs/<id>` for a run without a session, but
 * no such route existed: the tap did nothing on the tablet and the phone
 * showed "Recorded" and refused the tap. This reads `agent.run.get` into
 * something a person can look at: what happened, when, what the sweep said,
 * and any artifacts left behind.
 */

import type { SessionSummaryTone } from "~/features/sessions/session-summary-model";
import {
  formatElapsed,
  formatRelative,
  toneForStatus,
} from "~/features/sessions/session-summary-model";
import { formatStatusLabel } from "~/features/tablet/queue";
import { timestampToMillis } from "~/lib/timestamps";

export interface RunRecordInput {
  id: string;
  status: string;
  agentType?: string | null;
  sessionId?: string | null;
  workItemId?: string | null;
  summary?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  createdAt?: unknown;
  artifacts?: readonly {
    id: string;
    type: string;
    metadata?: Record<string, unknown> | null;
    createdAt?: string;
  }[];
}

export interface RunRecordFact {
  label: string;
  value: string;
  /** Present when the value is a link a person can open. */
  url?: string;
}

export interface RunRecordArtifactRow {
  id: string;
  label: string;
  detail: string | null;
}

export interface RunRecordView {
  runId: string;
  title: string;
  statusLabel: string;
  tone: SessionSummaryTone;
  headline: string;
  facts: RunRecordFact[];
  artifacts: RunRecordArtifactRow[];
  sessionId: string | null;
  workItemId: string | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toMillis(value: unknown): number | null {
  return timestampToMillis(value as string | number | Date | null | undefined);
}

const SUMMARY_LABELS: Record<string, string> = {
  reason: "Reason",
  reap_reason: "Swept because",
  reconcile_reason: "Reconciled because",
  code: "Exit code",
  toolName: "Tool",
  baseBranch: "Base branch",
  requestId: "Request",
};

export function buildRunRecordView(
  run: RunRecordInput,
  options: { now?: Date } = {},
): RunRecordView {
  const now = options.now ?? new Date();
  const summary = record(run.summary);
  const tone = toneForStatus(run.status);
  const statusLabel = formatStatusLabel(run.status);
  const agentLabel = formatStatusLabel(run.agentType ?? "agent");

  const startedAt = toMillis(run.startedAt) ?? toMillis(run.createdAt);
  const completedAt = toMillis(run.completedAt);
  const facts: RunRecordFact[] = [];

  const pullRequestUrl = text(summary?.pullRequestUrl);
  if (pullRequestUrl) {
    facts.push({
      label: "Pull request",
      value: pullRequestUrl,
      url: pullRequestUrl,
    });
  }
  const branch = text(summary?.branch);
  if (branch) facts.push({ label: "Branch", value: branch });

  if (startedAt !== null) {
    facts.push({
      label: "Started",
      value: formatRelative(startedAt, now.getTime()),
    });
  }
  if (completedAt !== null) {
    facts.push({
      label: "Finished",
      value: formatRelative(completedAt, now.getTime()),
    });
  }
  if (startedAt !== null && completedAt !== null && completedAt >= startedAt) {
    facts.push({
      label: "Duration",
      value: formatElapsed(completedAt - startedAt),
    });
  }

  for (const [key, label] of Object.entries(SUMMARY_LABELS)) {
    const value = summary?.[key];
    if (typeof value === "string" && value.trim()) {
      facts.push({ label, value: value.trim() });
    } else if (typeof value === "number") {
      facts.push({ label, value: String(value) });
    }
  }

  const sweepReason =
    text(summary?.reap_reason) ||
    text(summary?.reconcile_reason) ||
    text(summary?.reason);
  let headline: string;
  if (summary?.reaped === true) {
    headline = sweepReason
      ? `Ended by the orphan sweep: ${sweepReason}`
      : "Ended by the orphan sweep";
  } else if (summary?.reconciled === true) {
    headline = sweepReason
      ? `Reconciled after its session ended: ${sweepReason}`
      : "Reconciled after its session ended";
  } else if (pullRequestUrl) {
    headline = `${statusLabel}; opened a pull request`;
  } else if (sweepReason) {
    headline = `${statusLabel}: ${sweepReason}`;
  } else {
    headline = run.sessionId
      ? `${statusLabel}; the session has the transcript`
      : `${statusLabel}; this run left no session transcript`;
  }

  const artifacts = (run.artifacts ?? []).map((artifact) => {
    const metadata = record(artifact.metadata);
    const name =
      text(metadata?.name) || text(metadata?.filename) || text(metadata?.path);
    return {
      id: artifact.id,
      label: formatStatusLabel(artifact.type),
      detail: name || null,
    };
  });

  return {
    runId: run.id,
    title: `${agentLabel} run`,
    statusLabel,
    tone,
    headline,
    facts,
    artifacts,
    sessionId: run.sessionId ?? null,
    workItemId: run.workItemId ?? null,
  };
}
