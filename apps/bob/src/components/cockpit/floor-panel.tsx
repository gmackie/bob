"use client";

/**
 * The Floor lens on the cockpit wall (BOB-92): Kanbanger issues riding the SDLC belt,
 * from the live SDLC edge. The scene comes from @bob/arcade, the same layout iPhone and
 * iPad draw; parcels slide with a CSS transform transition, so every move is a real
 * coordinator transition. Motion level "minimal" freezes it (the page kills transitions).
 *
 * Slice 3+ (BOB-91 visual overhaul): retro-industrial brass & neon arcade cabinet powered
 * by the live WebSocket stream — machined conveyor with rotating pulleys, custom animated
 * multi-tone station machinery, tactile cartridge parcels with live per-phase CI LEDs and
 * laser scanlines, multi-shape confetti shockwaves, and miniature CRT agent workstations.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";

import type { AttemptState } from "~/components/sdlc/attempt-model";
import { bannerFor } from "~/components/sdlc/sdlc-page-model";
import { useSdlcEdge } from "~/components/sdlc/use-sdlc-edge";

import { DesksRow } from "./desks-row";
import { IssuePanel, ProjectBoard } from "./project-board";
import {
  boardCounters,
  beatLine,
  beatTone,
  busiestStation,
  chooseDesks,
  ciBeats,
  ciProgress,
  createBeatLog,
  desks as deskCards,
  effectFor,
  EFFECT_TTL_MS,
  expire,
  floorHeight,
  floorScene,
  floorScopes,
  floorSummary,
  hud,
  issueLabels,
  liveCiPhases,
  liveScope,
  PARCEL_TONE,
  projectBoard,
  sameDesks,
  sdlcBeats,
  shippedToday,
  tailBeats,
  tickerBeats,
} from "./floor-model";
import type { Beat, BoardRow, CiMessage, EdgeView, FloorParcel, FloorScopeChip, LiveEffect, Scope } from "./floor-model";
import type { BurstKind } from "./spectacle";
import { BinIcon, SPRITE_KEYFRAMES, STATION_GLOW, StationSprite } from "./station-sprites";

/**
 * Which items get a desk, sticky across views: an unchanged choice keeps the same array.
 * `now` should change rarely (a minute clock): it re-judges stalls and so re-chooses desks.
 */
function useDeskIds(view: EdgeView, now: number, scope: Scope): readonly string[] {
  const [held, setHeld] = useState(() => ({ view, now, scope, ids: chooseDesks(view, [], { now, scope }) }));
  if (held.view !== view || held.now !== now || held.scope !== scope) {
    const next = chooseDesks(view, held.ids, { now, scope });
    const ids = sameDesks(next, held.ids) ? held.ids : next;
    setHeld({ view, now, scope, ids });
    return ids;
  }
  return held.ids;
}

function useClock(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const ATTENTION_RING = { needs_human: "#e7a505", failed: "#ef5350", stalled: "#f59e0b", ok: "transparent" } as const;
const TONE = { good: "#7dffb0", info: "#6fb4ff", warn: "#ffd27a", bad: "#ff6b6b" } as const;
const PHASE_LED = { queued: "#4b3e2e", running: "#6fb4ff", passed: "#7dffb0", failed: "#ff6b6b", skipped: "#3a2f22", unknown: "#3a2f22" } as const;
const CONFETTI = ["#7dffb0", "#ffd27a", "#6fb4ff", "#ff8ad8", "#d4850a", "#c39bff", "#ffffff"];
/** How long a parcel keeps "typing" after its agent's last tail lines. */
const TYPING_MS = 3_600;

const KEYFRAMES = `
  @keyframes floor-rise { 0% { opacity: 0; transform: translate(-50%, -4px) scale(.88); } 18% { opacity: 1; transform: translate(-50%, -18px) scale(1.04); } 100% { opacity: 0; transform: translate(-50%, -48px) scale(.98); } }
  @keyframes floor-stamp { 0% { opacity: 0; transform: translate(-50%, -50%) scale(2.5) rotate(-16deg); } 16% { opacity: 1; transform: translate(-50%, -50%) scale(.95) rotate(-7deg); } 26% { transform: translate(-50%, -50%) scale(1.03) rotate(-8deg); } 82% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -50%) scale(1) rotate(-8deg); } }
  @keyframes floor-burst-text { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.35); } 24% { opacity: 1; transform: translate(-50%, -155%) scale(1.38); } 100% { opacity: 0; transform: translate(-50%, -270%) scale(1); } }
  @keyframes floor-ring { 0% { opacity: .9; transform: translate(-50%, -50%) scale(.2); } 100% { opacity: 0; transform: translate(-50%, -50%) scale(2.4); } }
  @keyframes floor-confetti { from { opacity: 1; transform: translate(-50%, -50%) rotate(0) scale(1); } to { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) rotate(var(--rot)) scale(.7); } }
  @keyframes floor-spark { from { opacity: 1; transform: translate(0, 0) scale(1.1); } to { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(.2); } }
  @keyframes floor-spark-text { 0% { opacity: 0; transform: translate(-50%, -2px) scale(.9); } 20% { opacity: 1; transform: translate(-50%, -12px) scale(1); } 100% { opacity: 0; transform: translate(-50%, -28px) scale(.95); } }
  @keyframes floor-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3.5px) } }
  @keyframes floor-sonar { 0% { opacity: .75; transform: scale(1) } 100% { opacity: 0; transform: scale(1.22, 1.45) } }
  @keyframes floor-belt { to { background-position: 24px 0; } }
  @keyframes floor-energy { 0% { left: -12%; opacity: 0; } 12% { opacity: .9; } 88% { opacity: .9; } 100% { left: 104%; opacity: 0; } }
  @keyframes floor-pulley { to { transform: rotate(360deg); } }
  @keyframes floor-static { 0%,100% { opacity: .34 } 50% { opacity: .14 } }
  @keyframes floor-type { 0%,100% { transform: translateY(0); opacity: .4 } 50% { transform: translateY(-3px); opacity: 1 } }
  @keyframes floor-typing-out { 0%,84% { opacity: 1 } 100% { opacity: 0 } }
  @keyframes floor-wobble { 0%,100% { rotate: 0deg } 25% { rotate: -2.6deg } 75% { rotate: 2.6deg } }
  @keyframes floor-scanline { 0% { transform: translateX(-110%); opacity: 0; } 20% { opacity: .7; } 80% { opacity: .7; } 100% { transform: translateX(220%); opacity: 0; } }
  @keyframes floor-led-pulse { 0%,100% { opacity: 1; filter: brightness(1.25); } 50% { opacity: .45; filter: brightness(.85); } }
  @keyframes floor-thruster { 0%,100% { opacity: .45; transform: scaleX(.92); } 50% { opacity: .95; transform: scaleX(1.06); } }
  @keyframes floor-ticker { from { opacity: 0; transform: translateY(5px) } to { opacity: 1; transform: none } }
  ${SPRITE_KEYFRAMES}
`;

/** Deterministic pseudo-random spread per effect, so a re-render doesn't re-roll the particles. */
const spread = (seed: string, i: number) => {
  let h = 2166136261 ^ i;
  for (let k = 0; k < seed.length; k++) h = Math.imul(h ^ seed.charCodeAt(k), 16777619);
  return ((h >>> 0) % 1000) / 1000;
};

function Confetti({ e, x, y }: { e: LiveEffect; x: number; y: number }) {
  const color = TONE[e.tone];
  return (
    <>
      {/* Expanding shockwave ring */}
      <span
        aria-hidden
        className="pointer-events-none absolute rounded-full border-2"
        style={{
          left: x,
          top: y,
          width: 44,
          height: 44,
          borderColor: color,
          boxShadow: `0 0 12px ${color}`,
          animation: "floor-ring .9s cubic-bezier(.15,.7,.3,1) forwards",
        }}
      />
      {Array.from({ length: 20 }, (_, i) => {
        const angle = (i / 20) * Math.PI * 2 + spread(e.beatId, i) * 0.55;
        const dist = 36 + spread(e.beatId, i + 50) * 56;
        const diamond = i % 4 === 0;
        const c = CONFETTI[i % CONFETTI.length] ?? color;
        const style = {
          left: x,
          top: y,
          width: diamond ? 6 : i % 3 ? 6 : 3.5,
          height: diamond ? 6 : i % 3 ? 3.5 : 8,
          backgroundColor: c,
          boxShadow: `0 0 5px ${c}88`,
          borderRadius: diamond ? 1 : i % 2 ? 99 : 1,
          "--dx": `${Math.cos(angle) * dist}px`,
          "--dy": `${Math.sin(angle) * dist + 18}px`,
          "--rot": `${(spread(e.beatId, i + 99) - 0.5) * 820}deg`,
          animation: `floor-confetti 1.4s cubic-bezier(.14,.74,.28,1) ${Math.floor((i % 3) * 35)}ms forwards`,
        } as CSSProperties;
        return <span key={i} aria-hidden className="pointer-events-none absolute" style={style} />;
      })}
    </>
  );
}

function Sparks({ e, x, y, hue }: { e: LiveEffect; x: number; y: number; hue: number }) {
  return (
    <>
      {Array.from({ length: 7 }, (_, i) => {
        const angle = -Math.PI / 2 + (spread(e.beatId, i) - 0.5) * 2.5;
        const dist = 14 + spread(e.beatId, i + 20) * 20;
        const color = e.tone === "warn" ? TONE.warn : e.tone === "good" ? TONE.good : `hsl(${hue} 92% 74%)`;
        const style = {
          left: x + (spread(e.beatId, i + 40) - 0.5) * 34,
          top: y - 10,
          backgroundColor: color,
          boxShadow: `0 0 6px ${color}`,
          "--dx": `${Math.cos(angle) * dist}px`,
          "--dy": `${Math.sin(angle) * dist}px`,
          animation: `floor-spark .75s ease-out ${i * 35}ms forwards`,
        } as CSSProperties;
        return <span key={i} aria-hidden className="pointer-events-none absolute h-[4.5px] w-[4.5px] rounded-full opacity-0" style={style} />;
      })}
      {e.text ? (
        <div
          aria-hidden
          className="pointer-events-none absolute whitespace-nowrap rounded-full border px-1.5 py-[1px] font-mono text-[9px] font-extrabold tracking-widest"
          style={{
            left: x,
            top: y - 16,
            color: TONE[e.tone],
            borderColor: `${TONE[e.tone]}66`,
            backgroundColor: "#120f0be6",
            boxShadow: `0 0 8px ${TONE[e.tone]}44`,
            animation: "floor-spark-text 1.15s ease-out forwards",
          }}
        >
          {e.text}
        </div>
      ) : null}
    </>
  );
}

function EffectSprite({ e, x, y, hue }: { e: LiveEffect; x: number; y: number; hue: number }) {
  const color = TONE[e.tone];
  switch (e.kind) {
    case "spark":
      return <Sparks e={e} x={x} y={y} hue={hue} />;
    case "burst":
      return (
        <>
          <Confetti e={e} x={x} y={y} />
          <div
            aria-hidden
            className="pointer-events-none absolute whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[14px] font-black tracking-[0.16em]"
            style={{
              left: x,
              top: y,
              color,
              borderColor: `${color}aa`,
              backgroundColor: "#120f0be6",
              textShadow: `0 0 10px ${color}`,
              boxShadow: `0 0 18px ${color}55`,
              animation: "floor-burst-text 1.65s ease-out forwards",
            }}
          >
            ★ {e.text}
          </div>
        </>
      );
    case "stamp":
      return (
        <div
          aria-hidden
          className="pointer-events-none absolute whitespace-nowrap rounded border-2 px-2 py-0.5 font-mono text-[11px] font-black tracking-[0.14em]"
          style={{
            color,
            borderColor: color,
            left: x,
            top: y,
            backgroundColor: "#14100be8",
            boxShadow: `0 0 14px ${color}55, inset 0 0 0 1px ${color}44`,
            textShadow: `0 0 6px ${color}88`,
            animation: "floor-stamp 1.65s ease-out forwards",
          }}
        >
          {e.text}
        </div>
      );
    default:
      return (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute rounded-full border"
            style={{
              left: x,
              top: y,
              width: 24,
              height: 24,
              borderColor: `${color}88`,
              animation: "floor-ring .8s ease-out forwards",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute whitespace-nowrap rounded-full border px-2 py-[1px] font-mono text-[11px] font-black tracking-widest"
            style={{
              left: x,
              top: y,
              color,
              borderColor: `${color}66`,
              backgroundColor: "#14100be0",
              textShadow: `0 0 6px ${color}66`,
              animation: "floor-rise 1.4s ease-out forwards",
            }}
          >
            {e.text}
          </div>
        </>
      );
  }
}

/** Live segmented CI LED strip tucked under a parcel: each real WebSocket phase lights its own pip. */
function CiMeter({ ci, w }: { ci: CiMessage | undefined; w: number }) {
  const phases = liveCiPhases(ci, 8);
  if (!phases.length) return null;
  const progress = ciProgress(phases);
  const failed = phases.some((p) => p.status === "failed");
  const allGreen = !failed && progress >= 1;
  return (
    <span
      aria-hidden
      className="absolute -bottom-[6px] left-[2px] flex h-[4px] items-center gap-[1.5px] rounded-full bg-[#090705] px-[1.5px] py-[0.5px]"
      style={{
        width: w - 4,
        boxShadow: allGreen ? "0 0 6px #7dffb077" : failed ? "0 0 6px #ff6b6b77" : "0 0 5px #6fb4ff44",
      }}
    >
      {phases.map((phase, i) => {
        const running = phase.status === "running";
        const color = PHASE_LED[phase.status];
        return (
          <span
            key={`${phase.name}:${i}`}
            className="h-[2.5px] flex-1 rounded-full transition-colors duration-300"
            style={{
              backgroundColor: color,
              boxShadow: running || phase.status === "passed" || phase.status === "failed" ? `0 0 4px ${color}` : undefined,
              animation: running ? "floor-led-pulse .85s ease-in-out infinite" : undefined,
            }}
          />
        );
      })}
    </span>
  );
}

/** Machined brass conveyor pulley wheel at either end of the belt. */
function BeltPulley({ x, y, running, speed }: { x: number; y: number; running: boolean; speed: number }) {
  return (
    <svg
      aria-hidden
      width={20}
      height={20}
      viewBox="0 0 20 20"
      className="pointer-events-none absolute"
      style={{ left: x - 10, top: y - 10 }}
    >
      <circle cx="10" cy="10" r="8.5" fill="#1d1710" stroke="#78603c" strokeWidth="1.6" />
      <g style={running ? { animation: `floor-pulley ${speed * 1.8}s linear infinite`, transformOrigin: "10px 10px" } : undefined}>
        <line x1="10" y1="3.5" x2="10" y2="16.5" stroke="#b5945d" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="3.5" y1="10" x2="16.5" y2="10" stroke="#b5945d" strokeWidth="1.5" strokeLinecap="round" />
      </g>
      <circle cx="10" cy="10" r="2.6" fill="#ffd27a" stroke="#17130e" strokeWidth="1" />
    </svg>
  );
}

function ScopeChips({ chips, scope, onScope }: { chips: FloorScopeChip[]; scope: Scope; onScope: (s: Scope) => void }) {
  if (!chips.length) return null;
  const active = (c: FloorScopeChip) => (c.level === "repo" ? scope.repoKey === c.scope.repoKey : scope.startupId === c.scope.startupId);
  return (
    <>
      {chips.map((c) => {
        const isOn = active(c);
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onScope(isOn ? (c.level === "repo" ? { ...(scope.startupId ? { startupId: scope.startupId } : {}) } : {}) : c.scope)}
            aria-pressed={isOn}
            className="flex items-center gap-1.5 rounded-full border px-2.5 py-[2px] font-mono text-[10px] normal-case tracking-normal transition-all hover:brightness-125"
            style={{
              borderColor: isOn ? "#ffd27a" : "#3a2e20",
              color: isOn ? "#ffd27a" : "#a08b69",
              backgroundColor: isOn ? "#2c2215" : "#18130d",
              boxShadow: isOn ? "0 0 10px #d4850a38, inset 0 1px 0 #ffd27a33" : "inset 0 1px 0 #ffffff08",
            }}
            title={`${c.level === "repo" ? "Repo" : "Project"} ${c.label}: ${c.count} items${c.attention ? `, ${c.attention} need attention` : ""}`}
          >
            {c.hue !== null ? (
              <span
                className="h-2 w-2 rounded-sm"
                style={{
                  backgroundColor: `hsl(${c.hue} 70% 56%)`,
                  boxShadow: isOn ? `0 0 6px hsl(${c.hue} 80% 60%)` : undefined,
                }}
              />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: isOn ? "#ffd27a" : "#6a5638" }} />
            )}
            <span className="font-semibold">{c.label}</span>
            <span className="rounded bg-black/35 px-1 text-[9px] tabular-nums opacity-85">{c.count}</span>
            {c.attention ? <span className="font-black text-[#e7a505]">!</span> : null}
          </button>
        );
      })}
    </>
  );
}

function HudTile({ label, value, color, lit, title }: { label: string; value: number | string; color: string; lit?: boolean; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-baseline gap-1.5 rounded border px-2 py-[2px]"
      style={{
        backgroundColor: "#0c0907",
        borderColor: lit ? `${color}55` : "#292117",
        boxShadow: lit ? `inset 0 0 8px ${color}18` : "inset 0 1px 2px #00000080",
      }}
    >
      <span className="text-[9px] tracking-[0.14em] text-[#8a7758]">{label}</span>
      <b className="text-[13px] font-black tabular-nums" style={{ color, textShadow: lit ? `0 0 8px ${color}66` : undefined }}>
        {value}
      </b>
    </span>
  );
}

export function FloorPanel({ onCue }: { onCue?: (kind: BurstKind) => void } = {}) {
  const { view, attempt, watchDesks, watching, followShipped, shipped, connection, commands, send } = useSdlcEdge();
  // BOB-99: the projects board scopes the Floor to one Kanbanger project; an issue parcel opens its panel.
  const [project, setProject] = useState<BoardRow | null>(null);
  const [issueId, setIssueId] = useState<string | null>(null);
  const now = useClock(15_000);
  const [pickedScope, setScope] = useState<Scope>({});
  const scope = useMemo(() => liveScope(view, pickedScope), [view, pickedScope]);
  const stableScope = useStableScope(scope);
  const deskIds = useDeskIds(view, Math.floor(now / 60_000) * 60_000, stableScope);
  useEffect(() => watchDesks(deskIds), [watchDesks, deskIds]);
  useEffect(() => followShipped(), [followShipped]);
  const desks = useMemo(
    () =>
      deskCards(view, deskIds.filter((id) => watching.includes(id)), (id) => ({ tail: attempt.tails[id] ?? null, ci: attempt.ci[id] ?? null, tailUnavailable: attempt.unavailable[id] ?? null }), now),
    [view, deskIds, watching, attempt, now],
  );
  const today = shipped ? shippedToday(shipped, now) : null;
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setBox((cur) => (cur && cur.width === width && cur.height === height ? cur : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const log = useMemo(() => createBeatLog(80), []);
  const [effects, setEffects] = useState<LiveEffect[]>([]);
  /** Last agent activity per item (epoch ms): drives the typing dots. */
  const [typing, setTyping] = useState<Record<string, number>>({});
  const issues = useMemo(() => issueLabels(view), [view]);
  const cueRef = useRef(onCue);
  useEffect(() => {
    cueRef.current = onCue;
  }, [onCue]);

  const ingest = useCallback(
    (beats: Beat[]) => {
      const at = Date.now();
      const fresh = log.push(beats);
      if (!fresh.length) return;
      const fx = fresh.flatMap((b) => {
        const e = effectFor(b);
        return e ? [{ ...e, born: at }] : [];
      });
      if (fx.length) setEffects((cur) => [...expire(cur, at), ...fx].slice(-32));
      const active = fresh.filter((b) => b.kind === "agent.activity" && b.subject.itemId);
      if (active.length) setTyping((cur) => ({ ...cur, ...Object.fromEntries(active.map((b) => [b.subject.itemId!, at])) }));
      // Outcomes the floor saw first also light the full-screen spectacle & chimes immediately.
      for (const b of fresh) {
        if (b.kind === "ci.green") cueRef.current?.("pr");
        else if (b.kind === "ci.phase" && b.data?.to === "failed") cueRef.current?.("failure");
        else if (b.kind === "item.failed") cueRef.current?.("failure");
        else if (b.kind === "milestone" && b.data?.milestone === "merged") cueRef.current?.("merge");
        else if (b.kind === "milestone" && b.data?.milestone === "production-verified") cueRef.current?.("deploy");
      }
    },
    [log],
  );

  // SDLC edge: coordinator transitions, releases and milestones.
  const prev = useRef<EdgeView | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    if (!before || before === view) return;
    ingest(sdlcBeats(before, view, Date.now()));
  }, [view, ingest]);

  // Attempt stream: tail frames and CI for watched items (desks), between transitions.
  const prevAttempt = useRef<AttemptState | null>(null);
  useEffect(() => {
    const before = prevAttempt.current;
    prevAttempt.current = attempt;
    if (!before || before === attempt) return;
    const beats: Beat[] = [];
    for (const [id, frame] of Object.entries(attempt.tails)) if (before.tails[id] !== frame) beats.push(...tailBeats(before.tails[id], frame, issues.get(id)));
    for (const [id, ci] of Object.entries(attempt.ci)) if (before.ci[id] !== ci) beats.push(...ciBeats(before.ci[id], ci, issues.get(id)));
    if (beats.length) ingest(beats);
    // A new view alone (same attempt) returns early above: issues is only read, never a trigger.
  }, [attempt, issues, ingest]);

  useEffect(() => {
    if (!effects.length) return undefined;
    const id = setTimeout(() => setEffects((cur) => expire(cur, Date.now())), EFFECT_TTL_MS);
    return () => clearTimeout(id);
  }, [effects]);
  useSyncExternalStore(log.subscribe, log.version, log.version);

  // Ages and stalls move by the minute (BOB-101); re-laying out every tick would restart transitions.
  const clock = Math.floor(now / 60_000) * 60_000;
  const projectId = project?.kanbanger ? project.projectId : undefined;
  const scopes = useMemo(() => floorScopes(view, stableScope), [view, stableScope]);
  const height = floorHeight(busiestStation(view, stableScope));
  const scene = useMemo(
    () => (box ? floorScene(view, box, { orientation: "wide", now: clock, scope: stableScope, density: "auto", ...(projectId ? { projectId } : {}) }) : null),
    [view, box, clock, stableScope, projectId],
  );
  const hasIssues = Object.keys(view.issues).length > 0;
  const board = useMemo(() => (hasIssues ? projectBoard(view, clock) : null), [view, hasIssues, clock]);
  const issue = issueId ? view.issues[issueId] : undefined;
  const context = { connection, banner: bannerFor(view, connection, now), hasView: view.epoch !== null, commands };
  const counts = hud(view, stableScope, clock);
  const at = new Map<string, FloorParcel>(scene ? scene.parcels.map((p) => [p.itemId, p] as const) : []);
  const gap = effects.some((e) => e.kind === "static");
  const ticker = tickerBeats(log.recent(12), 3);
  const beltSpeed = Math.max(0.35, 1.2 - counts.inFlight * 0.08);
  const beltRunning = counts.inFlight > 0;
  const beltStations = scene ? scene.stations.filter((s) => s.kind === "belt") : [];
  const binStations = scene ? scene.stations.filter((s) => s.kind === "bin") : [];
  const colW = scene && beltStations.length ? (scene.width - 24) / beltStations.length : 0;

  return (
    <section
      className="relative mx-4 mb-3 overflow-hidden rounded-xl border border-[#3d3020] shadow-[0_12px_36px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,210,122,0.12)]"
      style={{
        background: "radial-gradient(ellipse 90% 60% at 50% 0%, #1c150e 0%, #120e0a 58%, #0d0a07 100%)",
      }}
      aria-label="The Floor: SDLC items by stage"
    >
      <style>{KEYFRAMES}</style>
      {/* Top arcade marquee & scoreboard HUD */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-[#2c2318] bg-[#16110c]/90 px-3 py-2 font-mono text-[10px] tracking-widest text-[#8a7758]">
        <span className="mr-1 flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{
              backgroundColor: connection === "live" ? "#7dffb0" : "#ffd27a",
              boxShadow: connection === "live" ? "0 0 8px #7dffb0" : "0 0 6px #ffd27a",
              animation: connection === "live" ? "floor-led-pulse 2.2s ease-in-out infinite" : undefined,
            }}
          />
          <span className="font-black tracking-[0.2em] text-[#ffd27a]" style={{ textShadow: "0 0 10px #d4850a66" }}>
            BOB ARCADE
          </span>
        </span>
        {board ? boardCounters(project ? board.rows.filter((r) => r.projectId === project.projectId) : board.rows).map(({ label, value, color }) => (
          <HudTile key={label} label={label} value={value} color={color} lit={value > 0} />
        )) : <>
        <HudTile label="AGENTS" value={counts.agents} color="#6fb4ff" lit={counts.agents > 0} />
        <HudTile label="IN FLIGHT" value={counts.inFlight} color="#ffd27a" lit={counts.inFlight > 0} />
        <HudTile label="CI" value={counts.ci} color="#7fd3e8" lit={counts.ci > 0} />
        <HudTile label="NEEDS YOU" value={counts.needsYou} color={counts.needsYou ? "#e7a505" : "#8a7758"} lit={counts.needsYou > 0} />
        <HudTile
          label="STALLED"
          value={counts.stalled}
          color={counts.stalled ? "#ff9f43" : "#8a7758"}
          lit={counts.stalled > 0}
          title="Sat too long where the system should have moved it on"
        />
        <HudTile label="SHIPPED" value={counts.shipped} color="#7dffb0" lit={counts.shipped > 0} />
        <HudTile label="FAILED" value={counts.failed} color={counts.failed ? "#ff6b6b" : "#8a7758"} lit={counts.failed > 0} />
        <HudTile label="TODAY" value={today ?? "–"} color="#7dffb0" lit={Boolean(today)} title="Reached production since local midnight" />
        </>}
        {/* Dot-matrix live telemetry ticker */}
        <span
          className="ml-auto flex min-w-0 max-w-[40%] flex-col items-end gap-[1px] rounded border border-[#292016] bg-[#0b0907]/90 px-2 py-1 normal-case tracking-normal"
          aria-live="polite"
        >
          {ticker.length ? (
            ticker.map((b, i) => {
              const c = TONE[beatTone(b)];
              return (
                <span
                  key={b.id}
                  className="flex max-w-full items-center gap-1.5 text-[10px]"
                  style={{ opacity: 1 - i * 0.28, animation: i === 0 ? "floor-ticker .3s ease-out" : undefined }}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: c, boxShadow: i === 0 ? `0 0 6px ${c}` : undefined }} />
                  <span className="truncate text-[#d8c7a8]">{beatLine(b)}</span>
                </span>
              );
            })
          ) : (
            <span className="text-[10px] text-[#6a5638]">Listening for live WebSocket beats…</span>
          )}
        </span>
      </div>
      {board ? (
        <ProjectBoard
          board={board}
          selected={project?.projectId ?? null}
          onSelect={(row) => { setProject(row); setIssueId(null); }}
        />
      ) : null}
      {project ? (
        <div className="flex items-center gap-3 border-b border-[#241c13] bg-[#16110b] px-3 py-1 font-mono text-[11px] text-[#ffd27a]">
          <span className="h-2 w-2 rounded-full bg-[#ffd27a]" />
          <span className="font-bold">{project.name}</span>
          {scene && scene.backlog > 0 ? <span className="rounded bg-[#241d15] px-1.5 py-[1px] text-[10px] text-[#a08b69]">BACKLOG {scene.backlog}</span> : null}
        </div>
      ) : null}
      {scopes.projects.length || scopes.repos.length ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[#241c13] bg-[#130f0a]/80 px-3 py-1.5" aria-label="Scope the floor">
          <span className="mr-1 font-mono text-[9px] tracking-widest text-[#6a5638]">SCOPE</span>
          <ScopeChips chips={scopes.projects} scope={scope} onScope={setScope} />
          {scopes.projects.length && scopes.repos.length ? <span className="mx-1 h-3.5 w-px bg-[#3a2f22]" /> : null}
          <ScopeChips chips={scopes.repos} scope={scope} onScope={setScope} />
        </div>
      ) : null}
      {/* Main Factory Floor Stage */}
      <div
        ref={boxRef}
        className="relative overflow-hidden transition-[height] duration-500"
        style={{
          height,
          backgroundImage: "radial-gradient(rgba(255, 210, 122, 0.07) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      >
        {view.epoch === null ? (
          <div className="flex h-full items-center justify-center font-mono text-xs tracking-widest text-[#8a7758]">
            waiting for the SDLC edge…
          </div>
        ) : scene ? (
          <>
            {/* Ambient overhead stage cones & lane dividers for occupied belt stations */}
            {beltStations.map((s, idx) => {
              const lit = s.count > 0;
              const glow = s.attention && s.attention !== "ok" ? ATTENTION_RING[s.attention] : STATION_GLOW[s.id];
              return (
                <div
                  key={`bay-${s.id}`}
                  aria-hidden
                  className="pointer-events-none absolute top-0 bottom-[26px]"
                  style={{
                    left: s.x - colW / 2,
                    width: colW,
                    borderLeft: idx > 0 ? "1px dashed rgba(106, 86, 56, 0.16)" : undefined,
                    background: lit ? `radial-gradient(ellipse 80% 70% at 50% 16%, ${glow}18 0%, transparent 72%)` : undefined,
                  }}
                />
              );
            })}

            {/* Machined industrial conveyor belt */}
            <div
              aria-hidden
              className="pointer-events-none absolute overflow-hidden rounded-full border border-[#5c4830]"
              style={{
                left: scene.belt.x1,
                top: scene.belt.y1 - 9,
                width: scene.belt.x2 - scene.belt.x1,
                height: 18,
                backgroundColor: "#211a12",
                boxShadow: beltRunning
                  ? "0 3px 14px rgba(0,0,0,0.65), inset 0 2px 4px rgba(0,0,0,0.7), 0 0 12px rgba(212,133,10,0.22)"
                  : "0 2px 8px rgba(0,0,0,0.5), inset 0 2px 4px rgba(0,0,0,0.7)",
              }}
            >
              {/* Metallic upper & lower guide rails */}
              <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-[#5a4730] via-[#8c7048] to-[#5a4730] opacity-70" />
              <div className="absolute inset-x-0 bottom-0 h-[2px] bg-[#0e0b08]" />
              {/* Moving chevron treads */}
              <div
                className="absolute inset-x-0 top-[3px] bottom-[3px]"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(120deg, rgba(212,154,68,0.42) 0 4px, transparent 4px 12px), repeating-linear-gradient(60deg, rgba(212,154,68,0.22) 0 4px, transparent 4px 12px)",
                  backgroundSize: "24px 100%",
                  animation: beltRunning ? `floor-belt ${beltSpeed}s linear infinite` : undefined,
                }}
              />
              {/* Subtle warm power vein & gliding energy pulses when items are in flight */}
              {beltRunning ? (
                <>
                  <div className="absolute inset-x-2 top-1/2 h-[1.5px] -translate-y-1/2 bg-gradient-to-r from-transparent via-[#ffd27a]/45 to-transparent" />
                  {[0, 1].map((idx) => (
                    <span
                      key={idx}
                      className="absolute top-1/2 h-[4px] w-[28px] -translate-y-1/2 rounded-full"
                      style={{
                        background: "linear-gradient(90deg, transparent, #ffd27a, #ffffff, transparent)",
                        boxShadow: "0 0 8px #ffd27a99",
                        animation: `floor-energy ${beltSpeed * 3.4}s linear ${idx * beltSpeed * 1.7}s infinite`,
                      }}
                    />
                  ))}
                </>
              ) : null}
            </div>
            <BeltPulley x={scene.belt.x1 + 4} y={scene.belt.y1} running={beltRunning} speed={beltSpeed} />
            <BeltPulley x={scene.belt.x2 - 4} y={scene.belt.y1} running={beltRunning} speed={beltSpeed} />

            {/* Recessed floor divider above Scrap & Cancelled bins */}
            {binStations[0] ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-3 border-t border-dashed border-[#362b1d]"
                style={{ top: binStations[0].y - 8 }}
              />
            ) : null}

            {/* Stations & custom machinery sprites */}
            {scene.stations.map((s) =>
              s.kind === "belt" ? (
                <div key={s.id} aria-hidden>
                  <StationSprite
                    id={s.id}
                    active={s.count > 0}
                    color={s.attention && s.attention !== "ok" ? ATTENTION_RING[s.attention] : s.count ? STATION_GLOW[s.id] : "#5e4e3a"}
                    x={s.x}
                    y={s.y}
                  />
                  <div
                    className="absolute flex w-[112px] items-center justify-center gap-1 text-center font-mono text-[10px] font-bold tracking-[0.14em]"
                    style={{ left: s.x - 56, top: s.y - 31, color: s.count ? "#ffd27a" : "#78664b" }}
                  >
                    <span>{s.label.toUpperCase()}</span>
                    {s.count ? (
                      <span
                        className="rounded-full px-1.5 py-[0.5px] text-[9px] font-black tabular-nums"
                        style={{
                          backgroundColor: s.attention && s.attention !== "ok" ? `${ATTENTION_RING[s.attention]}33` : "#2b2217",
                          color: s.attention && s.attention !== "ok" ? ATTENTION_RING[s.attention] : "#ffd27a",
                          border: `1px solid ${s.attention && s.attention !== "ok" ? ATTENTION_RING[s.attention] : "#59462d"}`,
                        }}
                      >
                        {s.count}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div
                  key={s.id}
                  aria-hidden
                  className="absolute flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-[0.14em]"
                  style={{ left: s.x, top: s.y - 4, color: s.count ? (s.id === "scrap" ? "#ff6b6b" : "#b8a68a") : "#75634a" }}
                >
                  <BinIcon id={s.id === "scrap" ? "scrap" : "cancelled"} active={s.count > 0} />
                  <span>{s.label.toUpperCase()}</span>
                  {s.count ? <span className="rounded bg-black/40 px-1 text-[9px] tabular-nums">{s.count}</span> : null}
                </div>
              ),
            )}

            {/* Overflow counters */}
            {scene.overflow.map((o) => (
              <div
                key={`over-${o.stationId}`}
                className="absolute flex items-center justify-center rounded-md border border-dashed border-[#6a5638] bg-[#1a140e]/90 font-mono text-[10px] font-bold text-[#ffd27a] shadow-inner"
                style={{ left: o.x - scene.parcel.w / 2, top: o.y - scene.parcel.h / 2, width: scene.parcel.w, height: scene.parcel.h }}
              >
                +{o.count}
              </div>
            ))}

            {/* Tactile glowing arcade cartridge parcels */}
            {scene.parcels.map((p) => {
              const last = typing[p.itemId];
              const working = last !== undefined && now - last < 60_000 && (p.state === "running" || p.state === "waiting-input");
              const compact = scene.density === "compact";
              const tone = PARCEL_TONE[p.tone];
              const ciMsg = attempt.ci[p.itemId];
              const ciRunning = Boolean(ciMsg?.available && ciMsg.phases.some((ph) => ph.status === "running")) || p.stationId === "ci";
              const deploying = p.stationId === "deploy";
              const needsHuman = p.attention === "needs_human";
              const repoAccent = `hsl(${p.hue} 78% 52%)`;

              return (
                <a
                  key={p.itemId}
                  // An issue parcel opens its panel below the floor (BOB-99); an item opens /sdlc.
                  href={p.kind === "issue" ? `#issue-${p.itemId}` : `/sdlc?item=${encodeURIComponent(p.itemId)}`}
                  onClick={p.kind === "issue" ? (event) => { event.preventDefault(); setIssueId(p.itemId); } : undefined}
                  title={p.accessibilityLabel}
                  aria-label={p.accessibilityLabel}
                  className="group absolute left-0 top-0 transition-transform duration-700 ease-[cubic-bezier(.2,.9,.25,1.15)] hover:z-20 hover:brightness-110"
                  style={{ width: scene.parcel.w, height: scene.parcel.h, transform: `translate(${p.x - scene.parcel.w / 2}px, ${p.y - scene.parcel.h / 2}px)` }}
                >
                  {/* Expanding amber radar sonar halo when waiting on a human */}
                  {needsHuman ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -inset-[3px] rounded-[7px] border-2 border-[#e7a505]"
                      style={{ animation: "floor-sonar 1.6s ease-out infinite" }}
                    />
                  ) : null}

                  {/* Deploying thruster glow beneath the cartridge */}
                  {deploying ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -bottom-[5px] left-2 right-2 h-[5px] rounded-full"
                      style={{
                        background: "radial-gradient(ellipse at center, #ffb74d 0%, #c09cff88 55%, transparent 100%)",
                        animation: "floor-thruster .55s ease-in-out infinite",
                      }}
                    />
                  ) : null}

                  <span
                    className={`relative flex h-full w-full flex-col overflow-hidden rounded-[6px] font-mono leading-tight ${compact ? "items-center justify-center" : "justify-center pl-[9px] pr-[4px]"}`}
                    style={{
                      backgroundColor: tone.fill,
                      backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0) 44%, rgba(0,0,0,0.16) 100%)",
                      color: tone.ink,
                      border: p.attention !== "ok" ? `2px solid ${ATTENTION_RING[p.attention]}` : "1px solid rgba(255,255,255,0.22)",
                      boxShadow: working
                        ? `0 0 14px ${repoAccent}88, 0 3px 8px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.4)`
                        : `0 3px 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.32)`,
                      // Keyed on the activity time so each new tail frame restarts a short wobble.
                      animation: working ? "floor-wobble .48s ease-in-out 3" : undefined,
                    }}
                    key={working ? last : "still"}
                  >
                    {/* The repository, as a luminous cartridge tab: one repo's parcels read as a family. */}
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-[4px]"
                      style={{ backgroundColor: repoAccent, boxShadow: working ? `0 0 8px ${repoAccent}` : undefined }}
                    />
                    {/* Sweeping laser scanline while CI is actively checking this parcel */}
                    {ciRunning ? (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 w-[18px]"
                        style={{
                          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)",
                          animation: "floor-scanline 1.7s ease-in-out infinite",
                        }}
                      />
                    ) : null}
                    <span className={`max-w-full truncate font-extrabold ${compact ? "text-[9px]" : "text-[10px]"}`}>{compact ? p.short : p.label}</span>
                    {!compact && (p.sublabel || p.age) ? (
                      <span className="max-w-full truncate text-[9px] font-medium opacity-80">{[p.sublabel, p.age].filter(Boolean).join(" · ")}</span>
                    ) : null}
                  </span>

                  {/* Floating animated agent typing pill when live tail lines arrive */}
                  {working ? (
                    <span
                      key={`t${last}`}
                      aria-hidden
                      className="absolute -top-[11px] left-1/2 flex -translate-x-1/2 items-center gap-[2.5px] rounded-full border border-[#4a3b28] bg-[#14100b] px-1.5 py-[2.5px] shadow-md"
                      style={{ animation: `floor-typing-out ${TYPING_MS}ms linear forwards` }}
                    >
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="h-[3.5px] w-[3.5px] rounded-full"
                          style={{
                            backgroundColor: `hsl(${p.hue} 92% 74%)`,
                            boxShadow: `0 0 5px hsl(${p.hue} 92% 70%)`,
                            animation: `floor-type .58s ease-in-out ${i * 110}ms 6`,
                          }}
                        />
                      ))}
                    </span>
                  ) : null}

                  <CiMeter ci={ciMsg} w={scene.parcel.w} />

                  {p.marker ? (
                    <span
                      className="absolute -right-2 -top-2 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-[#17130e] font-mono text-[10px] font-black text-[#17130e] shadow-md"
                      style={{
                        backgroundColor: ATTENTION_RING[p.attention],
                        boxShadow: `0 0 10px ${ATTENTION_RING[p.attention]}aa`,
                        animation: p.marker === "!" ? "floor-bob .85s ease-in-out infinite" : undefined,
                      }}
                    >
                      {p.marker}
                    </span>
                  ) : null}
                </a>
              );
            })}

            {/* Live WebSocket-driven celebratory & progress effects */}
            {effects
              // An effect for an item not drawn on this floor (another project's) is skipped.
              .filter((e) => e.kind !== "static" && (!e.itemId || at.has(e.itemId)))
              .map((e) => {
                const p = e.itemId ? at.get(e.itemId) : undefined;
                // An item scoped off the floor gets no effect; an item-less beat plays mid-floor.
                if (e.itemId && !p) return null;
                return <EffectSprite key={e.beatId} e={e} x={p?.x ?? scene.width / 2} y={p?.y ?? scene.height / 2} hue={p?.hue ?? 40} />;
              })}

            {/* Retro CRT static resync overlay */}
            {gap ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(0deg, rgba(255,210,122,0.12) 0 2px, rgba(0,0,0,0.45) 2px 4px)",
                  animation: "floor-static .14s steps(2) 8",
                }}
              >
                <span className="rounded border border-[#ffd27a] bg-[#120f0be8] px-3 py-1 font-mono text-xs font-black tracking-[0.2em] text-[#ffd27a]">
                  RESYNCING SIGNAL…
                </span>
              </div>
            ) : null}

            <ul className="sr-only">
              {floorSummary(scene).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      {issue ? <IssuePanel view={view} issue={issue} now={clock} context={context} send={send} onClose={() => setIssueId(null)} /> : null}
      {view.epoch === null ? null : <DesksRow desks={desks} now={now} />}
    </section>
  );
}

/** The same Scope object while its fields don't change, so memos keyed on it hold. */
function useStableScope({ startupId, repoKey }: Scope): Scope {
  return useMemo(() => ({ ...(startupId ? { startupId } : {}), ...(repoKey ? { repoKey } : {}) }), [startupId, repoKey]);
}
