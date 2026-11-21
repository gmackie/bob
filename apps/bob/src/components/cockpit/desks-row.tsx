"use client";

/**
 * Agent Desks on the cockpit wall (BOB-98): one card per watched item with its live agent
 * tail and CI phases, from @bob/arcade's desks(), the same cards iPhone and iPad draw.
 * Nothing moves unless a new tail frame arrives (the newest line fades in), and a desk
 * with no detail says so.
 */
import type { Desk } from "@bob/arcade";
import type { CiPhase } from "@bob/sdlc-view";

const PHASE = { queued: "#6a5638", running: "#6fb4ff", passed: "#7dffb0", failed: "#ff6b6b", skipped: "#3a2f22", unknown: "#3a2f22" } satisfies Record<CiPhase["status"], string>;
const ATTENTION = { needs_human: "#e7a505", failed: "#ef5350", stalled: "#f59e0b", ok: null } as const;

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

export function DesksRow({ desks, now }: { desks: Desk[]; now: number }) {
  if (!desks.length) return null;
  return (
    <div className="px-3 pb-3" aria-label="Agent desks">
      <style>{`@keyframes desk-line { from { opacity: 0 } to { opacity: 1 } }`}</style>
      <div className="pb-1.5 font-mono text-[10px] tracking-widest text-[#8a7758]">DESKS {desks.length}</div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
        {desks.map((d) => {
          const edge = ATTENTION[d.attention] ?? `hsl(${d.hue} 45% 32%)`;
          const newest = d.lines.length - 1;
          return (
            <li key={d.itemId}>
              <a
                href={`/sdlc?item=${encodeURIComponent(d.itemId)}`}
                aria-label={d.accessibilityLabel}
                title={d.accessibilityLabel}
                className="flex flex-col gap-1 rounded-lg border bg-[#1a1510] p-2.5 hover:brightness-110"
                style={{ borderColor: edge }}
              >
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: ATTENTION[d.attention] ?? `hsl(${d.hue} 70% 60%)` }} />
                  <span className="flex-1 truncate font-mono text-xs font-extrabold text-[#ffd27a]">
                    {d.label}
                    {d.attention === "needs_human" ? "  !" : ""}
                  </span>
                  <span className="truncate font-mono text-[9px] tracking-widest text-[#8a7758]">{d.stateLabel.toUpperCase()}</span>
                </span>
                <span className="truncate text-[11px] text-white/40">
                  {d.repo}
                  {d.threadStatus ? ` · ${d.threadStatus}` : ""}
                  {d.tailAt !== null && d.quiet ? ` · quiet ${ago(now - d.tailAt)}` : ""}
                </span>
                <span className="flex min-h-[56px] flex-col justify-end">
                  {d.lines.length ? (
                    d.lines.map((line, i) => (
                      <span
                        key={i === newest ? `${d.tailAt ?? 0}:${i}` : i}
                        className="truncate font-mono text-[10px]"
                        style={{ color: i === newest && !d.quiet ? "#d9c9a8" : "#8a7758", animation: i === newest ? "desk-line .25s ease-out" : undefined }}
                      >
                        {line || " "}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-white/40">{d.note ? `No live detail: ${d.note}` : "No live detail yet."}</span>
                  )}
                </span>
                {d.ci ? (
                  <span className="flex items-center gap-[3px]" aria-label={`CI ${d.ci.summary}`}>
                    {d.ci.phases.slice(0, 12).map((p, i) => (
                      <span key={`${p.name}:${i}`} title={`${p.name}: ${p.status}`} className="h-1.5 w-2.5 rounded-sm" style={{ backgroundColor: PHASE[p.status] }} />
                    ))}
                    <span className="ml-1 truncate font-mono text-[9px] text-[#8a7758]">CI {d.ci.summary}</span>
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
