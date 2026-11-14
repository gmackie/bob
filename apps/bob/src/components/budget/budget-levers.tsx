"use client";

import { useId, useState } from "react";

import { cn } from "@gmacko/core/ui";
import type { BudgetMode, BudgetPolicy, BudgetTier, PaceShape, TierPolicy } from "@bob/ws";

import type { ImpactSummary, PolicyChange } from "./budget-model";

// ---------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------

function Lever({
  label,
  hint,
  value,
  live,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  live: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const changed = value !== live;
  const pct = ((value - min) / (max - min)) * 100;
  const livePct = ((live - min) / (max - min)) * 100;
  return (
    <div className="group">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-foreground">
          {label}
        </label>
        <span className={cn("font-mono text-[13px] tabular-nums", changed ? "text-primary" : "text-muted-foreground")}>
          {changed ? <span className="mr-1 text-muted-foreground line-through decoration-1">{live}{unit}</span> : null}
          {value}
          {unit}
        </span>
      </div>
      <div className="relative mt-1.5 h-5">
        <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-muted" />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
        {changed ? (
          <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded bg-muted-foreground/60" style={{ left: `${livePct}%` }} title={`live: ${live}${unit}`} />
        ) : null}
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-describedby={`${id}-hint`}
          className="budget-range absolute inset-0 w-full cursor-pointer appearance-none bg-transparent"
        />
      </div>
      <p id={`${id}-hint`} className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border bg-muted/60 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            value === option.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode control (header)
// ---------------------------------------------------------------------------

const BOOST_DURATIONS = [
  { hours: 2, label: "2h" },
  { hours: 6, label: "6h" },
  { hours: 24, label: "1 day" },
];

export function ModeControl({ policy, onChange, now }: { policy: BudgetPolicy; onChange: (patch: Partial<BudgetPolicy>) => void; now: Date }) {
  const until = policy.modeUntil ? new Date(policy.modeUntil) : undefined;
  const active = policy.mode !== "run" && (!until || until.getTime() > now.getTime()) ? policy.mode : "run";
  const set = (mode: BudgetMode, hours?: number) => {
    if (mode === "run") onChange({ mode: "run", modeUntil: undefined });
    else onChange({ mode, modeUntil: hours ? new Date(now.getTime() + hours * 3_600_000).toISOString() : undefined });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Dispatch mode" className="inline-flex rounded-xl border border-border bg-card p-1 shadow-sm">
        {(
          [
            { mode: "run", label: "Run", key: "R" },
            { mode: "pause", label: "Pause", key: "P" },
            { mode: "boost", label: `Boost ×${policy.boostFactor.toFixed(1)}`, key: "B" },
          ] as const
        ).map((item) => (
          <button
            key={item.mode}
            type="button"
            role="radio"
            aria-checked={active === item.mode}
            aria-keyshortcuts={item.key}
            onClick={() => set(item.mode, item.mode === "run" ? undefined : 2)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-semibold transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active === item.mode
                ? item.mode === "pause"
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
            <kbd className="ml-1.5 hidden font-mono text-[10px] opacity-60 sm:inline">{item.key}</kbd>
          </button>
        ))}
      </div>
      {active !== "run" ? (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>for</span>
          {BOOST_DURATIONS.map((d) => (
            <button
              key={d.hours}
              type="button"
              onClick={() => set(active, d.hours)}
              className="rounded-md border border-border px-1.5 py-0.5 font-mono hover:border-primary hover:text-foreground"
            >
              {d.label}
            </button>
          ))}
          {until ? <span className="ml-1 font-mono">until {until.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Levers panel (right rail)
// ---------------------------------------------------------------------------

export function LeversPanel({
  live,
  draft,
  onChange,
  changes,
  impact,
  onCommit,
  onDiscard,
  committing,
  error,
}: {
  live: BudgetPolicy;
  draft: BudgetPolicy;
  onChange: (patch: Partial<BudgetPolicy>) => void;
  changes: PolicyChange[];
  impact: ImpactSummary | undefined;
  onCommit: (note: string) => void;
  onDiscard: () => void;
  committing: boolean;
  error?: string;
}) {
  const [note, setNote] = useState("");
  return (
    <section aria-labelledby="levers-title" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 id="levers-title" className="font-display text-base font-semibold">
          Levers
        </h2>
        {changes.length ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/14 px-2 py-0.5 text-xs font-medium text-primary">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            {changes.length} draft{changes.length === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">live</span>
        )}
      </div>

      <Lever label="Interactive reserve" hint="Held back for your own sessions until the release window." value={draft.reservePct} live={live.reservePct} min={0} max={60} unit="%" onChange={(v) => onChange({ reservePct: v })} />
      <Lever label="Landing target" hint="How full each subscription should be at its weekly reset." value={draft.landingPct} live={live.landingPct} min={50} max={100} unit="%" onChange={(v) => onChange({ landingPct: v })} />
      <Lever label="5-hour ceiling" hint="Bob stops using an account whose metered 5-hour window is above this." value={draft.shortCeilingPct} live={live.shortCeilingPct} min={30} max={100} unit="%" onChange={(v) => onChange({ shortCeilingPct: v })} />
      <Lever label="Reserve release" hint="Unused reserve unlocks gradually over this many hours before reset." value={draft.releaseWindowHours} live={live.releaseWindowHours} min={0} max={48} unit="h" onChange={(v) => onChange({ releaseWindowHours: v })} />
      <Lever label="Landing buffer" hint="No new runs this close to a reset." value={draft.landingBufferHours} live={live.landingBufferHours} min={0} max={12} step={0.5} unit="h" onChange={(v) => onChange({ landingBufferHours: v })} />
      <Lever label="Concurrency cap" hint="Most Bob runs at once, across every subscription." value={draft.concurrencyCap} live={live.concurrencyCap} min={0} max={24} unit="" onChange={(v) => onChange({ concurrencyCap: v })} />
      <Lever label="Boost factor" hint="How much faster Boost spends. It never crosses the reserve." value={draft.boostFactor} live={live.boostFactor} min={1} max={4} step={0.1} unit="×" onChange={(v) => onChange({ boostFactor: Math.round(v * 10) / 10 })} />

      <div>
        <div className="mb-1.5 text-[13px] font-medium">Pace shape</div>
        <Segmented<PaceShape>
          label="Pace shape"
          value={draft.paceShape}
          onChange={(v) => onChange({ paceShape: v })}
          options={[
            { value: "even", label: "Even" },
            { value: "working-hours", label: "Work hours" },
            { value: "front-load", label: "Front" },
            { value: "back-load", label: "Back" },
          ]}
        />
      </div>

      <div className="rounded-xl border border-dashed border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium">Enforcement</div>
            <p className="text-[11.5px] text-muted-foreground">
              {draft.enforce ? "The governor decides what autoDrain dispatches." : "Shadow: the governor decides and records; legacy pacing dispatches."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draft.enforce}
            onClick={() => onChange({ enforce: !draft.enforce })}
            className={cn("relative h-6 w-11 shrink-0 rounded-full border border-border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", draft.enforce ? "bg-primary" : "bg-muted")}
          >
            <span className={cn("absolute top-0.5 size-5 rounded-full bg-card shadow transition-transform", draft.enforce ? "translate-x-5" : "translate-x-0.5")} />
            <span className="sr-only">Enforce the budget governor</span>
          </button>
        </div>
      </div>

      <div className={cn("sticky bottom-0 -mx-4 -mb-4 rounded-b-2xl border-t border-border bg-card/95 p-4 backdrop-blur", !changes.length && "opacity-60")}>
        {changes.length ? (
          <>
            <ul className="mb-2 space-y-0.5 text-[12px]">
              {changes.map((c) => (
                <li key={c.key} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{c.label}</span>
                  <span className="font-mono">
                    {c.from} <span className="text-muted-foreground">→</span> <span className="text-primary">{c.to}</span>
                  </span>
                </li>
              ))}
            </ul>
            {impact ? <p className="mb-2 text-[12px] font-medium text-foreground">{impact.sentence}</p> : null}
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Why? (optional, kept in the audit log)"
              maxLength={500}
              className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] outline-none focus:border-primary"
            />
          </>
        ) : (
          <p className="mb-2 text-[12px] text-muted-foreground">Drag a lever to preview its effect before committing.</p>
        )}
        {error ? <p className="mb-2 text-[12px] text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <button type="button" onClick={onDiscard} disabled={!changes.length || committing} className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed">
            Discard <kbd className="ml-1 font-mono text-[10px] opacity-60">Esc</kbd>
          </button>
          <button
            type="button"
            onClick={() => onCommit(note)}
            disabled={!changes.length || committing}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {committing ? "Committing…" : "Commit"} <kbd className="ml-1 font-mono text-[10px] opacity-70">⌘⏎</kbd>
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Surplus ladder
// ---------------------------------------------------------------------------

const TIER_COPY: Record<BudgetTier, { title: string; body: string }> = {
  delivery: { title: "Delivery", body: "Ready and todo Kanbanger issues. Always first." },
  groom: { title: "Groom & plan", body: "Specs, estimates and splits for backlog issues, as proposals." },
  "pull-forward": { title: "Pull forward", body: "Dispatch backlog items normally held behind the manual gate." },
  discovery: { title: "Discovery", body: "Survey repos for debt, gaps and failing CI; propose new issues." },
  bizpulse: { title: "BizPulse", body: "Growth, compliance and research work on startup ventures, as proposals." },
};

export function SurplusLadder({
  tiers,
  live,
  allocation,
  onChange,
}: {
  tiers: TierPolicy[];
  live: TierPolicy[];
  allocation?: Partial<Record<BudgetTier, { runs: number; queued: number }>>;
  onChange: (tiers: TierPolicy[]) => void;
}) {
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 1 || target >= tiers.length) return;
    const next = [...tiers];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  const update = (index: number, patch: Partial<TierPolicy>) => onChange(tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  return (
    <section aria-labelledby="ladder-title" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="ladder-title" className="font-display text-base font-semibold">
          Surplus ladder
        </h2>
        <span className="text-xs text-muted-foreground">Budget nobody would otherwise use flows down this list</span>
      </div>
      <ol className="space-y-2">
        {tiers.map((tier, index) => {
          const copy = TIER_COPY[tier.tier];
          const liveTier = live.find((t) => t.tier === tier.tier);
          const changed = JSON.stringify(liveTier) !== JSON.stringify(tier) || live.indexOf(liveTier!) !== index;
          const a = allocation?.[tier.tier];
          return (
            <li
              key={tier.tier}
              className={cn(
                "grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                changed ? "border-primary/60 bg-primary/5" : "border-border",
                !tier.enabled && "opacity-55",
              )}
            >
              <span className="font-mono text-sm font-bold text-primary">{index + 1}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{copy.title}</span>
                  {a ? (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {a.runs} run{a.runs === 1 ? "" : "s"} · {a.queued} queued
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-[12px] text-muted-foreground">{copy.body}</p>
                {tier.tier !== "delivery" ? (
                  <label className="mt-1.5 flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    max share
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(tier.maxShare * 100)}
                      onChange={(event) => update(index, { maxShare: Number(event.target.value) / 100 })}
                      className="budget-range budget-range-track h-4 w-32 cursor-pointer appearance-none bg-transparent"
                      aria-label={`${copy.title} maximum share of surplus`}
                    />
                    <span className="w-9 font-mono tabular-nums">{Math.round(tier.maxShare * 100)}%</span>
                  </label>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                {tier.tier !== "delivery" ? (
                  <>
                    <button type="button" aria-label={`Move ${copy.title} up`} disabled={index <= 1} onClick={() => move(index, -1)} className="rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30">
                      ↑
                    </button>
                    <button type="button" aria-label={`Move ${copy.title} down`} disabled={index >= tiers.length - 1} onClick={() => move(index, 1)} className="rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30">
                      ↓
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={tier.enabled}
                      aria-label={`${copy.title} ${tier.enabled ? "on" : "off"}`}
                      onClick={() => update(index, { enabled: !tier.enabled })}
                      className={cn("relative ml-1 h-5 w-9 rounded-full transition-colors", tier.enabled ? "bg-primary" : "bg-muted")}
                    >
                      <span className={cn("absolute top-0.5 size-4 rounded-full bg-card shadow transition-transform", tier.enabled ? "translate-x-4" : "translate-x-0.5")} />
                    </button>
                  </>
                ) : (
                  <span className="text-[11px] text-muted-foreground">always on</span>
                )}
              </div>
            </li>
          );
        })}
        <li className="grid grid-cols-[1.5rem_1fr] items-center gap-3 px-3 py-1 text-[12px] text-muted-foreground">
          <span className="font-mono">—</span>
          <span>Lapse: anything still unallocated is left unused.</span>
        </li>
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Decision feed
// ---------------------------------------------------------------------------

export function DecisionFeed({ lines }: { lines: Array<{ id: number; timeLabel: string; enforce: boolean; headline: string; details: string[] }> }) {
  return (
    <section aria-labelledby="why-title" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="why-title" className="font-display text-base font-semibold">
          Why
        </h2>
        <span className="text-xs text-muted-foreground">one line per autoDrain tick</span>
      </div>
      {lines.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No decisions yet. The governor records one every 5 minutes once deployed.</p>
      ) : (
        <ol className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
          {lines.map((line) => (
            <li key={line.id}>
              <details className="group rounded-lg px-2 py-1.5 hover:bg-muted/60">
                <summary className="flex cursor-pointer list-none items-baseline gap-2 text-[12.5px]">
                  <span className="w-14 shrink-0 font-mono text-muted-foreground">{line.timeLabel}</span>
                  <span className={cn("size-1.5 shrink-0 translate-y-[-1px] rounded-full", line.enforce ? "bg-primary" : "bg-muted-foreground/50")} aria-label={line.enforce ? "enforced" : "shadow"} />
                  <span className="min-w-0 flex-1">{line.headline}</span>
                </summary>
                {line.details.length ? (
                  <ul className="mt-1 ml-[4.5rem] space-y-0.5 font-mono text-[11px] text-muted-foreground">
                    {line.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                ) : null}
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
