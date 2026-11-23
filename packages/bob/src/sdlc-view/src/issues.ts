/**
 * Tracked issues (BOB-99): every open Kanbanger issue, from every project, on the SDLC edge.
 *
 * The coordinator mirrors Kanbanger (packages/bob/coordination/runtime/issue-mirror.mjs) and
 * joins each issue's Forgejo pull request (CI checks, merged). It posts IssueBatch bodies to
 * the edge (/api/sdlc/issues); the edge stores them and sends them to clients in snapshot and
 * delta messages beside plans and items. Coordinator items keep their own state machine: an
 * issue with a live coordinator item is drawn once, as the item.
 *
 * Only what a board needs crosses: key, title, state, project, the PR's state. No
 * descriptions, comments or assignees.
 */
import type { Attention } from "./presentation";

/** Kanbanger (Linear) workflow state types. */
export const ISSUE_STATE_TYPES = ["triage", "backlog", "unstarted", "started", "completed", "canceled"] as const;
export type IssueStateType = (typeof ISSUE_STATE_TYPES)[number];

/** A Forgejo pull request attached to the issue, as the mirror last read it. */
export interface TrackedPr {
  /** "owner/repo" on git.forgegraf.com. */
  repo: string;
  number: number;
  url: string;
  state: "open" | "merged" | "closed";
  /** Forgejo's combined commit status for the PR head; null when it has none yet. */
  checks: "pending" | "success" | "failure" | null;
  headSha: string | null;
  /** When the mirror read the PR (coordinator clock, ms). */
  checkedAt: number;
}

export interface TrackedIssue {
  /** Kanbanger issue UUID. */
  id: string;
  /** "BOB-101". */
  key: string;
  /** Clipped to TITLE_MAX. */
  title: string;
  /** https only, else null. */
  url: string | null;
  state: { name: string; type: IssueStateType };
  project: { id: string; name: string } | null;
  /** Team key, e.g. "GMA". */
  team: string | null;
  /** Kanbanger's updatedAt (ms): the last change anyone made to the issue. */
  updatedAt: number;
  pr: TrackedPr | null;
  /** The coordinator's policy admits this issue's project, so "Dispatch to an agent" can run. */
  dispatchable: boolean;
  /**
   * Monotonic per issue, set by the mirror: max(updatedAt, pr.checkedAt). A copy with a lower
   * version never replaces a higher one (edge and clients both apply this).
   */
  version: number;
}

export const TITLE_MAX = 160;

/**
 * Coordinator → edge, POST /api/sdlc/issues (same bearer token as ingest). `upserts` are
 * applied by version. `complete` ends a full sync: the edge removes every issue whose id is
 * not listed.
 */
export interface IssueBatch {
  contractVersion: "1";
  upserts: TrackedIssue[];
  complete?: { ids: string[] };
}

/** The edge's answer. */
export interface IssueBatchResult { accepted: true; stored: number; removed: number }

/** Max issues per batch: keeps a batch well under the edge's 1 MB body limit. */
export const MAX_ISSUES_PER_BATCH = 400;
/** Max ids in a full sync's `complete` list. */
export const MAX_COMPLETE_IDS = 20_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
const isTime = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const httpsOrNull = (v: unknown): string | null => {
  if (typeof v !== "string" || v.length > 2000) return null;
  try { return new URL(v).protocol === "https:" ? v : null; } catch { return null; }
};
const clip = (v: string, max: number) => (v.length > max ? `${v.slice(0, max - 1)}…` : v);
const SHA = /^[a-f0-9]{40}$/;
const PR_STATES: ReadonlySet<string> = new Set(["open", "merged", "closed"]);
const CHECKS: ReadonlySet<string> = new Set(["pending", "success", "failure"]);

function parsePr(raw: unknown): TrackedPr | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) return undefined;
  const url = httpsOrNull(raw.url);
  if (typeof raw.repo !== "string" || !/^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(raw.repo) || !Number.isSafeInteger(raw.number) || (raw.number as number) < 1) return undefined;
  if (!url || !PR_STATES.has(raw.state as string) || !isTime(raw.checkedAt)) return undefined;
  if (raw.checks !== null && !CHECKS.has(raw.checks as string)) return undefined;
  if (raw.headSha !== null && !(typeof raw.headSha === "string" && SHA.test(raw.headSha))) return undefined;
  return { repo: raw.repo, number: raw.number as number, url, state: raw.state as TrackedPr["state"], checks: raw.checks as TrackedPr["checks"], headSha: raw.headSha, checkedAt: raw.checkedAt };
}

/** Validates one untrusted issue; returns a fresh copy with only the known fields, or null. */
export function parseTrackedIssue(raw: unknown): TrackedIssue | null {
  if (!isRecord(raw) || !isId(raw.id) || typeof raw.key !== "string" || !/^[A-Z][A-Z0-9]{0,19}-\d{1,9}$/.test(raw.key)) return null;
  if (typeof raw.title !== "string" || !isRecord(raw.state) || typeof raw.state.name !== "string" || raw.state.name.length > 100) return null;
  if (!(ISSUE_STATE_TYPES as readonly string[]).includes(raw.state.type as string)) return null;
  if (!isTime(raw.updatedAt) || !isTime(raw.version) || typeof raw.dispatchable !== "boolean") return null;
  let project: TrackedIssue["project"] = null;
  if (raw.project !== null && raw.project !== undefined) {
    if (!isRecord(raw.project) || !isId(raw.project.id) || typeof raw.project.name !== "string") return null;
    project = { id: raw.project.id, name: clip(raw.project.name, 100) };
  }
  if (raw.team !== null && raw.team !== undefined && (typeof raw.team !== "string" || raw.team.length > 20)) return null;
  const pr = parsePr(raw.pr);
  if (pr === undefined) return null;
  return {
    id: raw.id, key: raw.key, title: clip(raw.title, TITLE_MAX), url: httpsOrNull(raw.url),
    state: { name: raw.state.name, type: raw.state.type as IssueStateType }, project, team: (raw.team as string | null | undefined) ?? null,
    updatedAt: raw.updatedAt, pr, dispatchable: raw.dispatchable, version: raw.version,
  };
}

/** Validates an untrusted IssueBatch. Invalid issues are dropped, not fatal; a malformed envelope is null. */
export function parseIssueBatch(raw: unknown): IssueBatch | null {
  if (!isRecord(raw) || raw.contractVersion !== "1" || !Array.isArray(raw.upserts) || raw.upserts.length > MAX_ISSUES_PER_BATCH) return null;
  const upserts = raw.upserts.map(parseTrackedIssue).filter((i): i is TrackedIssue => i !== null);
  if (raw.complete === undefined) return { contractVersion: "1", upserts };
  if (!isRecord(raw.complete) || !Array.isArray(raw.complete.ids) || raw.complete.ids.length > MAX_COMPLETE_IDS || !raw.complete.ids.every(isId)) return null;
  return { contractVersion: "1", upserts, complete: { ids: [...new Set(raw.complete.ids as string[])] } };
}

/** Where an issue sits on the floor. "backlog" is not drawn on the belt: boards count it. */
export type IssueStation = "backlog" | "queue" | "agents" | "ci" | "review" | "deploy" | "shipped" | "scrap" | "cancelled";

/** In Review by name (Kanbanger has no distinct type for it: it is "started"). */
const inReview = (issue: TrackedIssue) => /review/i.test(issue.state.name);

/**
 * The issue's station. Kanbanger says how far the work is; the PR refines a started issue:
 * no PR → working (agents), checks running or red → CI, green → review, merged but not
 * Done → deploy (waiting for production verification).
 */
export function issueStation(issue: TrackedIssue): IssueStation {
  switch (issue.state.type) {
    case "triage":
    case "backlog": return "backlog";
    case "unstarted": return "queue";
    case "completed": return "shipped";
    case "canceled": return "cancelled";
    case "started": {
      const pr = issue.pr;
      if (pr?.state === "merged") return "deploy";
      if (pr?.state === "open") {
        if (pr.checks === "pending" || pr.checks === "failure") return "ci";
        if (pr.checks === "success") return "review";
      }
      return inReview(issue) ? "review" : "agents";
    }
  }
}

/** A started issue nobody has touched for this long is stale. */
export const ISSUE_STALE_AFTER_MS = 7 * 24 * 3_600_000;

/** failed: its PR's checks are red; stalled: started and untouched for ISSUE_STALE_AFTER_MS. */
export function issueAttention(issue: TrackedIssue, now?: number): Attention {
  if (issue.state.type === "started" && issue.pr?.state === "open" && issue.pr.checks === "failure") return "failed";
  if (now !== undefined && issue.state.type === "started" && now - issue.updatedAt > ISSUE_STALE_AFTER_MS) return "stalled";
  return "ok";
}

/** Whether a copy should replace what the view holds. */
export const newerIssue = (current: TrackedIssue | undefined, next: TrackedIssue) => !current || next.version > current.version;

/** Issue ids that a live coordinator item already draws (its plan's issue ref). */
export function coordinatedIssueIds(items: Iterable<{ issue: { issueId: string } }>): Set<string> {
  const out = new Set<string>();
  for (const row of items) out.add(row.issue.issueId);
  return out;
}

/** Workflow states a surface may move an issue to (SetIssueState). The coordinator maps each to the team's state. */
export const ISSUE_TARGETS = ["todo", "in_progress", "in_review", "done", "canceled"] as const;
export type IssueTarget = (typeof ISSUE_TARGETS)[number];
export const ISSUE_TARGET_LABEL: Record<IssueTarget, string> = { todo: "Todo", in_progress: "In Progress", in_review: "In Review", done: "Done", canceled: "Canceled" };

/** The target an issue is already at, if any (so surfaces hide "move to where it is"). */
export function issueTargetOf(issue: TrackedIssue): IssueTarget | null {
  switch (issue.state.type) {
    case "unstarted": return "todo";
    case "started": return inReview(issue) ? "in_review" : "in_progress";
    case "completed": return "done";
    case "canceled": return "canceled";
    default: return null;
  }
}
