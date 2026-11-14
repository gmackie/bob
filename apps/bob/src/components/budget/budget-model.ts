/**
 * View-model for the /budget cockpit (BOB-76). Pure: turns the governor's
 * read model and verdicts into what the gauges, the week river, the lever
 * diff and the decision feed draw. The page re-runs the governor on a draft
 * policy and feeds both verdicts through here, so every preview number comes
 * from the same code the server enforces with.
 */
import type { AccountVerdict, AssembledAccount, BudgetPolicy, BudgetStateWire, BudgetVerdict } from "@bob/ws";

export type GaugeTone = "ok" | "attention" | "idle" | "down";

export interface GaugeModel {
  accountId: string;
  provider: string;
  label: string;
  /** All 0–100, cumulative along the ring: used → +interactive → +Bob, reserve shown separately. */
  usedPct: number;
  interactivePct: number;
  bobPct: number;
  reservePct: number;
  landingTargetPct: number;
  projectedPct: number;
  shortPct?: number;
  resetsAt?: string;
  resetLabel: string;
  observedLabel?: string;
  estimated: boolean;
  slots: number;
  active: number;
  tone: GaugeTone;
  headline: string;
  reasons: string[];
}

const PROVIDER_LABEL: Record<string, string> = { claude: "Claude", codex: "Codex", grok: "xAI", kimi: "Kimi", gemini: "Gemini" };

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}

export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.round((abs % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.round(h / 24)}d`;
  if (h >= 1) return `${h}h${m ? ` ${m}m` : ""}`;
  return `${m}m`;
}

export function formatResetLabel(resetsAt: string | undefined, now: Date): string {
  if (!resetsAt) return "reset unknown";
  const at = new Date(resetsAt);
  const ms = at.getTime() - now.getTime();
  const day = at.toLocaleDateString(undefined, { weekday: "short" });
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return ms <= 0 ? "reset passed" : `resets ${day} ${time} · ${formatDuration(ms)}`;
}

const clampPct = (n: number) => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));

export function buildGauges(state: BudgetStateWire, assembled: AssembledAccount[], verdict: BudgetVerdict, now: Date): GaugeModel[] {
  return assembled.map((a) => {
    const v = verdict.accounts.find((x) => x.accountId === a.input.accountId);
    const policy = state.policy;
    const override = policy.accounts[a.input.accountId] ?? {};
    const landingTargetPct = override.landingPct ?? policy.landingPct;
    const used = clampPct(v?.usedPercent ?? a.weekly?.usedPercent ?? 0);
    const interactive = clampPct(v?.interactiveForecastPct ?? 0);
    const bob = clampPct(v?.spendablePct ?? 0);
    const reserve = clampPct(v?.effectiveReservePct ?? 0);
    const metered = Boolean(a.weekly);
    const status = a.input.status;
    let tone: GaugeTone = "ok";
    let headline: string;
    if (status !== "ready") {
      tone = "down";
      headline = status === "cooldown" ? "Cooling down" : status === "disabled" ? "Disabled" : "Needs attention";
    } else if (!metered) {
      tone = "idle";
      headline = "Unmetered";
    } else if ((v?.slots ?? 0) > 0 || (v?.activeBobRuns ?? 0) > 0) {
      headline = `Landing ${Math.round(clampPct(used + interactive + bob))}%`;
    } else {
      tone = (v?.spendablePct ?? 0) > 0 ? "attention" : "idle";
      headline = (v?.spendablePct ?? 0) > 0 ? `Landing ${Math.round(clampPct(used + interactive + bob))}%` : "Nothing to spend";
    }
    const observedMs = a.weekly ? now.getTime() - Date.parse(a.weekly.observedAt) : undefined;
    return {
      accountId: a.input.accountId,
      provider: a.input.provider,
      label: a.label,
      usedPct: used,
      interactivePct: Math.min(interactive, 100 - used),
      bobPct: Math.min(bob, Math.max(0, 100 - used - interactive)),
      reservePct: reserve,
      landingTargetPct,
      projectedPct: clampPct(used + interactive + bob),
      ...(a.short ? { shortPct: clampPct(a.short.usedPercent) } : {}),
      ...(a.weekly?.resetsAt ? { resetsAt: a.weekly.resetsAt } : {}),
      resetLabel: metered ? formatResetLabel(a.weekly?.resetsAt, now) : "no meter",
      ...(observedMs !== undefined && Number.isFinite(observedMs) ? { observedLabel: `read ${formatDuration(observedMs)} ago` } : {}),
      estimated: Boolean(v?.estimated) || a.rates.estimated,
      slots: v?.slots ?? 0,
      active: v?.activeBobRuns ?? 0,
      tone,
      headline,
      reasons: [...(v?.reasons ?? []), ...(a.detail ? [a.detail] : [])],
    };
  });
}

export interface RiverPoint {
  /** Hours since the start of the weekly window. */
  t: number;
  pct: number;
}

export interface RiverSeries {
  accountId: string;
  label: string;
  windowHours: number;
  nowT: number;
  history: RiverPoint[];
  projection: RiverPoint[];
  /** Projection under the draft policy, when one is being previewed. */
  draftProjection?: RiverPoint[];
  landingTargetPct: number;
  reserveFloorPct: number;
  runEndT: number;
}

function projectionPoints(v: AccountVerdict, interactivePctPerHour: number, nowT: number, windowHours: number, steps = 24): RiverPoint[] {
  const points: RiverPoint[] = [{ t: nowT, pct: v.usedPercent }];
  const horizon = Math.max(0, Math.min(v.hoursToReset, windowHours - nowT));
  if (horizon <= 0) return points;
  // Bob spends its rate until run end; interactive use continues to reset.
  const bobHours = Math.min(horizon, v.hoursToRunEnd);
  const bobTotal = Math.min(v.spendablePct, v.ratePctPerHour * bobHours);
  for (let i = 1; i <= steps; i += 1) {
    const dt = (horizon * i) / steps;
    const bob = bobHours > 0 ? bobTotal * Math.min(1, dt / bobHours) : 0;
    points.push({ t: nowT + dt, pct: clampPct(v.usedPercent + interactivePctPerHour * dt + bob) });
  }
  return points;
}

export function buildRiver(
  state: BudgetStateWire,
  assembled: AssembledAccount[],
  verdict: BudgetVerdict,
  now: Date,
  draft?: BudgetVerdict,
): RiverSeries[] {
  return assembled.flatMap((a) => {
    const v = verdict.accounts.find((x) => x.accountId === a.input.accountId);
    if (!a.weekly || !v || !a.weekly.resetsAt) return [];
    const windowHours = (a.weekly.windowMinutes ?? 10_080) / 60;
    const resetMs = Date.parse(a.weekly.resetsAt);
    const startMs = resetMs - windowHours * 3_600_000;
    const toT = (ms: number) => (ms - startMs) / 3_600_000;
    const nowT = Math.min(windowHours, Math.max(0, toT(now.getTime())));
    const history = state.meters
      .filter((m) => m.accountId === a.input.accountId && m.window === "weekly" && m.resetsAt === a.weekly!.resetsAt)
      .map((m) => ({ t: toT(Date.parse(m.observedAt)), pct: clampPct(m.usedPercent) }))
      .filter((p) => p.t >= 0 && p.t <= nowT + 0.01);
    if (history.length === 0 || history[0]!.t > 0.5) history.unshift({ t: 0, pct: 0 });
    const dv = draft?.accounts.find((x) => x.accountId === a.input.accountId);
    const override = state.policy.accounts[a.input.accountId] ?? {};
    return [
      {
        accountId: a.input.accountId,
        label: `${providerLabel(a.input.provider)} · ${a.label}`,
        windowHours,
        nowT,
        history,
        projection: projectionPoints(v, a.input.interactivePctPerHour, nowT, windowHours),
        ...(dv ? { draftProjection: projectionPoints(dv, a.input.interactivePctPerHour, nowT, windowHours) } : {}),
        landingTargetPct: override.landingPct ?? state.policy.landingPct,
        reserveFloorPct: (override.landingPct ?? state.policy.landingPct) - (override.reservePct ?? state.policy.reservePct),
        runEndT: Math.min(windowHours, nowT + v.hoursToRunEnd),
      },
    ];
  });
}

export interface PolicyChange {
  key: string;
  label: string;
  from: string;
  to: string;
}

const LEVER_LABELS: Partial<Record<keyof BudgetPolicy, [string, (v: unknown) => string]>> = {
  enforce: ["Enforcement", (v) => (v ? "on" : "shadow")],
  mode: ["Mode", (v) => String(v)],
  modeUntil: ["Mode until", (v) => (v ? new Date(String(v)).toLocaleString() : "—")],
  boostFactor: ["Boost", (v) => `×${Number(v).toFixed(1)}`],
  reservePct: ["Interactive reserve", (v) => `${v}%`],
  shortCeilingPct: ["5h ceiling", (v) => `${v}%`],
  landingPct: ["Landing target", (v) => `${v}%`],
  landingBufferHours: ["Landing buffer", (v) => `${v}h`],
  releaseWindowHours: ["Reserve release", (v) => `${v}h`],
  paceShape: ["Pace shape", (v) => String(v)],
  concurrencyCap: ["Concurrency cap", (v) => String(v)],
  perRunCostCapPct: ["Per-run cost cap", (v) => `${v}%`],
  unmeteredConcurrency: ["Unmetered concurrency", (v) => String(v)],
};

export function policyChanges(live: BudgetPolicy, draft: BudgetPolicy): PolicyChange[] {
  const changes: PolicyChange[] = [];
  for (const key of Object.keys(draft) as Array<keyof BudgetPolicy>) {
    if (JSON.stringify(live[key]) === JSON.stringify(draft[key])) continue;
    const known = LEVER_LABELS[key];
    if (known) {
      changes.push({ key, label: known[0], from: known[1](live[key]), to: known[1](draft[key]) });
    } else if (key === "tiers") {
      changes.push({ key, label: "Surplus ladder", from: live.tiers.filter((t) => t.enabled).map((t) => t.tier).join(" → "), to: draft.tiers.filter((t) => t.enabled).map((t) => t.tier).join(" → ") });
    } else if (key === "accounts") {
      changes.push({ key, label: "Per-account overrides", from: `${Object.keys(live.accounts).length}`, to: `${Object.keys(draft.accounts).length}` });
    } else if (key === "projectWeights") {
      changes.push({ key, label: "Project weights", from: `${Object.keys(live.projectWeights).length}`, to: `${Object.keys(draft.projectWeights).length}` });
    }
  }
  return changes;
}

export interface ImpactSummary {
  slotsDelta: number;
  landing: Array<{ accountId: string; from: number; to: number }>;
  sentence: string;
}

export function impactOf(live: BudgetVerdict, draft: BudgetVerdict): ImpactSummary {
  const landing = draft.accounts
    .map((d) => {
      const l = live.accounts.find((x) => x.accountId === d.accountId);
      return { accountId: d.accountId, from: Math.round(l?.projectedLandingPct ?? 0), to: Math.round(d.projectedLandingPct) };
    })
    .filter((x) => x.from !== x.to);
  const slotsDelta = draft.totalSlots - live.totalSlots;
  const parts: string[] = [];
  if (slotsDelta !== 0) parts.push(`${slotsDelta > 0 ? "+" : ""}${slotsDelta} run${Math.abs(slotsDelta) === 1 ? "" : "s"} now`);
  for (const l of landing.slice(0, 3)) parts.push(`${l.accountId}: ${l.from}% → ${l.to}%`);
  return { slotsDelta, landing, sentence: parts.length ? parts.join(" · ") : "No change to what Bob would run" };
}

export interface DecisionLine {
  id: number;
  at: string;
  timeLabel: string;
  enforce: boolean;
  headline: string;
  details: string[];
}

export function decisionLines(
  decisions: Array<{ id: number; decidedAt: string; enforce: boolean; mode: string; totalSlots: number; legacyBudget: number | null; byProvider: Record<string, { slots: number }>; reasons: Array<{ accountId: string; reasons: string[]; slots: number }> }>,
): DecisionLine[] {
  return decisions.map((d) => {
    const providers = Object.entries(d.byProvider)
      .filter(([, e]) => e.slots > 0)
      .map(([p, e]) => `${providerLabel(p)} ${e.slots}`)
      .join(", ");
    const verb = d.enforce ? "Allowed" : "Would allow";
    const legacy = d.legacyBudget !== null && !d.enforce ? ` (legacy pacing: ${d.legacyBudget})` : "";
    const headline = d.mode === "pause" ? "Paused — nothing dispatched" : `${verb} ${d.totalSlots} run${d.totalSlots === 1 ? "" : "s"}${providers ? ` · ${providers}` : ""}${legacy}`;
    return {
      id: d.id,
      at: d.decidedAt,
      timeLabel: new Date(d.decidedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
      enforce: d.enforce,
      headline,
      details: d.reasons.filter((r) => r.reasons.length).map((r) => `${r.accountId}: ${r.reasons.join("; ")}`),
    };
  });
}
