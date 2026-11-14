"use client";

import { useMemo, useState } from "react";

import type { RiverPoint, RiverSeries } from "./budget-model";

const W = 760;
const H = 260;
const PAD = { l: 34, r: 14, t: 14, b: 26 };
const DAY_LABELS = ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6", "Day 7"];

function path(points: RiverPoint[], x: (t: number) => number, y: (p: number) => number): string {
  return points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.pct).toFixed(1)}`).join(" ");
}

function valueAt(points: RiverPoint[], t: number): number | undefined {
  if (points.length === 0 || t < points[0]!.t || t > points.at(-1)!.t) return undefined;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (t <= b.t) return b.t === a.t ? b.pct : a.pct + ((b.pct - a.pct) * (t - a.t)) / (b.t - a.t);
  }
  return points.at(-1)!.pct;
}

/**
 * One account's week: what was used (solid), where the governor is taking it
 * (dashed), and — while levers are being dragged — where the draft policy
 * would take it (the wide translucent ghost). Hover reads values off any line.
 */
export function WeekRiver({ series }: { series: RiverSeries }) {
  const [hoverT, setHoverT] = useState<number | null>(null);
  const x = (t: number) => PAD.l + (t / series.windowHours) * (W - PAD.l - PAD.r);
  const y = (p: number) => PAD.t + (1 - p / 100) * (H - PAD.t - PAD.b);

  const area = useMemo(() => {
    const pts = series.history;
    if (pts.length < 2) return "";
    return `${path(pts, x, y)} L${x(pts.at(-1)!.t).toFixed(1)} ${y(0)} L${x(pts[0]!.t).toFixed(1)} ${y(0)} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series]);

  const hover = hoverT === null ? null : {
    t: hoverT,
    used: valueAt(series.history, hoverT),
    projected: valueAt(series.projection, hoverT),
    draft: series.draftProjection ? valueAt(series.draftProjection, hoverT) : undefined,
  };
  const days = Math.round(series.windowHours / 24);

  return (
    <figure className="relative m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto max-h-[260px] w-full touch-none select-none"
        role="img"
        aria-label={`${series.label}: weekly usage so far and projection to reset. Landing target ${series.landingTargetPct}%.`}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const px = ((event.clientX - rect.left) / rect.width) * W;
          setHoverT(Math.min(series.windowHours, Math.max(0, ((px - PAD.l) / (W - PAD.l - PAD.r)) * series.windowHours)));
        }}
        onPointerLeave={() => setHoverT(null)}
      >
        <defs>
          <linearGradient id="river-used" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--foreground)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--foreground)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map((p) => (
          <g key={p}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(p)} y2={y(p)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(p) + 3} textAnchor="end" fontSize="10" className="fill-muted-foreground font-mono">
              {p}
            </text>
          </g>
        ))}
        {Array.from({ length: days + 1 }, (_, d) => (
          <line key={d} x1={x(d * 24)} x2={x(d * 24)} y1={PAD.t} y2={H - PAD.b} stroke="var(--border)" strokeDasharray="2 4" />
        ))}
        {DAY_LABELS.slice(0, days).map((label, d) => (
          <text key={label} x={x(d * 24 + 12)} y={H - 8} textAnchor="middle" fontSize="10" className="fill-muted-foreground font-mono">
            {label}
          </text>
        ))}
        {/* Reserve band and landing target. */}
        <rect
          x={PAD.l}
          y={y(series.landingTargetPct)}
          width={W - PAD.l - PAD.r}
          height={Math.max(0, y(series.reserveFloorPct) - y(series.landingTargetPct))}
          fill="var(--budget-you)"
          fillOpacity={0.1}
        />
        <line x1={PAD.l} x2={W - PAD.r} y1={y(series.landingTargetPct)} y2={y(series.landingTargetPct)} stroke="var(--budget-target)" strokeWidth={1.5} strokeDasharray="6 4" />
        <text x={W - PAD.r - 4} y={y(series.landingTargetPct) - 5} textAnchor="end" fontSize="10" className="fill-muted-foreground font-mono">
          landing {series.landingTargetPct}%
        </text>
        {/* Run end (landing buffer) marker. */}
        <line x1={x(series.runEndT)} x2={x(series.runEndT)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeDasharray="1 3" />

        <path d={area} fill="url(#river-used)" />
        <path d={path(series.history, x, y)} fill="none" stroke="var(--foreground)" strokeOpacity={0.85} strokeWidth={2.2} strokeLinejoin="round" />
        {series.draftProjection ? (
          <path className="budget-ghost" d={path(series.draftProjection, x, y)} fill="none" stroke="var(--primary)" strokeOpacity={0.28} strokeWidth={9} strokeLinecap="round" />
        ) : null}
        <path d={path(series.projection, x, y)} fill="none" stroke="var(--primary)" strokeWidth={2.4} strokeDasharray="7 5" />

        <line x1={x(series.nowT)} x2={x(series.nowT)} y1={PAD.t} y2={H - PAD.b} stroke="var(--primary)" strokeWidth={1.5} />
        <circle cx={x(series.nowT)} cy={y(series.history.at(-1)?.pct ?? 0)} r={4.5} fill="var(--primary)" className="budget-now" />
        <text x={x(series.nowT) - 6} y={PAD.t + 26} textAnchor="end" fontSize="10" fontWeight={600} className="fill-primary font-mono">
          now
        </text>

        {hover ? (
          <line x1={x(hover.t)} x2={x(hover.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--foreground)" strokeOpacity={0.35} />
        ) : null}
      </svg>
      {hover ? (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-border bg-popover px-2.5 py-1.5 font-mono text-[11px] text-popover-foreground shadow-md"
          style={{ left: `clamp(8px, calc(${(x(hover.t) / W) * 100}% + 10px), calc(100% - 170px))` }}
        >
          <div className="text-muted-foreground">
            day {Math.floor(hover.t / 24) + 1} · {String(Math.floor(hover.t % 24)).padStart(2, "0")}h
          </div>
          {hover.used !== undefined ? <div>used {hover.used.toFixed(1)}%</div> : null}
          {hover.projected !== undefined ? <div className="text-primary">plan {hover.projected.toFixed(1)}%</div> : null}
          {hover.draft !== undefined ? <div className="text-primary/70">draft {hover.draft.toFixed(1)}%</div> : null}
        </div>
      ) : null}
    </figure>
  );
}
