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
    <div className="border-b border-[#292016] bg-[#14100b]/80 px-3 py-2 font-mono text-[10px] tracking-widest text-[#8a7758]" aria-label="Projects board">
      <div className="flex flex-wrap items-center gap-3 pb-1.5">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#d4850a]" />
          CONNECTED PROJECTS · <b className="text-[12px] text-[#ffd27a]">{board.started}</b> STARTED
        </span>
        {board.failed ? (
          <span className="rounded border border-[#ff6b6b]/40 bg-[#ff6b6b]/10 px-1.5 py-[0.5px] font-bold text-[#ff6b6b]">
            {board.failed} RED
          </span>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 normal-case tracking-normal text-[10px]">
          {BOARD_LANES.map((lane) => (
            <span key={lane} className="inline-flex items-center gap-1 rounded bg-[#1d1710] px-1.5 py-[0.5px]">
              <i className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: LANE_FILL[lane] }} />
              {LANE_LABEL[lane]}
            </span>
          ))}
          <span className="inline-flex items-center gap-1 rounded bg-[#1d1710] px-1.5 py-[0.5px]">
            <i className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: STALE_COLOR }} />
            untouched 7d+
          </span>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <span>
            STALE <b className="text-[12px]" style={{ color: STALE_COLOR }}>{board.stale}</b>
          </span>
          {selected ? (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="rounded-full border border-[#ffd27a]/60 bg-[#2a2013] px-2.5 py-0.5 text-[#ffd27a] transition-colors hover:brightness-125"
            >
              ALL PROJECTS
            </button>
          ) : null}
        </span>
      </div>
      <ul className="max-h-[210px] space-y-1 overflow-y-auto pr-0.5">
        {board.rows.map((row) => {
          const isSelected = selected === row.projectId;
          const total = row.lanes.queue + row.active;
          return (
            <li key={row.projectId}>
              <button
                type="button"
                onClick={() => onSelect(row)}
                aria-label={boardRowSummary(row)}
                aria-pressed={isSelected}
                className="grid w-full grid-cols-[124px_1fr_44px] items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left normal-case tracking-normal transition-all hover:bg-[#221b13]"
                style={{
                  borderColor: isSelected ? "#ffd27a88" : "#251d14",
                  backgroundColor: isSelected ? "#261e14" : "#17120d",
                  boxShadow: isSelected ? "0 0 12px rgba(212,133,10,0.2)" : undefined,
                }}
              >
                <span className="flex items-center gap-1.5 truncate text-[11px] font-semibold text-[#efe3cd]">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: isSelected ? "#ffd27a" : row.active > 0 ? "#6fb4ff" : "#5e4e3a" }}
                  />
                  <span className="truncate">{row.name}</span>
                </span>
                <span className="flex h-3.5 overflow-hidden rounded-full border border-[#2c2319] bg-[#0c0907] p-[1px] shadow-inner">
                  <span className="flex h-full gap-[1px] overflow-hidden rounded-full" style={{ width: `${(total / max) * 100}%` }}>
                    {segments(row).map((s) => (
                      <span
                        key={s.key}
                        className="h-full first:rounded-l-full last:rounded-r-full"
                        style={{
                          flex: s.value,
                          backgroundColor: s.color,
                          backgroundImage: s.striped
                            ? "repeating-linear-gradient(135deg, #ff9f43 0 3px, #7a4a17 3px 6px)"
                            : "linear-gradient(180deg, rgba(255,255,255,0.28) 0%, transparent 60%)",
                        }}
                      />
                    ))}
                  </span>
                </span>
                <span className="text-right text-[11px] font-bold tabular-nums" style={{ color: row.stale ? STALE_COLOR : "#8a7758" }}>
                  {row.stale}
                </span>
              </button>
            </li>
          );
        })}
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
