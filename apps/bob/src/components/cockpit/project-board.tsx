"use client";

/**
 * The projects board on the cockpit wall (BOB-99): one row per Kanbanger project with its
 * open work by lane and the stale part last. Clicking a row scopes the Floor to the project;
 * the issue panel shows a tracked issue with its PR, links and the issue actions.
 */
import { BOARD_LANES, boardRowSummary, PARCEL_TONE } from "./floor-model";
import type { Board, BoardLane, BoardRow, EdgeView, TrackedIssue } from "./floor-model";
import { coordinatedIssueIds, issueAttention, issueCommands, rows } from "@bob/sdlc-view";

import { ActionsPanel } from "~/components/sdlc/actions-panel";
import type { ActionContext } from "~/components/sdlc/commands-model";
import type { SendCommand } from "~/components/sdlc/use-sdlc-edge";

export const STALE_COLOR = "#ff9f43";
const LANE_FILL: Record<BoardLane, string> = {
  queue: PARCEL_TONE.queued.fill,
  working: PARCEL_TONE.agents.fill,
  ci: PARCEL_TONE.ci.fill,
  review: PARCEL_TONE.review.fill,
  deploy: PARCEL_TONE.deploy.fill,
};
const LANE_LABEL: Record<BoardLane, string> = { queue: "todo", working: "doing", ci: "CI", review: "review", deploy: "deploy" };

function segments(row: BoardRow) {
  const scale = row.active > 0 ? Math.max(0, row.active - row.stale) / row.active : 0;
  const out: { key: string; value: number; color: string; striped?: boolean }[] = BOARD_LANES.map((lane) => ({
    key: lane, value: lane === "queue" ? row.lanes.queue : row.lanes[lane] * scale, color: LANE_FILL[lane],
  }));
  out.push({ key: "stale", value: row.stale, color: STALE_COLOR, striped: true });
  return out.filter((s) => s.value > 0);
}

export function ProjectBoard({ board, selected, onSelect }: { board: Board; selected: string | null; onSelect: (row: BoardRow | null) => void }) {
  const max = Math.max(1, ...board.rows.map((r) => r.lanes.queue + r.active));
  return (
    <div className="px-3 pb-2 font-mono text-[10px] tracking-widest text-[#8a7758]" aria-label="Projects board">
      <div className="flex items-center gap-3 pb-1">
        <span>
          ALL PROJECTS · <b className="text-[12px] text-[#ffd27a]">{board.started}</b> STARTED
        </span>
        {board.failed ? <span className="text-[#ff6b6b]">{board.failed} RED</span> : null}
        <span className="ml-auto">
          STALE <b className="text-[12px]" style={{ color: STALE_COLOR }}>{board.stale}</b>
        </span>
        {selected ? (
          <button type="button" onClick={() => onSelect(null)} className="rounded border border-[#6a5638] px-2 py-0.5 text-[#ffd27a] hover:brightness-125">
            ALL PROJECTS
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 pb-1 normal-case tracking-normal">
        {BOARD_LANES.map((lane) => (
          <span key={lane} className="inline-flex items-center gap-1">
            <i className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: LANE_FILL[lane] }} />
            {LANE_LABEL[lane]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: STALE_COLOR }} />
          untouched 7d+
        </span>
      </div>
      <ul className="max-h-[220px] overflow-y-auto">
        {board.rows.map((row) => (
          <li key={row.projectId}>
            <button
              type="button"
              onClick={() => onSelect(row)}
              aria-label={boardRowSummary(row)}
              aria-pressed={selected === row.projectId}
              className={`grid w-full grid-cols-[110px_1fr_32px] items-center gap-2 border-t border-[#2a231a] py-1.5 text-left normal-case tracking-normal hover:bg-white/5 ${selected === row.projectId ? "bg-white/10" : ""}`}
            >
              <span className="truncate text-[11px] text-[#e9dcc4]">{row.name}</span>
              <span className="flex h-3 overflow-hidden rounded-sm bg-[#241d15]">
                <span className="flex h-full" style={{ width: `${((row.lanes.queue + row.active) / max) * 100}%` }}>
                  {segments(row).map((s) => (
                    <span
                      key={s.key}
                      className="h-full"
                      style={{
                        flex: s.value,
                        backgroundColor: s.color,
                        backgroundImage: s.striped ? "repeating-linear-gradient(135deg, #ff9f43 0 3px, #7a4a17 3px 6px)" : undefined,
                      }}
                    />
                  ))}
                </span>
              </span>
              <span className="text-right text-[11px] font-bold" style={{ color: row.stale ? STALE_COLOR : "#8a7758" }}>{row.stale}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CHECKS_TEXT = { pending: "checks running", success: "checks passed", failure: "checks failed" } as const;

/** A tracked issue: key, title, project, state, PR, links, and the issue actions. */
export function IssuePanel({ view, issue, now, context, send, onClose }: {
  view: EdgeView;
  issue: TrackedIssue;
  now: number;
  context: ActionContext;
  send: SendCommand;
  onClose: () => void;
}) {
  const attention = issueAttention(issue, now);
  const coordinated = coordinatedIssueIds(rows(view)).has(issue.id);
  const days = Math.floor((now - issue.updatedAt) / 86_400_000);
  const pr = issue.pr;
  return (
    <aside className="mx-3 mb-3 rounded-md border border-white/10 bg-[#1b1611] p-3 text-sm text-[#e9dcc4]" aria-label={`Issue ${issue.key}`}>
      <div className="flex items-center gap-2">
        <b>{issue.key}</b>
        <span className="truncate text-xs text-[#8a7758]">{issue.project?.name ?? issue.team ?? ""}</span>
        <button type="button" onClick={onClose} className="ml-auto text-[#8a7758] hover:text-white" aria-label="Close issue">✕</button>
      </div>
      <p className="mt-1">{issue.title}</p>
      <p className="mt-1 text-xs text-[#8a7758]">
        {issue.state.name} · {days <= 0 ? "changed today" : `untouched ${days}d`}
        {attention === "stalled" ? " · stale" : ""}
      </p>
      <p className="mt-1 text-xs" style={{ color: pr?.checks === "failure" ? "#ff6b6b" : "#8a7758" }}>
        {pr
          ? `PR #${pr.number} · ${pr.state === "merged" ? "merged, waiting for production" : pr.state === "closed" ? "closed" : pr.checks ? CHECKS_TEXT[pr.checks] : "no checks yet"}`
          : "No pull request linked."}
      </p>
      <p className="mt-2 flex gap-3 text-xs">
        {issue.url ? <a className="text-[#ffd27a] underline" href={issue.url} target="_blank" rel="noreferrer">Open in Kanbanger</a> : null}
        {pr ? <a className="text-[#ffd27a] underline" href={pr.url} target="_blank" rel="noreferrer">Open PR #{pr.number}</a> : null}
      </p>
      <ActionsPanel label="Issue actions" resourceId={issue.id} options={issueCommands(issue, coordinated)} target={issue.key} context={context} send={send} />
    </aside>
  );
}
