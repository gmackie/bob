"use client";

/**
 * The Floor lens on the cockpit wall (BOB-92): Kanbanger issues riding the SDLC belt,
 * from the live SDLC edge. The scene comes from @bob/arcade, the same layout iPhone and
 * iPad draw; parcels slide with a CSS transform transition, so every move is a real
 * coordinator transition. Motion level "minimal" freezes it (the page kills transitions).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { beatLine, chooseDesks, createBeatLog, desks as deskCards, effectFor, EFFECT_TTL_MS, expire, floorScene, floorSummary, hud, PARCEL_TONE, sameDesks, sdlcBeats, shippedToday } from "./floor-model";
import type { EdgeView, FloorParcel, LiveEffect } from "./floor-model";

import { useSdlcEdge } from "~/components/sdlc/use-sdlc-edge";

import { DesksRow } from "./desks-row";

/** Which items get a desk, sticky across views: an unchanged choice keeps the same array. */
/** `now` should change rarely (a minute clock): it re-judges stalls and so re-chooses desks. */
function useDeskIds(view: EdgeView, now: number): readonly string[] {
  const [held, setHeld] = useState(() => ({ view, now, ids: chooseDesks(view, [], { now }) }));
  if (held.view !== view || held.now !== now) {
    const next = chooseDesks(view, held.ids, { now });
    const ids = sameDesks(next, held.ids) ? held.ids : next;
    setHeld({ view, now, ids });
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

export function FloorPanel() {
  const { view, attempt, watchDesks, watching, followShipped, shipped } = useSdlcEdge();
  const now = useClock(15_000);
  const deskIds = useDeskIds(view, Math.floor(now / 60_000) * 60_000);
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

  const log = useMemo(() => createBeatLog(60), []);
  const prev = useRef<EdgeView | null>(null);
  const [effects, setEffects] = useState<LiveEffect[]>([]);
  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    if (!before || before === view) return;
    const now = Date.now();
    const fresh = log.push(sdlcBeats(before, view, now)).flatMap((b) => {
      const e = effectFor(b);
      return e ? [{ ...e, born: now }] : [];
    });
    if (fresh.length) setEffects((cur) => [...expire(cur, now), ...fresh].slice(-12));
  }, [view, log]);
  useEffect(() => {
    if (!effects.length) return undefined;
    const id = setTimeout(() => setEffects((cur) => expire(cur, Date.now())), EFFECT_TTL_MS);
    return () => clearTimeout(id);
  }, [effects]);
  useSyncExternalStore(log.subscribe, log.version, log.version);

  // Ages and stalls move by the minute (BOB-101); re-laying out every tick would restart transitions.
  const clock = Math.floor(now / 60_000) * 60_000;
  const scene = useMemo(() => (box ? floorScene(view, box, { orientation: "wide", now: clock }) : null), [view, box, clock]);
  const counts = hud(view, {}, clock);
  const at = new Map<string, FloorParcel>(scene ? scene.parcels.map((p) => [p.itemId, p] as const) : []);
  const gap = effects.some((e) => e.kind === "static");

  return (
    <section className="mx-4 mb-3 rounded-lg border border-white/10 bg-[#120f0b]" aria-label="The Floor: SDLC items by stage">
      <style>{`
        @keyframes floor-rise { from { opacity: 1; transform: translate(-50%, -14px); } to { opacity: 0; transform: translate(-50%, -44px); } }
        @keyframes floor-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
        @keyframes floor-belt { to { background-position: 18px 0; } }
        @keyframes floor-static { 0%,100% { opacity: .3 } 50% { opacity: .12 } }
      `}</style>
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
        <span className="ml-auto truncate normal-case tracking-normal">{log.recent(1)[0] ? beatLine(log.recent(1)[0]!) : ""}</span>
      </div>
      <div ref={boxRef} className="relative h-[260px] overflow-hidden">
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
                animation: counts.inFlight ? "floor-belt .9s linear infinite" : undefined,
              }}
            />
            {scene.stations.map((s) =>
              s.kind === "belt" ? (
                <div key={s.id} aria-hidden>
                  <div className="absolute h-2.5 w-2.5 rounded-full" style={{ left: s.x - 5, top: s.y - 5, backgroundColor: s.attention && s.attention !== "ok" ? ATTENTION_RING[s.attention] : s.count ? "#d4850a" : "#3a2f22" }} />
                  <div className="absolute w-[100px] text-center font-mono text-[10px] tracking-widest" style={{ left: s.x - 50, top: s.y - 26, color: s.count ? "#ffd27a" : "#8a7758" }}>
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
            {scene.parcels.map((p) => (
              <a
                key={p.itemId}
                href={`/sdlc?item=${encodeURIComponent(p.itemId)}`}
                title={p.accessibilityLabel}
                aria-label={p.accessibilityLabel}
                className="absolute left-0 top-0 flex flex-col justify-center rounded-[5px] pl-[7px] pr-[3px] font-mono leading-tight transition-transform duration-700 ease-[cubic-bezier(.2,.9,.25,1.15)] hover:brightness-110"
                style={{
                  width: scene.parcel.w,
                  height: scene.parcel.h,
                  transform: `translate(${p.x - scene.parcel.w / 2}px, ${p.y - scene.parcel.h / 2}px)`,
                  backgroundColor: PARCEL_TONE[p.tone].fill,
                  color: PARCEL_TONE[p.tone].ink,
                  border: `2px solid ${ATTENTION_RING[p.attention]}`,
                }}
              >
                {/* The repository, as a stripe: one repo's parcels still read as a family. */}
                <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] rounded-l-[3px]" style={{ backgroundColor: `hsl(${p.hue} 70% 45%)` }} />
                <span className="max-w-full truncate text-[10px] font-bold">{p.label}</span>
                {p.sublabel || p.age ? <span className="max-w-full truncate text-[9px] opacity-75">{[p.sublabel, p.age].filter(Boolean).join(" · ")}</span> : null}
                {p.marker ? (
                  <span className="absolute -right-1.5 -top-2 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-black" style={{ backgroundColor: ATTENTION_RING[p.attention], animation: p.marker === "!" ? "floor-bob .9s ease-in-out infinite" : undefined }}>
                    {p.marker}
                  </span>
                ) : null}
              </a>
            ))}
            {effects
              .filter((e) => e.kind !== "static")
              .map((e) => {
                const p = e.itemId ? at.get(e.itemId) : undefined;
                return (
                  <div key={e.beatId} aria-hidden className="pointer-events-none absolute whitespace-nowrap font-mono text-[12px] font-black tracking-widest" style={{ left: p?.x ?? scene.width / 2, top: p?.y ?? scene.height / 2, color: TONE[e.tone], textShadow: "0 0 6px #000", animation: "floor-rise 1.4s ease-out forwards" }}>
                    {e.text}
                  </div>
                );
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
      {view.epoch === null ? null : <DesksRow desks={desks} now={now} />}
    </section>
  );
}
