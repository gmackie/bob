"use client";

import { cn } from "@gmacko/core/ui";

import { providerLabel, type GaugeModel } from "./budget-model";

const SIZE = 132;
const C = SIZE / 2;
const R_OUTER = 54;
const R_INNER = 42;
const STROKE = 9;

function polar(r: number, pct: number): [number, number] {
  // 0% at 12 o'clock, clockwise; 100% just short of a full turn.
  const a = (Math.min(99.999, Math.max(0, pct)) / 100) * Math.PI * 2 - Math.PI / 2;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function arc(r: number, from: number, to: number): string {
  if (to - from <= 0.05) return "";
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, to);
  const large = to - from > 50 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const TONE_RING: Record<GaugeModel["tone"], string> = {
  ok: "var(--primary)",
  attention: "color-mix(in oklab, var(--primary) 55%, var(--muted-foreground))",
  idle: "var(--muted-foreground)",
  down: "var(--destructive)",
};

export function BudgetGauge({ gauge, selected, onSelect }: { gauge: GaugeModel; selected?: boolean; onSelect?: () => void }) {
  const used = gauge.usedPct;
  const youEnd = used + gauge.interactivePct;
  const bobEnd = youEnd + gauge.bobPct;
  const reserveFrom = Math.max(0, gauge.landingTargetPct - gauge.reservePct);
  const patternId = `hatch-${gauge.accountId.replace(/[^a-z0-9-]/gi, "")}`;
  const [tx, ty] = polar(R_OUTER + 9, gauge.landingTargetPct);
  const [tx2, ty2] = polar(R_OUTER - 7, gauge.landingTargetPct);
  const description = `${providerLabel(gauge.provider)} ${gauge.label}: ${Math.round(used)}% of the weekly budget used, ${Math.round(gauge.interactivePct)}% forecast for your own use, ${Math.round(gauge.bobPct)}% planned for Bob, landing target ${gauge.landingTargetPct}%. ${gauge.resetLabel}.`;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={description}
      className={cn(
        "group relative flex w-[164px] shrink-0 flex-col items-center rounded-xl border px-3 pt-3 pb-3 text-left transition-all",
        "bg-card hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selected ? "border-primary shadow-md" : "border-border",
      )}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="font-display text-sm font-semibold text-foreground">{providerLabel(gauge.provider)}</span>
        {gauge.estimated ? (
          <span className="rounded-full border border-dashed border-muted-foreground/60 px-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">est.</span>
        ) : null}
      </div>
      <span className="w-full truncate font-mono text-[11px] text-muted-foreground">{gauge.label}</span>

      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="mt-1" aria-hidden>
        <defs>
          <pattern id={patternId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--muted-foreground)" strokeWidth="2" strokeOpacity="0.45" />
          </pattern>
        </defs>
        <circle cx={C} cy={C} r={R_OUTER} fill="none" stroke="var(--muted)" strokeWidth={STROKE} />
        {/* Reserve band: held back for you until the release window. */}
        <path d={arc(R_OUTER, reserveFrom, gauge.landingTargetPct)} fill="none" stroke={`url(#${patternId})`} strokeWidth={STROKE} />
        <path className="budget-arc" d={arc(R_OUTER, 0, used)} fill="none" stroke="var(--foreground)" strokeOpacity={0.82} strokeWidth={STROKE} strokeLinecap="butt" />
        <path className="budget-arc" d={arc(R_OUTER, used, youEnd)} fill="none" stroke="var(--budget-you)" strokeWidth={STROKE} />
        <path
          className="budget-arc"
          d={arc(R_OUTER, youEnd, bobEnd)}
          fill="none"
          stroke={TONE_RING[gauge.tone]}
          strokeWidth={STROKE}
          strokeDasharray={gauge.estimated ? "3 2" : undefined}
        />
        {/* Landing target tick. */}
        <line x1={tx} y1={ty} x2={tx2} y2={ty2} stroke="var(--budget-target)" strokeWidth={2.5} strokeLinecap="round" />
        {gauge.shortPct !== undefined ? (
          <>
            <circle cx={C} cy={C} r={R_INNER} fill="none" stroke="var(--muted)" strokeWidth={4} />
            <path d={arc(R_INNER, 0, gauge.shortPct)} fill="none" stroke={gauge.shortPct >= 80 ? "var(--destructive)" : "var(--budget-short)"} strokeWidth={4} strokeLinecap="round" />
          </>
        ) : null}
        <text x={C} y={C - 2} textAnchor="middle" className="fill-foreground font-display" fontSize="26" fontWeight={650}>
          {Math.round(used)}
          <tspan fontSize="13" dx="1">%</tspan>
        </text>
        <text x={C} y={C + 16} textAnchor="middle" className="fill-muted-foreground font-mono" fontSize="10">
          {gauge.headline.toLowerCase()}
        </text>
      </svg>

      <div className="mt-1 flex w-full items-center justify-between gap-1 font-mono text-[10.5px] text-muted-foreground">
        <span className="truncate" title={gauge.resetLabel}>
          {gauge.resetLabel.replace(/^resets /, "↻ ")}
        </span>
      </div>
      <div className="mt-1.5 flex w-full items-center gap-1.5 text-[11px]">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium",
            gauge.tone === "down" ? "bg-destructive/12 text-destructive" : gauge.slots > 0 ? "bg-primary/14 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {gauge.tone === "down" ? gauge.headline : `+${gauge.slots} slot${gauge.slots === 1 ? "" : "s"}`}
        </span>
        {gauge.active > 0 ? <span className="text-muted-foreground">{gauge.active} running</span> : null}
      </div>
    </button>
  );
}

export function GaugeLegend() {
  const item = (color: string, label: string, hatch = false) => (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-3.5 rounded-sm"
        style={hatch ? { backgroundImage: `repeating-linear-gradient(45deg, var(--muted-foreground) 0 1.5px, transparent 1.5px 4px)`, opacity: 0.7 } : { background: color }}
      />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {item("color-mix(in oklab, var(--foreground) 82%, transparent)", "used")}
      {item("var(--budget-you)", "your forecast use")}
      {item("var(--primary)", "Bob's plan to reset")}
      {item("", "reserve for you", true)}
      {item("var(--budget-target)", "landing target")}
      {item("var(--budget-short)", "5-hour window (inner)")}
    </div>
  );
}
