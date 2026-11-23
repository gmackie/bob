import { useId, type KeyboardEvent } from "react";
import { ITEM_STATES, STATE_EDGES, STATE_PRESENTATION, type ItemState, type Owner, type StateEdge } from "@bob/sdlc-view";

import { cn } from "@gmacko/core/ui";

const W = 136, H = 48, DX = 156, DY = 80, PAD = 12;
const COLS = Math.max(...ITEM_STATES.map((s) => STATE_PRESENTATION[s].col)) + 1;
const ROWS = Math.max(...ITEM_STATES.map((s) => STATE_PRESENTATION[s].row)) + 1;
export const GRAPH_WIDTH = PAD * 2 + (COLS - 1) * DX + W;
export const GRAPH_HEIGHT = PAD * 2 + (ROWS - 1) * DY + H;

const box = (s: ItemState) => ({ x: PAD + STATE_PRESENTATION[s].col * DX, y: PAD + STATE_PRESENTATION[s].row * DY });
const center = (s: ItemState) => { const b = box(s); return { x: b.x + W / 2, y: b.y + H / 2 }; };

/** Owner colours: who moves an item out of the state. Amber is kept for attention. */
export const OWNER_STROKE: Record<Owner, string> = {
  system: "stroke-emerald-500",
  agent: "stroke-sky-500",
  human: "stroke-fuchsia-500",
  terminal: "stroke-rose-500",
};
const OWNER_FILL: Record<Owner, string> = { system: "fill-emerald-500", agent: "fill-sky-500", human: "fill-fuchsia-500", terminal: "fill-rose-500" };
const OWNER_SWATCH: Record<Owner, string> = { system: "bg-emerald-500", agent: "bg-sky-500", human: "bg-fuchsia-500", terminal: "bg-rose-500" };
const OWNER_LABEL: Record<Owner, string> = { system: "System", agent: "Agent", human: "Human", terminal: "Terminal" };

/** States the coordinator writes today: those on some edge. The rest are drawn dimmed. */
const WRITTEN = new Set<ItemState>(STATE_EDGES.flatMap((e) => [e.from, e.to]));

/** Where the segment from a's centre towards b leaves a's box. */
function exit(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const t = Math.min(dx ? W / 2 / Math.abs(dx) : Infinity, dy ? H / 2 / Math.abs(dy) : Infinity);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

function edgePath(edge: StateEdge): string {
  const a = center(edge.from), b = center(edge.to);
  if (!edge.loop) {
    const s = exit(a, b), e = exit(b, a);
    return `M${s.x},${s.y} L${e.x},${e.y}`;
  }
  // Back edges bow out to the side, so they do not sit on top of the forward edge.
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const bow = Math.min(60, 18 + len / 6);
  const c = { x: mx + ((b.y - a.y) / len) * bow, y: my - ((b.x - a.x) / len) * bow };
  const s = exit(a, c), e = exit(b, c);
  return `M${s.x},${s.y} Q${c.x},${c.y} ${e.x},${e.y}`;
}

export interface StateGraphProps {
  counts: Record<ItemState, number>;
  selected?: ItemState | null;
  onSelect?: (state: ItemState) => void;
  className?: string;
}

/**
 * The coordinator's item state machine: the presentation spec's grid, the transitions
 * the coordinator performs today (back edges dashed), owner colours and per-state counts.
 * States that need attention (stalled, waiting on a human) are tinted amber.
 */
export function StateGraph({ counts, selected = null, onSelect, className }: StateGraphProps) {
  // One marker per graph: two graphs on a page must not share (or fight over) an id.
  const arrowId = `sdlc-arrow-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const select = (state: ItemState) => onSelect?.(state);
  const onKey = (state: ItemState) => (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(state); }
  };
  return (
    <figure className={cn("space-y-2", className)}>
      <svg
        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        role="group"
        aria-label="Coordinator item states"
        className="w-full min-w-[640px] text-foreground"
      >
        <defs>
          <marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 Z" className="fill-muted-foreground" />
          </marker>
        </defs>
        <g aria-hidden="true">
          {STATE_EDGES.map((edge) => (
            <path
              key={`${edge.from}->${edge.to}`}
              data-edge={`${edge.from}->${edge.to}`}
              d={edgePath(edge)}
              fill="none"
              className="stroke-muted-foreground/50"
              strokeWidth={1.25}
              strokeDasharray={edge.loop ? "5 4" : undefined}
              markerEnd={`url(#${arrowId})`}
            />
          ))}
        </g>
        {ITEM_STATES.map((state) => {
          const p = box(state), s = STATE_PRESENTATION[state], n = counts[state] ?? 0;
          const attention = s.attention === "stalled" || s.attention === "needs_human";
          const isSelected = selected === state;
          const written = WRITTEN.has(state);
          return (
            <g
              key={state}
              role="button"
              tabIndex={0}
              aria-label={`${s.label}: ${n}`}
              aria-pressed={isSelected}
              data-state={state}
              data-attention={s.attention}
              className={cn("cursor-pointer outline-none focus-visible:[&>rect]:stroke-primary", !written && "opacity-50")}
              onClick={() => select(state)}
              onKeyDown={onKey(state)}
            >
              <title>{`${s.label}: ${n}${s.hint ? ` (${s.hint})` : ""}${written ? "" : ", not written by the coordinator yet"}`}</title>
              <rect
                x={p.x}
                y={p.y}
                width={W}
                height={H}
                rx={8}
                className={cn(attention ? "fill-amber-500/10" : "fill-card", attention ? "stroke-amber-500" : OWNER_STROKE[s.owner])}
                strokeWidth={isSelected ? 3 : 1.5}
                strokeDasharray={s.owner === "terminal" ? "4 3" : undefined}
              />
              {attention && <rect x={p.x} y={p.y + 8} width={3} height={H - 16} rx={1.5} className={OWNER_FILL[s.owner]} />}
              <text x={p.x + 10} y={p.y + 20} fontSize={12} fontWeight={600} fill="currentColor">{s.label}</text>
              <text x={p.x + 10} y={p.y + 36} fontSize={9.5} className={attention ? "fill-amber-600 dark:fill-amber-400" : "fill-muted-foreground"}>
                {truncate(s.hint, 24)}
              </text>
              <text x={p.x + W - 10} y={p.y + 20} fontSize={15} fontWeight={700} textAnchor="end" fill="currentColor" opacity={n ? 1 : 0.35}>
                {n}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(Object.keys(OWNER_LABEL) as Owner[]).map((owner) => (
          <span key={owner} className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", OWNER_SWATCH[owner])} />
            {OWNER_LABEL[owner]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm border border-amber-500 bg-amber-500/20" />
          Needs attention
        </span>
        <span>Dashed line: an item can move back</span>
      </figcaption>
    </figure>
  );
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
