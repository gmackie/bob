"use client";

/**
 * The Floor lens on the cockpit wall (BOB-92): Kanbanger issues riding the SDLC belt,
 * from the live SDLC edge. The scene comes from @bob/arcade, the same layout iPhone and
 * iPad draw; parcels slide with a CSS transform transition, so every move is a real
 * coordinator transition. Motion level "minimal" freezes it (the page kills transitions).
 *
 * Slice 3 (BOB-91): the attempt stream the same socket carries for watched items drives
 * motion between transitions. New tail lines make a parcel type and throw sparks; named
 * commands (tests, builds, commits, pushes) and CI phases pop labels; a green CI run
 * bursts confetti. Station sprites animate only while their station holds items, scope
 * chips narrow the floor to one project or repo, and the floor grows and densifies with load.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";

import type { AttemptState } from "~/components/sdlc/attempt-model";
import { bannerFor } from "~/components/sdlc/sdlc-page-model";
import { useSdlcEdge } from "~/components/sdlc/use-sdlc-edge";

import { DesksRow } from "./desks-row";
import { IssuePanel, ProjectBoard } from "./project-board";
import {
  beatLine,
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
import { SPRITE_KEYFRAMES, StationSprite } from "./station-sprites";

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
const CONFETTI = ["#7dffb0", "#ffd27a", "#6fb4ff", "#ff8ad8", "#d4850a", "#c39bff"];
/** How long a parcel keeps "typing" after its agent's last tail lines. */
const TYPING_MS = 3_600;

const KEYFRAMES = `
  @keyframes floor-rise { from { opacity: 1; transform: translate(-50%, -14px); } to { opacity: 0; transform: translate(-50%, -44px); } }
  @keyframes floor-stamp { 0% { opacity: 0; transform: translate(-50%, -50%) scale(2.4) rotate(-14deg); } 18% { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(-8deg); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -50%) scale(1) rotate(-8deg); } }
  @keyframes floor-burst-text { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.4); } 25% { opacity: 1; transform: translate(-50%, -150%) scale(1.35); } 100% { opacity: 0; transform: translate(-50%, -260%) scale(1); } }
  @keyframes floor-confetti { from { opacity: 1; transform: translate(-50%, -50%) rotate(0); } to { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) rotate(var(--rot)); } }
  @keyframes floor-spark { from { opacity: 1; transform: translate(0, 0) scale(1); } to { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(.3); } }
  @keyframes floor-spark-text { from { opacity: .95; transform: translate(-50%, -6px); } to { opacity: 0; transform: translate(-50%, -22px); } }
  @keyframes floor-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
  @keyframes floor-belt { to { background-position: 18px 6px; } }
  @keyframes floor-static { 0%,100% { opacity: .3 } 50% { opacity: .12 } }
  @keyframes floor-type { 0%,100% { transform: translateY(0); opacity: .45 } 50% { transform: translateY(-2.5px); opacity: 1 } }
  @keyframes floor-typing-out { 0%,85% { opacity: 1 } 100% { opacity: 0 } }
  @keyframes floor-wobble { 0%,100% { rotate: 0deg } 25% { rotate: -2.5deg } 75% { rotate: 2.5deg } }
  @keyframes floor-shimmer { from { background-position: -40px 0 } to { background-position: 40px 0 } }
  @keyframes floor-ticker { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
  ${SPRITE_KEYFRAMES}
`;

/** Deterministic pseudo-random spread per effect, so a re-render doesn't re-roll the particles. */
const spread = (seed: string, i: number) => {
  let h = 2166136261 ^ i;
  for (let k = 0; k < seed.length; k++) h = Math.imul(h ^ seed.charCodeAt(k), 16777619);
  return ((h >>> 0) % 1000) / 1000;
};

function Confetti({ e, x, y }: { e: LiveEffect; x: number; y: number }) {
  return (
    <>
      {Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * Math.PI * 2 + spread(e.beatId, i) * 0.6;
        const dist = 34 + spread(e.beatId, i + 50) * 46;
        const style = {
          left: x,
          top: y,
          width: i % 3 ? 5 : 3,
          height: i % 3 ? 3 : 7,
          backgroundColor: CONFETTI[i % CONFETTI.length],
          "--dx": `${Math.cos(angle) * dist}px`,
          "--dy": `${Math.sin(angle) * dist + 16}px`,
          "--rot": `${(spread(e.beatId, i + 99) - 0.5) * 720}deg`,
          animation: `floor-confetti 1.3s cubic-bezier(.15,.7,.3,1) forwards`,
        } as CSSProperties;
        return <span key={i} aria-hidden className="pointer-events-none absolute rounded-[1px]" style={style} />;
      })}
    </>
  );
}

function Sparks({ e, x, y, hue }: { e: LiveEffect; x: number; y: number; hue: number }) {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => {
        const angle = -Math.PI / 2 + (spread(e.beatId, i) - 0.5) * 2.4;
        const dist = 12 + spread(e.beatId, i + 20) * 16;
        const style = {
          left: x + (spread(e.beatId, i + 40) - 0.5) * 30,
          top: y - 8,
          backgroundColor: e.tone === "warn" ? TONE.warn : `hsl(${hue} 90% 72%)`,
          boxShadow: `0 0 4px hsl(${hue} 90% 60%)`,
          "--dx": `${Math.cos(angle) * dist}px`,
          "--dy": `${Math.sin(angle) * dist}px`,
          animation: `floor-spark .7s ease-out ${i * 40}ms forwards`,
        } as CSSProperties;
        return <span key={i} aria-hidden className="pointer-events-none absolute h-1 w-1 rounded-full opacity-0" style={style} />;
      })}
      {e.text ? (
        <div aria-hidden className="pointer-events-none absolute whitespace-nowrap font-mono text-[9px] font-bold tracking-widest" style={{ left: x, top: y - 12, color: TONE[e.tone], textShadow: "0 0 4px #000", animation: "floor-spark-text 1.1s ease-out forwards" }}>
          {e.text}
        </div>
      ) : null}
    </>
  );
}

function EffectSprite({ e, x, y, hue }: { e: LiveEffect; x: number; y: number; hue: number }) {
  const label = { color: TONE[e.tone], textShadow: "0 0 6px #000" };
  switch (e.kind) {
    case "spark":
      return <Sparks e={e} x={x} y={y} hue={hue} />;
    case "burst":
      return (
        <>
          <Confetti e={e} x={x} y={y} />
          <div aria-hidden className="pointer-events-none absolute whitespace-nowrap font-mono text-[15px] font-black tracking-widest" style={{ ...label, left: x, top: y, animation: "floor-burst-text 1.6s ease-out forwards" }}>
            {e.text}
          </div>
        </>
      );
    case "stamp":
      return (
        <div aria-hidden className="pointer-events-none absolute whitespace-nowrap rounded border-2 px-1.5 font-mono text-[11px] font-black tracking-widest" style={{ ...label, borderColor: TONE[e.tone], left: x, top: y, backgroundColor: "#120f0bcc", animation: "floor-stamp 1.6s ease-out forwards" }}>
          {e.text}
        </div>
      );
    default:
      return (
        <div aria-hidden className="pointer-events-none absolute whitespace-nowrap font-mono text-[12px] font-black tracking-widest" style={{ ...label, left: x, top: y, animation: "floor-rise 1.4s ease-out forwards" }}>
          {e.text}
        </div>
      );
  }
}

/** The thin CI meter under a parcel: fill is settled phases, colour is the run's state. */
function CiMeter({ ci, w }: { ci: CiMessage | undefined; w: number }) {
  if (!ci?.available || !ci.phases.length) return null;
  const failed = ci.phases.some((p) => p.status === "failed");
  const progress = ciProgress(ci.phases);
  const running = !failed && progress < 1;
  const color = failed ? TONE.bad : progress >= 1 ? TONE.good : TONE.info;
  return (
    <span aria-hidden className="absolute -bottom-[5px] left-0.5 h-[3px] overflow-hidden rounded-full bg-black/50" style={{ width: w - 4 }}>
      <span
        className="block h-full rounded-full transition-[width] duration-700"
        style={{
          width: `${Math.max(8, progress * 100)}%`,
          backgroundColor: color,
          backgroundImage: running ? "linear-gradient(90deg, transparent, #ffffff88, transparent)" : undefined,
          backgroundSize: "40px 100%",
          backgroundRepeat: "no-repeat",
          animation: running ? "floor-shimmer 1.1s linear infinite" : undefined,
        }}
      />
    </span>
  );
}

function ScopeChips({ chips, scope, onScope }: { chips: FloorScopeChip[]; scope: Scope; onScope: (s: Scope) => void }) {
  if (!chips.length) return null;
  const active = (c: FloorScopeChip) => (c.level === "repo" ? scope.repoKey === c.scope.repoKey : scope.startupId === c.scope.startupId);
  return (
    <>
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onScope(active(c) ? (c.level === "repo" ? { ...(scope.startupId ? { startupId: scope.startupId } : {}) } : {}) : c.scope)}
          aria-pressed={active(c)}
          className="flex items-center gap-1 rounded-full border px-2 py-[1px] font-mono text-[10px] normal-case tracking-normal transition-colors"
          style={{ borderColor: active(c) ? "#ffd27a" : "#3a2f22", color: active(c) ? "#ffd27a" : "#8a7758", backgroundColor: active(c) ? "#2a2116" : "transparent" }}
          title={`${c.level === "repo" ? "Repo" : "Project"} ${c.label}: ${c.count} items${c.attention ? `, ${c.attention} need attention` : ""}`}
        >
          {c.hue !== null ? <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: `hsl(${c.hue} 58% 56%)` }} /> : null}
          {c.label}
          <span className="opacity-70">{c.count}</span>
          {c.attention ? <span className="text-[#e7a505]">!</span> : null}
        </button>
      ))}
    </>
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
      // Outcomes the floor saw first also light the full-screen spectacle (spectacle level only draws them).
      for (const b of fresh) {
        if (b.kind === "ci.green") cueRef.current?.("pr");
        else if (b.kind === "ci.phase" && b.data?.to === "failed") cueRef.current?.("failure");
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

  return (
    <section className="mx-4 mb-3 rounded-lg border border-white/10 bg-[#120f0b]" aria-label="The Floor: SDLC items by stage">
      <style>{KEYFRAMES}</style>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pt-2 font-mono text-[10px] tracking-widest text-[#8a7758]">
        <span className="text-[#ffd27a]">THE FLOOR</span>
        <span>AGENTS <b className="text-[13px] text-[#ffd27a]">{counts.agents}</b></span>
        <span>IN FLIGHT <b className="text-[13px] text-[#ffd27a]">{counts.inFlight}</b></span>
        <span>CI <b className="text-[13px] text-[#6fb4ff]">{counts.ci}</b></span>
        <span>NEEDS YOU <b className="text-[13px]" style={{ color: counts.needsYou ? "#e7a505" : "#ffd27a" }}>{counts.needsYou}</b></span>
        <span title="Sat too long where the system should have moved it on">STALLED <b className="text-[13px]" style={{ color: counts.stalled ? "#ff9f43" : "#ffd27a" }}>{counts.stalled}</b></span>
        <span>SHIPPED <b className="text-[13px] text-[#7dffb0]">{counts.shipped}</b></span>
        <span>FAILED <b className="text-[13px]" style={{ color: counts.failed ? "#ff6b6b" : "#ffd27a" }}>{counts.failed}</b></span>
        <span title="Reached production since local midnight">TODAY <b className="text-[13px] text-[#7dffb0]">{today ?? "–"}</b></span>
        <span className="ml-auto flex min-w-0 max-w-[45%] flex-col items-end normal-case tracking-normal" aria-live="polite">
          {ticker.map((b, i) => (
            <span key={b.id} className="max-w-full truncate" style={{ opacity: 1 - i * 0.3, animation: i === 0 ? "floor-ticker .3s ease-out" : undefined }}>
              {beatLine(b)}
            </span>
          ))}
        </span>
      </div>
      {board ? (
        <ProjectBoard
          board={board}
          selected={project?.projectId ?? null}
          onSelect={(row) => { setProject(row); setIssueId(null); }}
        />
      ) : null}
      {project ? <div className="px-3 pb-1 font-mono text-[11px] text-[#ffd27a]">{project.name}{scene && scene.backlog > 0 ? <span className="ml-3 text-[#8a7758]">BACKLOG {scene.backlog}</span> : null}</div> : null}
      {scopes.projects.length || scopes.repos.length ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-1.5" aria-label="Scope the floor">
          <ScopeChips chips={scopes.projects} scope={scope} onScope={setScope} />
          {scopes.projects.length && scopes.repos.length ? <span className="mx-1 h-3 w-px bg-[#3a2f22]" /> : null}
          <ScopeChips chips={scopes.repos} scope={scope} onScope={setScope} />
        </div>
      ) : null}
      <div ref={boxRef} className="relative overflow-hidden transition-[height] duration-500" style={{ height }}>
        {view.epoch === null ? (
          <div className="p-4 font-mono text-xs text-white/40">waiting for the SDLC edge…</div>
        ) : scene ? (
          <>
            <div
              aria-hidden
              className="absolute rounded-full"
              style={{
                left: scene.belt.x1,
                top: scene.belt.y1 - 7,
                width: scene.belt.x2 - scene.belt.x1,
                height: 14,
                backgroundColor: "#3a2f22",
                backgroundImage: "repeating-linear-gradient(90deg, #6a5638 0 8px, transparent 8px 18px)",
                backgroundSize: "18px 2px",
                backgroundRepeat: "repeat-x",
                backgroundPosition: "0 6px",
                animation: counts.inFlight ? `floor-belt ${beltSpeed}s linear infinite` : undefined,
              }}
            />
            {scene.stations.map((s) =>
              s.kind === "belt" ? (
                <div key={s.id} aria-hidden>
                  <StationSprite id={s.id} active={s.count > 0} x={s.x} y={s.y} color={s.attention && s.attention !== "ok" ? ATTENTION_RING[s.attention] : s.count ? "#d4850a" : "#4a3d2c"} />
                  <div className="absolute w-[100px] text-center font-mono text-[10px] tracking-widest" style={{ left: s.x - 50, top: s.y - 28, color: s.count ? "#ffd27a" : "#8a7758" }}>
                    {s.label.toUpperCase()}
                    {s.count ? ` ${s.count}` : ""}
                  </div>
                </div>
              ) : (
                <div key={s.id} aria-hidden className="absolute font-mono text-[10px] tracking-widest" style={{ left: s.x, top: s.y - 4, color: s.count ? ATTENTION_RING[s.attention ?? "ok"] : "#8a7758" }}>
                  {s.label.toUpperCase()}
                  {s.count ? ` ${s.count}` : ""}
                </div>
              ),
            )}
            {scene.overflow.map((o) => (
              <div key={`over-${o.stationId}`} className="absolute flex items-center justify-center rounded border border-[#6a5638] font-mono text-[10px] text-[#ffd27a]" style={{ left: o.x - scene.parcel.w / 2, top: o.y - scene.parcel.h / 2, width: scene.parcel.w, height: scene.parcel.h }}>
                +{o.count}
              </div>
            ))}
            {scene.parcels.map((p) => {
              const last = typing[p.itemId];
              const working = last !== undefined && now - last < 60_000 && (p.state === "running" || p.state === "waiting-input");
              const compact = scene.density === "compact";
              const tone = PARCEL_TONE[p.tone];
              return (
                <a
                  key={p.itemId}
                  // An issue parcel opens its panel below the floor (BOB-99); an item opens /sdlc.
                  href={p.kind === "issue" ? `#issue-${p.itemId}` : `/sdlc?item=${encodeURIComponent(p.itemId)}`}
                  onClick={p.kind === "issue" ? (event) => { event.preventDefault(); setIssueId(p.itemId); } : undefined}
                  title={p.accessibilityLabel}
                  aria-label={p.accessibilityLabel}
                  className="absolute left-0 top-0 transition-transform duration-700 ease-[cubic-bezier(.2,.9,.25,1.15)] hover:brightness-110"
                  style={{ width: scene.parcel.w, height: scene.parcel.h, transform: `translate(${p.x - scene.parcel.w / 2}px, ${p.y - scene.parcel.h / 2}px)` }}
                >
                  <span
                    className={`relative flex h-full w-full flex-col overflow-hidden rounded-[5px] font-mono leading-tight ${compact ? "items-center justify-center" : "justify-center pl-[7px] pr-[3px]"}`}
                    style={{
                      backgroundColor: tone.fill,
                      color: tone.ink,
                      border: `2px solid ${ATTENTION_RING[p.attention]}`,
                      // Keyed on the activity time so each new tail frame restarts a short wobble.
                      animation: working ? "floor-wobble .5s ease-in-out 3" : undefined,
                    }}
                    key={working ? last : "still"}
                  >
                    {/* The repository, as a stripe: one repo's parcels still read as a family. */}
                    <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: `hsl(${p.hue} 70% 45%)` }} />
                    <span className={`max-w-full truncate font-bold ${compact ? "text-[9px]" : "text-[10px]"}`}>{compact ? p.short : p.label}</span>
                    {!compact && (p.sublabel || p.age) ? <span className="max-w-full truncate text-[9px] opacity-75">{[p.sublabel, p.age].filter(Boolean).join(" · ")}</span> : null}
                  </span>
                  {working ? (
                    <span key={`t${last}`} aria-hidden className="absolute -top-[9px] left-1/2 flex -translate-x-1/2 gap-[2px] rounded-full bg-[#17130e] px-1 py-[2px]" style={{ animation: `floor-typing-out ${TYPING_MS}ms linear forwards` }}>
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="h-[3px] w-[3px] rounded-full" style={{ backgroundColor: `hsl(${p.hue} 90% 72%)`, animation: `floor-type .6s ease-in-out ${i * 120}ms 6` }} />
                      ))}
                    </span>
                  ) : null}
                  <CiMeter ci={attempt.ci[p.itemId]} w={scene.parcel.w} />
                  {p.marker ? (
                    <span className="absolute -right-1.5 -top-2 flex h-4 w-4 items-center justify-center rounded-full font-mono text-[10px] font-black text-[#17130e]" style={{ backgroundColor: ATTENTION_RING[p.attention], animation: p.marker === "!" ? "floor-bob .9s ease-in-out infinite" : undefined }}>
                      {p.marker}
                    </span>
                  ) : null}
                </a>
              );
            })}
            {effects
              // An effect for an item not drawn on this floor (another project's) is skipped.
              .filter((e) => e.kind !== "static" && (!e.itemId || at.has(e.itemId)))
              .map((e) => {
                const p = e.itemId ? at.get(e.itemId) : undefined;
                // An item scoped off the floor gets no effect; an item-less beat plays mid-floor.
                if (e.itemId && !p) return null;
                return <EffectSprite key={e.beatId} e={e} x={p?.x ?? scene.width / 2} y={p?.y ?? scene.height / 2} hue={p?.hue ?? 40} />;
              })}
            {gap ? <div aria-hidden className="pointer-events-none absolute inset-0 bg-neutral-500" style={{ animation: "floor-static .14s steps(2) 8" }} /> : null}
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
