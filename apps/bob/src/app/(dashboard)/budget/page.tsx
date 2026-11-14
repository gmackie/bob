"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { governState, normalizeBudgetPolicy, type BudgetPolicy, type BudgetStateWire, type BudgetVerdict } from "@bob/ws";

import { BudgetGauge, GaugeLegend } from "~/components/budget/budget-gauge";
import { DecisionFeed, LeversPanel, ModeControl, SurplusLadder } from "~/components/budget/budget-levers";
import { buildGauges, buildRiver, decisionLines, impactOf, policyChanges, providerLabel, type DecisionLine } from "~/components/budget/budget-model";
import { WeekRiver } from "~/components/budget/week-river";
import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { useBobQueryClient } from "~/rpc/react";

interface BudgetStateResponse {
  state: BudgetStateWire;
  verdict: BudgetVerdict;
  decisions: Parameters<typeof decisionLines>[0];
  policyUpdatedAt: string | null;
  policyUpdatedBy: string | null;
}

/** Ticks the clock every 30s so countdowns and projections stay current. */
function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export default function BudgetPage() {
  const bobQuery = useBobQueryClient();
  const queryClient = useQueryClient();
  const now = useNow();
  const stateQuery = useQuery(bobQuery("budget.state").queryOptions({}, { refetchInterval: 30_000, staleTime: 10_000 }));
  const data = stateQuery.data as unknown as BudgetStateResponse | undefined;

  const livePolicy = data?.state.policy;
  const [draft, setDraft] = useState<BudgetPolicy | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ policy: BudgetPolicy; until: number } | null>(null);
  const [error, setError] = useState<string | undefined>();
  const draftPolicy = draft ?? livePolicy;

  const live = useMemo(() => (data ? governState(data.state, now) : undefined), [data, now]);
  const preview = useMemo(() => (data && draft ? governState(data.state, now, draft) : undefined), [data, draft, now]);
  const changes = useMemo(() => (livePolicy && draft ? policyChanges(livePolicy, normalizeBudgetPolicy(draft)) : []), [livePolicy, draft]);
  const impact = useMemo(() => (live && preview && changes.length ? impactOf(live.verdict, preview.verdict) : undefined), [live, preview, changes.length]);

  const shown = preview ?? live;
  const gauges = useMemo(() => (data && shown ? buildGauges({ ...data.state, policy: draftPolicy ?? data.state.policy }, shown.assembled, shown.verdict, now) : []), [data, shown, draftPolicy, now]);
  const river = useMemo(() => (data && live ? buildRiver(data.state, live.assembled, live.verdict, now, preview?.verdict) : []), [data, live, preview, now]);
  const activeSeries = river.find((s) => s.accountId === selected) ?? river[0];
  const lines: DecisionLine[] = useMemo(() => decisionLines(data?.decisions ?? []), [data?.decisions]);

  const mutation = useMutation(bobQuery("budget.setPolicy").mutationOptions({}));
  const patch = useCallback((p: Partial<BudgetPolicy>) => {
    if (!livePolicy) return;
    setDraft((current) => {
      const next = { ...(current ?? livePolicy), ...p } as BudgetPolicy;
      if ("modeUntil" in p && p.modeUntil === undefined) delete (next as Partial<BudgetPolicy>).modeUntil;
      return next;
    });
  }, [livePolicy]);

  const commit = useCallback(
    (policy: BudgetPolicy, note?: string, previous?: BudgetPolicy) => {
      setError(undefined);
      mutation.mutate(
        { policy: policy as unknown as Record<string, unknown>, ...(note ? { note } : {}) },
        {
          onSuccess: async () => {
            setDraft(null);
            if (previous) setUndo({ policy: previous, until: Date.now() + 10_000 });
            await queryClient.invalidateQueries();
          },
          onError: (e) => setError(e instanceof Error ? e.message : "Could not save the policy"),
        },
      );
    },
    [mutation, queryClient],
  );

  // Mode changes apply immediately (they are the emergency levers); the rest is drafted.
  const applyMode = useCallback(
    (p: Partial<BudgetPolicy>) => {
      if (!livePolicy) return;
      const next = { ...livePolicy, ...p } as BudgetPolicy;
      if (p.modeUntil === undefined) delete (next as Partial<BudgetPolicy>).modeUntil;
      commit(next, `mode → ${p.mode}`, livePolicy);
    },
    [livePolicy, commit],
  );

  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), Math.max(0, undo.until - Date.now()));
    return () => clearTimeout(id);
  }, [undo]);

  // Keyboard: P pause, B boost, R run, ⌘/Ctrl+Enter commit, Esc discard.
  const keyState = useRef({ draft, changes, livePolicy, applyMode, commit });
  keyState.current = { draft, changes, livePolicy, applyMode, commit };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const s = keyState.current;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && s.draft && s.changes.length) {
        event.preventDefault();
        s.commit(s.draft, undefined, s.livePolicy);
      } else if (event.key === "Escape" && s.draft) {
        setDraft(null);
      } else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "p") s.applyMode({ mode: "pause", modeUntil: new Date(Date.now() + 2 * 3_600_000).toISOString() });
        if (key === "b") s.applyMode({ mode: "boost", modeUntil: new Date(Date.now() + 2 * 3_600_000).toISOString() });
        if (key === "r") s.applyMode({ mode: "run", modeUntil: undefined });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const totals = shown?.verdict;
  const landingAvg = gauges.filter((g) => g.tone !== "down" && g.tone !== "idle");
  const down = gauges.filter((g) => g.tone === "down");

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
      <Breadcrumbs items={[{ label: "Budget" }]} className="mb-4" />

      <header className="budget-hero relative mb-6 overflow-hidden rounded-3xl border border-border px-5 py-6 sm:px-7">
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] tracking-[0.2em] text-primary uppercase">Subscription budget</p>
            <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
              {totals ? (
                <>
                  {totals.totalSlots} <span className="text-muted-foreground">run{totals.totalSlots === 1 ? "" : "s"} cleared to start</span>
                </>
              ) : (
                "Budget"
              )}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {totals?.enforce ? "Enforcing" : "Shadow mode — deciding and recording, legacy pacing still dispatches"}
              {landingAvg.length ? ` · ${landingAvg.length} metered subscription${landingAvg.length === 1 ? "" : "s"}` : ""}
              {down.length ? ` · ${down.length} need${down.length === 1 ? "s" : ""} attention` : ""}
            </p>
          </div>
          {livePolicy ? <ModeControl policy={livePolicy} onChange={applyMode} now={now} /> : null}
        </div>
      </header>

      {stateQuery.isError ? (
        <div role="alert" className="mb-6 rounded-xl border border-destructive/40 bg-destructive/8 p-4 text-sm text-destructive">
          Could not load the budget: {(stateQuery.error as Error)?.message ?? "unknown error"}. Only workspace owners can open this page.
        </div>
      ) : null}

      {!data && stateQuery.isLoading ? (
        <div className="grid gap-4" aria-busy>
          <div className="h-56 animate-pulse rounded-2xl bg-muted/60" />
          <div className="h-72 animate-pulse rounded-2xl bg-muted/60" />
        </div>
      ) : null}

      {data && live && draftPolicy ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-6">
            <section aria-label="Subscriptions" className="flex flex-col gap-3">
              {gauges.length ? (
                <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
                  {gauges.map((g, i) => (
                    <div key={g.accountId} className="budget-rise snap-start" style={{ animationDelay: `${i * 60}ms` }}>
                      <BudgetGauge gauge={g} selected={activeSeries?.accountId === g.accountId} onSelect={() => setSelected(g.accountId)} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No proxy accounts reported yet. They appear after the runner's next heartbeat.
                </p>
              )}
              <GaugeLegend />
            </section>

            <section aria-labelledby="river-title" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="river-title" className="font-display text-base font-semibold">
                  Week river {activeSeries ? <span className="font-normal text-muted-foreground">· {activeSeries.label}</span> : null}
                </h2>
                <span className="text-xs text-muted-foreground">
                  solid: used · dashed: plan{preview ? " · glow: draft levers" : ""}
                </span>
              </div>
              {activeSeries ? (
                <WeekRiver series={activeSeries} />
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">No metered subscription to chart yet.</p>
              )}
            </section>

            <SurplusLadder tiers={draftPolicy.tiers} live={livePolicy!.tiers} onChange={(tiers) => patch({ tiers })} />
            <DecisionFeed lines={lines} />
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
            <LeversPanel
              live={livePolicy!}
              draft={draftPolicy}
              onChange={patch}
              changes={changes}
              impact={impact}
              committing={mutation.isPending}
              error={error}
              onDiscard={() => setDraft(null)}
              onCommit={(note) => draft && commit(draft, note || undefined, livePolicy)}
            />
            {down.length ? (
              <section className="rounded-2xl border border-destructive/40 bg-destructive/6 p-4">
                <h2 className="mb-1 text-sm font-semibold text-destructive">Needs you</h2>
                <ul className="space-y-1 text-[12.5px]">
                  {down.map((g) => (
                    <li key={g.accountId}>
                      <span className="font-medium">{providerLabel(g.provider)} {g.label}</span>
                      <span className="text-muted-foreground"> — {g.reasons.join("; ") || g.headline}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
        </div>
      ) : null}

      {undo ? (
        <div role="status" className="fixed right-6 bottom-6 z-50 flex items-center gap-3 rounded-xl border border-border bg-popover px-4 py-3 text-sm shadow-xl">
          Policy updated.
          <button
            type="button"
            className="font-semibold text-primary hover:underline"
            onClick={() => {
              const previous = undo.policy;
              setUndo(null);
              commit(previous, "undo");
            }}
          >
            Undo
          </button>
        </div>
      ) : null}
    </main>
  );
}
