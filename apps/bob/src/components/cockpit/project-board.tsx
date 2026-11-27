"use client";

/**
 * The projects board on the cockpit wall (BOB-99): one row per Kanbanger project with its
 * open work by lane and the stale part last. Clicking a row scopes the Floor to the project;
 * the issue panel shows a tracked issue with its PR, links and the issue actions.
 */
import { BOARD_LANES, BOARD_LANE_INK, boardRowSummary } from "@bob/arcade";
import type { Board, BoardRow, EdgeView, TrackedIssue } from "./floor-model";
import { coordinatedIssueIds, issueAttention, issueCommands, rows } from "@bob/sdlc-view";

import { ActionsPanel } from "~/components/sdlc/actions-panel";
import type { ActionContext } from "~/components/sdlc/commands-model";
import type { SendCommand } from "~/components/sdlc/use-sdlc-edge";

export function ProjectBoard({
  board,
  selected,
  onSelect,
}: {
  board: Board;
  selected: string | null;
  onSelect: (row: BoardRow | null) => void;
}) {
  return (
    <section className="arcade-projects" aria-label="Projects board">
      <header>
        <h3>Connected projects</h3>
        <span>{board.started} started</span>
        {board.failed > 0 && <span>{board.failed} failed</span>}
        {board.stale > 0 && <span>{board.stale} stale</span>}
        {selected && (
          <button type="button" onClick={() => onSelect(null)}>
            All projects
          </button>
        )}
      </header>
      {board.rows.length === 0 && <p>No open work in any project.</p>}
      <ul>
        {board.rows.map((row) => (
          <li key={row.projectId}>
            <button
              type="button"
              className="arcade-project"
              aria-label={boardRowSummary(row)}
              aria-pressed={selected === row.projectId}
              onClick={() => onSelect(row)}
            >
              <strong>
                {row.name}
                <span aria-hidden="true">↗</span>
              </strong>
              <span className="arcade-lanes">
                {BOARD_LANES.map((lane) => (
                  <span
                    key={lane}
                    className="arcade-lane"
                    style={{ borderColor: row.lanes[lane] ? BOARD_LANE_INK[lane].color : "#36403d" }}
                  >
                    <b>{row.lanes[lane]}</b>
                    <small>{BOARD_LANE_INK[lane].label}</small>
                  </span>
                ))}
              </span>
              {!!(row.failed || row.stale || row.backlog) && (
                <span className="arcade-project-meta">
                  {row.failed > 0 && <small style={{ color: "#ffa18e" }}>{row.failed} failed</small>}
                  {row.stale > 0 && <small style={{ color: "#f5bb77" }}>{row.stale} stale</small>}
                  {row.backlog > 0 && <small>{row.backlog} in backlog</small>}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
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
    <aside
      className="mx-3 mb-3 rounded-xl border border-[#3d3020] bg-gradient-to-b from-[#1e1812] to-[#15110c] p-3.5 text-sm text-[#e9dcc4] shadow-lg"
      aria-label={`Issue ${issue.key}`}
    >
      <div className="flex items-center gap-2">
        <b className="font-mono text-[#ffd27a]">{issue.key}</b>
        <span className="truncate rounded bg-[#261e15] px-1.5 py-0.5 font-mono text-[11px] text-[#a69271]">{issue.project?.name ?? issue.team ?? ""}</span>
        <button type="button" onClick={onClose} className="ml-auto rounded px-1.5 py-0.5 text-[#8a7758] hover:bg-white/10 hover:text-white" aria-label="Close issue">✕</button>
      </div>
      <p className="mt-1.5 font-medium text-[#f4ead7]">{issue.title}</p>
      <p className="mt-1 font-mono text-xs text-[#8a7758]">
        {issue.state.name} · {days <= 0 ? "changed today" : `untouched ${days}d`}
        {attention === "stalled" ? " · stale" : ""}
      </p>
      <p className="mt-1 font-mono text-xs" style={{ color: pr?.checks === "failure" ? "#ff6b6b" : pr?.checks === "success" ? "#7dffb0" : "#8a7758" }}>
        {pr
          ? `PR #${pr.number} · ${pr.state === "merged" ? "merged, waiting for production" : pr.state === "closed" ? "closed" : pr.checks ? CHECKS_TEXT[pr.checks] : "no checks yet"}`
          : "No pull request linked."}
      </p>
      <p className="mt-2 flex gap-3 font-mono text-xs">
        {issue.url ? <a className="rounded border border-[#4a3b28] bg-[#211a12] px-2 py-0.5 text-[#ffd27a] hover:brightness-125" href={issue.url} target="_blank" rel="noreferrer">Open in Kanbanger ↗</a> : null}
        {pr ? <a className="rounded border border-[#4a3b28] bg-[#211a12] px-2 py-0.5 text-[#ffd27a] hover:brightness-125" href={pr.url} target="_blank" rel="noreferrer">Open PR #{pr.number} ↗</a> : null}
      </p>
      <ActionsPanel label="Issue actions" resourceId={issue.id} options={issueCommands(issue, coordinated)} target={issue.key} context={context} send={send} />
    </aside>
  );
}
