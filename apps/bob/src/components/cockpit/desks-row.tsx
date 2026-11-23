"use client";

/**
 * Agent Desks on the cockpit wall (BOB-98): one miniature glowing CRT workstation per
 * watched item with its live agent avatar, syntax-tinted WebSocket tail, and animated CI
 * pipeline rail, all derived from @bob/arcade's desks() & deskMood().
 */
import type { CiPhase } from "@bob/sdlc-view";

import { deskMood, MOOD_LABEL, tailLineTone } from "./floor-model";
import type { Desk, DeskMood } from "./floor-model";
import { AgentAvatarSvg } from "./station-sprites";

const PHASE = { queued: "#5c4c38", running: "#6fb4ff", passed: "#7dffb0", failed: "#ff6b6b", skipped: "#3a2f22", unknown: "#3a2f22" } satisfies Record<CiPhase["status"], string>;
const ATTENTION = { needs_human: "#e7a505", failed: "#ef5350", stalled: "#f59e0b", ok: null } as const;

const MOOD_ACCENT: Record<DeskMood, string> = {
  asking: "#ffd27a",
  testing: "#6fb4ff",
  building: "#f0a94d",
  shipping: "#c09cff",
  coding: "#7fd3e8",
  "ci-running": "#6fb4ff",
  "ci-green": "#7dffb0",
  "ci-failed": "#ff6b6b",
  stalled: "#ff9f43",
  idle: "#78664b",
};

const LINE_COLOR = {
  "command-run": "#7fd3e8",
  "command-ok": "#7dffb0",
  "command-fail": "#ff7b7b",
  question: "#ffd27a",
  prose: "#e6d8bc",
} as const;

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

export function DesksRow({ desks, now }: { desks: Desk[]; now: number }) {
  if (!desks.length) return null;
  return (
    <div className="border-t border-[#292016] bg-[#100c09]/90 px-3 py-3" aria-label="Agent desks">
      <style>{`
        @keyframes desk-line { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
        @keyframes desk-caret { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }
        @keyframes desk-phase-pulse { 0%,100% { opacity: 1; box-shadow: 0 0 8px #6fb4ffaa } 50% { opacity: .55; box-shadow: 0 0 2px #6fb4ff44 } }
      `}</style>
      <div className="flex items-center gap-2 pb-2 font-mono text-[10px] font-bold tracking-[0.16em] text-[#8a7758]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#ffd27a]" />
        <span>AGENT DESKS</span>
        <span className="rounded bg-[#221b13] px-1.5 py-[0.5px] text-[9px] text-[#ffd27a]">{desks.length}</span>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-2.5">
        {desks.map((d) => {
          const mood = deskMood(d);
          const moodColor = MOOD_ACCENT[mood];
          const repoColor = `hsl(${d.hue} 72% 58%)`;
          const edge = ATTENTION[d.attention] ?? `hsl(${d.hue} 42% 30%)`;
          const newest = d.lines.length - 1;
          const live = !d.quiet && (mood === "coding" || mood === "testing" || mood === "building" || mood === "shipping");

          return (
            <li key={d.itemId}>
              <a
                href={`/sdlc?item=${encodeURIComponent(d.itemId)}`}
                aria-label={d.accessibilityLabel}
                title={d.accessibilityLabel}
                className="relative flex flex-col gap-1.5 overflow-hidden rounded-xl border p-2.5 transition-all hover:brightness-110"
                style={{
                  borderColor: edge,
                  background: "linear-gradient(180deg, #1b1510 0%, #14100b 100%)",
                  boxShadow:
                    d.attention !== "ok"
                      ? `0 0 14px ${ATTENTION[d.attention]}30, inset 0 1px 0 rgba(255,255,255,0.06)`
                      : live
                        ? `0 0 12px ${moodColor}20, inset 0 1px 0 rgba(255,255,255,0.06)`
                        : "inset 0 1px 0 rgba(255,255,255,0.04)",
                }}
              >
                {/* Luminous repo-color top accent strip */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
                  style={{ background: `linear-gradient(90deg, ${repoColor}, ${moodColor})` }}
                />

                {/* Workstation header with custom live robot avatar */}
                <span className="flex items-center gap-2 pt-0.5">
                  <AgentAvatarSvg mood={mood} hue={d.hue} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-xs font-black text-[#ffd27a]">
                        {d.label}
                        {d.attention === "needs_human" ? " !" : ""}
                      </span>
                      <span
                        className="ml-auto shrink-0 rounded-full border px-1.5 py-[0.5px] font-mono text-[8.5px] font-bold tracking-widest"
                        style={{
                          color: moodColor,
                          borderColor: `${moodColor}55`,
                          backgroundColor: `${moodColor}14`,
                        }}
                      >
                        {MOOD_LABEL[mood]}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-[#9b896c]">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-sm" style={{ backgroundColor: repoColor }} />
                      <span className="truncate">{d.repo}</span>
                      {d.threadStatus ? <span className="opacity-70">· {d.threadStatus}</span> : null}
                      {d.tailAt !== null && d.quiet ? <span className="text-[#a88c5d]">· quiet {ago(now - d.tailAt)}</span> : null}
                    </span>
                  </span>
                </span>

                {/* Recessed CRT terminal viewport */}
                <span
                  className="relative flex min-h-[64px] flex-col justify-end overflow-hidden rounded-lg border border-[#2a2117] bg-[#0a0806] px-2 py-1.5 shadow-[inset_0_2px_8px_rgba(0,0,0,0.85)]"
                  style={{
                    backgroundImage: "repeating-linear-gradient(0deg, rgba(255,210,122,0.025) 0 1px, transparent 1px 3px)",
                  }}
                >
                  {d.lines.length ? (
                    d.lines.map((line, i) => {
                      const isNewest = i === newest;
                      const lineTone = tailLineTone(line);
                      const color = isNewest && !d.quiet ? LINE_COLOR[lineTone] : lineTone === "command-fail" ? "#c96a6a" : "#7e6d53";
                      return (
                        <span
                          key={isNewest ? `${d.tailAt ?? 0}:${i}` : i}
                          className="flex items-center truncate font-mono text-[10px] leading-[1.38]"
                          style={{ color, animation: isNewest ? "desk-line .25s ease-out" : undefined }}
                        >
                          <span className="truncate">{line || "\u00a0"}</span>
                          {isNewest && live ? (
                            <span
                              aria-hidden
                              className="ml-1 inline-block h-[10px] w-[5px] shrink-0 rounded-[1px]"
                              style={{ backgroundColor: moodColor, animation: "desk-caret 1s steps(2) infinite" }}
                            />
                          ) : null}
                        </span>
                      );
                    })
                  ) : (
                    <span className="font-mono text-[10px] text-[#6d5d46]">{d.note ? `No live detail: ${d.note}` : "Waiting for live stream…"}</span>
                  )}
                </span>

                {/* Live CI pipeline phase rail */}
                {d.ci ? (
                  <span className="flex flex-wrap items-center gap-1 pt-0.5" aria-label={`CI ${d.ci.summary}`}>
                    {d.ci.phases.slice(0, 8).map((p, i) => {
                      const c = PHASE[p.status];
                      const running = p.status === "running";
                      return (
                        <span
                          key={`${p.name}:${i}`}
                          title={`${p.name}: ${p.status}`}
                          className="inline-flex items-center gap-1 rounded border px-1 py-[1px] font-mono text-[8.5px]"
                          style={{
                            borderColor: `${c}66`,
                            backgroundColor: `${c}18`,
                            color: p.status === "queued" || p.status === "skipped" ? "#8a7758" : c,
                            animation: running ? "desk-phase-pulse 1.1s ease-in-out infinite" : undefined,
                          }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
                          <span>{p.name}</span>
                        </span>
                      );
                    })}
                    <span className="ml-auto truncate font-mono text-[9px] text-[#8a7758]">CI {d.ci.summary}</span>
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
