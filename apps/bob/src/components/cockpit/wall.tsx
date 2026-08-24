"use client";

/**
 * Cockpit wall mode — glanceable at 3 m. Motion level "live": every animation
 * is a state change (lane slide, streaming pulse, stage light-up); idle is
 * calm. Dark, high-contrast, no chrome.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { OpsButton, type CockpitActions } from "./controls";

import type { CockpitPr, CockpitQueueCard, CockpitSession, CockpitStatus, TileFeed } from "./use-cockpit";

const LANES = ["urgent", "high", "medium", "unset", "low"] as const;
const LANE_LABEL: Record<(typeof LANES)[number], string> = {
  urgent: "URGENT",
  high: "HIGH",
  medium: "MED",
  unset: "—",
  low: "LOW",
};
const AGENT_COLOR: Record<string, string> = {
  claude: "#e07a4f",
  codex: "#6fb4ff",
  grok: "#c39bff",
  cursor: "#38e1b0",
};
const agentColor = (a: string) => AGENT_COLOR[a] ?? "#8b97b3";

function ago(seconds: number | null | undefined): string {
  if (seconds == null) return "–";
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

// ---------------------------------------------------------------------------
export function HeaderStrip({ status, ops, soundEnabled, onToggleSound, onToggleMode, mode }: { status: CockpitStatus; ops: CockpitActions | null; soundEnabled: boolean; onToggleSound: () => void; onToggleMode: () => void; mode: "wall" | "ops" }) {
  const tickOk = status.loop.tickAgeSeconds != null && status.loop.tickAgeSeconds < 7 * 60;
  const tickWarn = status.loop.tickAgeSeconds != null && status.loop.tickAgeSeconds < 15 * 60;
  const syncOk = status.loop.syncAgeSeconds != null && status.loop.syncAgeSeconds < 30 * 60;
  return (
    <div className="flex items-center gap-6 border-b border-white/10 px-6 py-3 font-mono text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block size-3 rounded-full ${tickOk ? "animate-pulse bg-emerald-400" : tickWarn ? "bg-amber-400" : "bg-red-500"}`}
        />
        <span className="tracking-widest text-white/80">BOB LOOP</span>
        <span className="text-white/40">tick {ago(status.loop.tickAgeSeconds)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-white/40">budget</span>
        <div className="h-2 w-28 overflow-hidden rounded bg-white/10">
          <div
            className="h-full bg-emerald-400/80 transition-all duration-700"
            style={{ width: `${Math.min(100, (status.pacing.used / Math.max(1, status.pacing.cap)) * 100)}%` }}
          />
        </div>
        <span className="text-white/70">
          {status.pacing.used}/{status.pacing.cap}
          <span className="text-white/35"> · earned {status.pacing.earned} · slots {status.pacing.activeSlots}/{status.pacing.concurrency}</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        {status.agents.map((a) => (
          <span
            key={a.agent}
            title={a.reason}
            onClick={ops ? () => ops.setAgentEnabled.mutate({ agent: a.agent, enabled: !a.inRotation }) : undefined}
            className={`rounded border px-2 py-0.5 text-xs ${ops ? "cursor-pointer" : ""} ${a.healthy ? "border-white/15 text-white/70" : "border-red-500/60 text-red-400 line-through"}`}
            style={{ borderLeftColor: agentColor(a.agent), borderLeftWidth: 3 }}
          >
            {a.agent} {a.completed}✓{a.errored ? `/${a.errored}✗` : ""}
          </span>
        ))}
        {ops && (
          <OpsButton
            label={status.loop.dispatchEnabled ? "pause dispatch" : "RESUME"}
            tone={status.loop.dispatchEnabled ? "danger" : "go"}
            confirm={status.loop.dispatchEnabled ? "pause?" : undefined}
            busy={ops.setDispatchEnabled.isPending}
            onClick={() => ops.setDispatchEnabled.mutate({ enabled: !status.loop.dispatchEnabled })}
          />
        )}
      </div>
      <div className={`ml-auto ${syncOk ? "text-white/40" : "text-amber-400"}`}>sync {ago(status.loop.syncAgeSeconds)}</div>
      <button type="button" onClick={onToggleSound} title="sound" className="text-white/40 hover:text-white/80">{soundEnabled ? "🔊" : "🔇"}</button>
      <button type="button" onClick={onToggleMode} className="rounded border border-white/20 px-2 py-0.5 font-mono text-[10px] uppercase text-white/60 hover:bg-white/10">{mode}</button>
      {status.alerts.length > 0 && (
        <div className="flex items-center gap-2">
          {status.alerts.slice(0, 3).map((al) => (
            <span key={al.id} className="animate-pulse rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-300">
              ⚠ {al.message}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function QueueLanes({ status, ops }: { status: CockpitStatus; ops: CockpitActions | null }) {
  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      <div className="font-mono text-xs tracking-widest text-white/40">
        QUEUE · {status.queue.total} ready <span className="text-white/25">· {status.queue.backlog} backlog (human gate)</span>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {LANES.map((lane) => {
          const cards = status.queue.lanes[lane];
          if (!cards.length) return null;
          return (
            <div key={lane}>
              <div className="mb-1 font-mono text-[10px] tracking-widest text-white/35">
                {LANE_LABEL[lane]} <span className="text-white/20">{cards.length}</span>
              </div>
              <div className="space-y-1">
                {cards.slice(0, lane === "urgent" || lane === "high" ? 8 : 4).map((c) => (
                  <QueueCardRow key={c.id} card={c} ops={ops} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QueueCardRow({ card, ops }: { card: CockpitQueueCard; ops: CockpitActions | null }) {
  return (
    <div
      className="animate-[cockpit-enter_.5s_ease-out] rounded border border-white/10 bg-white/[.03] px-2 py-1.5 transition-all duration-500"
      style={card.ready ? { borderColor: "rgba(56,225,176,.5)" } : undefined}
    >
      <div className="flex items-baseline gap-2">
        {card.identifier && <span className="font-mono text-[10px] text-emerald-300/80">{card.identifier}</span>}
        <span className="truncate text-xs text-white/85">{card.title}</span>
      </div>
      <div className="mt-0.5 flex gap-2 font-mono text-[10px] text-white/35">
        {card.repo && <span>{card.repo}</span>}
        {card.agentOverride && <span className="text-sky-300/80">→{card.agentOverride}</span>}
        <span className="ml-auto">{card.ageMinutes < 120 ? `${card.ageMinutes}m` : `${Math.round(card.ageMinutes / 60 / 24)}d`}</span>
        {ops && card.lane !== "urgent" && (
          <OpsButton label="↑ urgent" busy={ops.bumpPriority.isPending} onClick={() => ops.bumpPriority.mutate({ workItemId: card.id, priority: 1 })} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function AgentStage({
  sessions,
  feeds,
  feedVersion: _feedVersion,
  ops,
}: {
  sessions: CockpitSession[];
  feeds: Map<string, TileFeed>;
  feedVersion: number;
  ops: CockpitActions | null;
}) {
  // Auto-focus: the most recently active tile grows for 20 s, then rotates.
  const [focusId, setFocusId] = useState<string | null>(null);
  const focusLockUntil = useRef(0);
  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() < focusLockUntil.current) return;
      let best: { id: string; at: number } | null = null;
      for (const s of sessions) {
        const at = feeds.get(s.id)?.lastEventAt ?? 0;
        if (!best || at > best.at) best = { id: s.id, at };
      }
      if (best && best.id !== focusId) {
        setFocusId(best.id);
        focusLockUntil.current = Date.now() + 20_000;
      }
    }, 2_000);
    return () => clearInterval(t);
  }, [sessions, feeds, focusId]);

  if (!sessions.length) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-sm text-white/25">
        no agents working — queue {""}waits on slots or pacing
      </div>
    );
  }
  return (
    <div className="grid h-full auto-rows-fr grid-cols-2 gap-3 overflow-hidden">
      {sessions.slice(0, 6).map((s) => (
        <AgentTile key={s.id} session={s} feed={feeds.get(s.id)} focused={s.id === focusId && sessions.length > 1} ops={ops} />
      ))}
    </div>
  );
}

function AgentTile({ session, feed, focused, ops }: { session: CockpitSession; feed: TileFeed | undefined; focused: boolean; ops: CockpitActions | null }) {
  const streaming = feed != null && Date.now() - feed.lastEventAt < 5_000;
  const color = agentColor(session.agent);
  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden rounded-lg border bg-black/40 p-3 transition-all duration-700 ${focused ? "col-span-2 row-span-2" : ""}`}
      style={{ borderColor: streaming ? color : "rgba(255,255,255,.12)", boxShadow: streaming ? `0 0 24px ${color}22` : undefined }}
    >
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className={`inline-block size-2 rounded-full ${streaming ? "animate-pulse" : ""}`} style={{ background: color }} />
        <span style={{ color }}>{session.agent}</span>
        <span className="rounded bg-white/10 px-1.5 text-[10px] uppercase text-white/60">{session.phase}</span>
        <span className="ml-auto text-white/40">{ago(session.elapsedSeconds)}</span>
        {ops && (
          <OpsButton label="stop" tone="danger" confirm="stop?" busy={ops.stopSession.isPending} onClick={() => ops.stopSession.mutate({ sessionId: session.id })} />
        )}
      </div>
      <div className="mt-1 truncate text-sm text-white/90">{session.identifier ? `${session.identifier} · ` : ""}{session.title.replace(/^[0-9a-f-]{36}: /, "")}</div>
      <div className="truncate font-mono text-[10px] text-white/35">
        {session.repo}
        {session.branch ? ` · ${session.branch.split("/").slice(-1)[0]}` : ""}
        {session.pr ? ` · #${session.pr.number}` : ""}
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-hidden rounded bg-black/50 p-2 font-mono text-[10px] leading-relaxed text-white/55">
        {(feed?.tail ?? []).slice(focused ? -14 : -5).map((line, i) => (
          <div key={i} className="truncate">{line}</div>
        ))}
        {feed?.tool && <div className="text-sky-300/80">▸ {feed.tool}</div>}
        {!feed?.tail.length && !feed?.tool && <div className="text-white/25">{session.status}…</div>}
      </div>
      {feed?.files && (
        <div className="mt-2 font-mono text-[10px]">
          <span className="text-emerald-300">+{feed.files.added}</span> <span className="text-red-300">−{feed.files.removed}</span>
          <span className="text-white/40"> · {feed.files.files} files</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {feed.files.touched.slice(0, focused ? 8 : 3).map((p) => (
              <span key={p} className="max-w-40 truncate rounded bg-white/[.06] px-1 text-white/50">{p.split("/").slice(-1)[0]}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
const STAGES = ["code", "ci", "review", "repair", "merge", "deploy"] as const;
const STAGE_GLYPH: Record<string, string> = { done: "●", active: "◐", failed: "✕", waiting: "○", skipped: "·" };
const STAGE_CLASS: Record<string, string> = {
  done: "text-emerald-400",
  active: "animate-pulse text-sky-300",
  failed: "text-red-400",
  waiting: "text-white/25",
  skipped: "text-white/15",
};

export function PrPipelines({ status, ops }: { status: CockpitStatus; ops: CockpitActions | null }) {
  const rows = status.prs.active.slice(0, 10);
  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      <div className="font-mono text-xs tracking-widest text-white/40">
        PULL REQUESTS · {status.prs.active.length} in flight
        {status.prs.parked.length > 0 && <span className="text-amber-400/80"> · {status.prs.parked.length} need a human</span>}
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
        {rows.map((pr) => (
          <PrRow key={pr.id} pr={pr} ops={ops} />
        ))}
        {status.prs.parked.slice(0, 4).map((pr) => (
          <PrRow key={pr.id} pr={pr} parked ops={ops} />
        ))}
      </div>
    </div>
  );
}

function PrRow({ pr, parked, ops }: { pr: CockpitPr; parked?: boolean; ops: CockpitActions | null }) {
  return (
    <div className={`rounded border px-2 py-1.5 ${parked ? "border-amber-500/30 bg-amber-500/[.04]" : "border-white/10 bg-white/[.03]"}`}>
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-mono text-white/50">{pr.repo}#{pr.number}</span>
        <span className="truncate text-white/85">{pr.title}</span>
      </div>
      <div className="mt-1 flex items-center gap-1 font-mono text-[11px]">
        {STAGES.map((st, i) => (
          <span key={st} className="flex items-center gap-1">
            {i > 0 && <span className="text-white/15">—</span>}
            <span className={STAGE_CLASS[pr.stages[st]]} title={`${st}: ${pr.stages[st]}`}>
              {STAGE_GLYPH[pr.stages[st]]}
            </span>
          </span>
        ))}
        <span className="ml-2 truncate text-[10px] text-white/35">
          {parked && pr.parkedReason ? pr.parkedReason : pr.ci ? `ci ${pr.ci.state}${pr.review?.verdict ? ` · ${pr.review.verdict.toLowerCase()}` : ""}${pr.repair.attempts ? ` · repair ${pr.repair.attempts}/${pr.repair.cap}` : ""}` : ""}
        </span>
        {ops && pr.stages.merge !== "done" && (
          <span className="ml-auto flex gap-1">
            <OpsButton label="review" busy={ops.triggerReview.isPending} onClick={() => ops.triggerReview.mutate({ pullRequestId: pr.id })} />
            <OpsButton label="✓" tone="go" confirm="approve?" busy={ops.reviewPr.isPending} onClick={() => ops.reviewPr.mutate({ pullRequestId: pr.id, verdict: "APPROVE" })} />
            <OpsButton label="✗" tone="danger" confirm="reject?" busy={ops.reviewPr.isPending} onClick={() => ops.reviewPr.mutate({ pullRequestId: pr.id, verdict: "REQUEST_CHANGES" })} />
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function Timeline24h({ status }: { status: CockpitStatus }) {
  const buckets = useMemo(() => {
    const mk = (arr: number[]) => arr.map((v) => v);
    return { d: mk(status.sparklines.dispatches), m: mk(status.sparklines.merges), e: mk(status.sparklines.errors) };
  }, [status]);
  const maxV = Math.max(1, ...buckets.d, ...buckets.m, ...buckets.e);
  const recent = status.timeline.slice(-7).reverse();
  return (
    <div className="flex items-center gap-6 border-t border-white/10 px-6 py-2">
      <div className="flex items-end gap-[3px]" title="last 24h — dispatches (grey) · merges (green) · errors (red)">
        {buckets.d.map((v, i) => (
          <div key={i} className="flex w-[7px] flex-col justify-end gap-[1px]" style={{ height: 34 }}>
            <div className="w-full rounded-sm bg-red-400/70" style={{ height: `${(buckets.e[i]! / maxV) * 100}%` }} />
            <div className="w-full rounded-sm bg-emerald-400/80" style={{ height: `${(buckets.m[i]! / maxV) * 100}%` }} />
            <div className="w-full rounded-sm bg-white/25" style={{ height: `${(v / maxV) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 gap-4 overflow-hidden font-mono text-[11px] text-white/45">
        {recent.map((e, i) => (
          <span key={i} className="whitespace-nowrap">
            <span className={e.kind === "merge" ? "text-emerald-300" : e.kind === "failure" || e.kind === "deploy_failed" ? "text-red-300" : e.kind === "deploy" ? "text-sky-300" : "text-white/40"}>
              {e.kind === "merge" ? "◆" : e.kind === "deploy" ? "🚀" : e.kind === "failure" ? "✗" : e.kind === "pr" ? "▲" : "·"}
            </span>{" "}
            {e.label}
          </span>
        ))}
      </div>
      <div className="font-mono text-[11px] text-white/30">
        24h: {status.sparklines.dispatches.reduce((a, b) => a + b, 0)} runs · {status.sparklines.merges.reduce((a, b) => a + b, 0)} merges
      </div>
    </div>
  );
}
