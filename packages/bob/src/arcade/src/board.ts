import { coordinatedIssueIds, issueAttention, issueStation, rows } from "@bob/sdlc-view";
import type { EdgeView, IssueStation, Row, TrackedIssue } from "@bob/sdlc-view";

import { PARCEL_TONE, stationFor } from "./floor";
import type { StationId } from "./floor";

/**
 * The projects board (BOB-99): the phone's opening view. One row per Kanbanger project with
 * open work, its started work split by lane, and the stale part called out, because stale
 * work is what needs a person. Tapping a row opens that project's floor
 * (floorScene with options.projectId).
 *
 * Coordinator items join their plan issue's Kanbanger project; an item whose project no
 * tracked issue names still gets a row, labelled by its repository.
 */
export type BoardLane = "queue" | "working" | "ci" | "review" | "deploy";
export const BOARD_LANES: readonly BoardLane[] = ["queue", "working", "ci", "review", "deploy"];

/** Labels and line colours on the project rack, ordered from intake to deployment. */
export const BOARD_LANE_INK: Record<BoardLane, { label: string; color: string }> = {
  queue: { label: "Queue", color: PARCEL_TONE.queued.fill },
  working: { label: "Working", color: PARCEL_TONE.agents.fill },
  ci: { label: "CI", color: PARCEL_TONE.ci.fill },
  review: { label: "Review", color: PARCEL_TONE.review.fill },
  deploy: { label: "Deploy", color: PARCEL_TONE.deploy.fill },
};

export interface BoardRow {
  /** The Kanbanger project id, or `repo:<repositoryId>` for items with no known project. */
  projectId: string;
  /** Whether projectId is a Kanbanger project (a floor can scope to it). */
  kanbanger: boolean;
  name: string;
  lanes: Record<BoardLane, number>;
  /** Started work (working … deploy) untouched past its limit: a subset of the lanes. */
  stale: number;
  /** Red PR checks or failed coordinator items. */
  failed: number;
  backlog: number;
  /** working + ci + review + deploy. */
  active: number;
  /** Newest change in the row (ms), or null. */
  lastActivity: number | null;
}

export interface Board {
  rows: BoardRow[];
  /** Started work across every row (the header's "N STARTED"). */
  started: number;
  stale: number;
  failed: number;
}

const ITEM_LANE: Partial<Record<StationId, BoardLane>> = { queue: "queue", ready: "queue", admit: "working", agents: "working", ci: "ci", review: "review", deploy: "deploy" };
const ISSUE_LANE: Partial<Record<IssueStation, BoardLane>> = { queue: "queue", agents: "working", ci: "ci", review: "review", deploy: "deploy" };

const emptyLanes = (): Record<BoardLane, number> => ({ queue: 0, working: 0, ci: 0, review: 0, deploy: 0 });

export function projectBoard(view: EdgeView, now: number): Board {
  const out = new Map<string, BoardRow>();
  const issues = Object.values(view.issues ?? {});
  const projectNames = new Map<string, string>();
  for (const issue of issues) if (issue.project) projectNames.set(issue.project.id, issue.project.name);
  const rowFor = (projectId: string, kanbanger: boolean, name: string): BoardRow => {
    let row = out.get(projectId);
    if (!row) {
      row = { projectId, kanbanger, name, lanes: emptyLanes(), stale: 0, failed: 0, backlog: 0, active: 0, lastActivity: null };
      out.set(projectId, row);
    }
    return row;
  };
  const touch = (row: BoardRow, at: number | null | undefined) => {
    if (typeof at === "number" && (row.lastActivity === null || at > row.lastActivity)) row.lastActivity = at;
  };

  const itemRows: Row[] = rows(view, now);
  for (const r of itemRows) {
    const lane = ITEM_LANE[stationFor(r.item.state)];
    const failed = r.attention === "failed";
    if (!lane && !failed) continue;
    const name = projectNames.get(r.issue.projectId);
    const row = name !== undefined ? rowFor(r.issue.projectId, true, name) : rowFor(`repo:${r.target.repository.repositoryId}`, false, r.target.repository.repositoryId);
    if (lane) row.lanes[lane]++;
    if (failed) row.failed++;
    if (r.attention === "stalled" && lane && lane !== "queue") row.stale++;
    touch(row, r.item.stateSince);
  }

  const coordinated = coordinatedIssueIds(itemRows);
  for (const issue of issues) {
    if (coordinated.has(issue.id) || !issue.project) continue;
    const station = issueStation(issue);
    const row = rowFor(issue.project.id, true, issue.project.name);
    if (station === "backlog") { row.backlog++; touch(row, issue.updatedAt); continue; }
    const lane = ISSUE_LANE[station];
    if (!lane) continue; // shipped / cancelled: not open work
    row.lanes[lane]++;
    const attention = issueAttention(issue, now);
    if (attention === "stalled") row.stale++;
    if (attention === "failed") row.failed++;
    touch(row, issue.updatedAt);
  }

  const list = [...out.values()];
  for (const row of list) row.active = row.lanes.working + row.lanes.ci + row.lanes.review + row.lanes.deploy;
  const open = list.filter((r) => r.active + r.lanes.queue + r.backlog + r.failed > 0);
  open.sort((a, b) => b.stale - a.stale || b.active - a.active || a.name.localeCompare(b.name));
  return {
    rows: open,
    started: open.reduce((n, r) => n + r.active, 0),
    stale: open.reduce((n, r) => n + r.stale, 0),
    failed: open.reduce((n, r) => n + r.failed, 0),
  };
}

/** The same membership as a board row, including unassigned items grouped by repository. */
export function boardProjectView(view: EdgeView, project: Pick<BoardRow, "projectId" | "kanbanger"> | null): EdgeView {
  if (!project) return view;
  const issues = Object.values(view.issues ?? {});
  const known = new Set(issues.map((issue) => issue.project?.id));
  const members = rows(view).filter((row) => project.kanbanger
    ? row.issue.projectId === project.projectId
    : !known.has(row.issue.projectId) && `repo:${row.target.repository.repositoryId}` === project.projectId);
  return {
    ...view,
    items: Object.fromEntries(members.map(({ item }) => [item.itemId, item])),
    issues: Object.fromEntries(issues.filter((issue) => project.kanbanger && issue.project?.id === project.projectId).map((issue) => [issue.id, issue])),
  };
}

/** The row as one sentence for screen readers. */
export function boardRowSummary(row: BoardRow): string {
  const parts = [`${row.lanes.queue} to do`, `${row.lanes.working} in progress`, `${row.lanes.ci} in CI`, `${row.lanes.review} in review`, `${row.lanes.deploy} deploying`];
  return `${row.name}: ${parts.join(", ")}; ${row.stale} stale${row.failed ? `, ${row.failed} failed` : ""}${row.backlog ? `, ${row.backlog} in backlog` : ""}`;
}

/** Issues in a project, for a panel or a list. */
export const projectIssues = (view: EdgeView, projectId: string): TrackedIssue[] =>
  Object.values(view.issues ?? {}).filter((i) => i.project?.id === projectId);
