"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { itemCommands, planCommands, STATE_PRESENTATION } from "@bob/sdlc-view";

import { cn } from "@gmacko/core/ui";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { ActionsPanel } from "~/components/sdlc/actions-panel";
import { AnswerForm } from "~/components/sdlc/attempt-answer";
import { answerablePending } from "~/components/sdlc/attempt-model";
import { AttemptView } from "~/components/sdlc/attempt-view";
import { itemTarget, planTarget, type ActionContext } from "~/components/sdlc/commands-model";
import { ItemDetail } from "~/components/sdlc/item-detail";
import { PlanDag } from "~/components/sdlc/plan-dag";
import {
  bannerFor,
  drillInto,
  itemTitle,
  scopeFromParams,
  sdlcHref,
  sdlcPageModel,
  stateFromParams,
  type Banner,
} from "~/components/sdlc/sdlc-page-model";
import { AttentionBadge } from "~/components/sdlc/state-badge";
import { StateGraph } from "~/components/sdlc/state-graph";
import { useSdlcEdge } from "~/components/sdlc/use-sdlc-edge";

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function bannerText(banner: Banner): string {
  switch (banner.kind) {
    case "connecting":
      return "Connecting to the SDLC edge…";
    case "reconnecting":
      return "Reconnecting to the SDLC edge… Showing the last view received.";
    case "coordinator-offline":
      return banner.since
        ? `The coordinator has been silent since ${new Date(banner.since).toLocaleTimeString()}. Showing the last snapshot.`
        : "The SDLC edge has not heard from the coordinator yet.";
  }
}

export default function SdlcPage() {
  const { view, connection, commands, send, attempt, watch } = useSdlcEdge();
  const now = useNow(15_000);
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope = useMemo(() => scopeFromParams(searchParams), [searchParams]);
  const state = stateFromParams(searchParams);
  const setState = (next: typeof state) => router.replace(sdlcHref(scope, next), { scroll: false });
  // ?item= is where an SDLC push or inbox row points (BOB-81); it only seeds the selection.
  const [itemId, setItemId] = useState<string | null>(() => searchParams.get("item"));
  const [planId, setPlanId] = useState<string | null>(null);

  // The selection is looked up within the scope, so drilling elsewhere hides it.
  const model = useMemo(() => sdlcPageModel(view, scope, state, { itemId, planId }), [view, scope, state, itemId, planId]);
  const banner = bannerFor(view, connection, now);
  const selectedRow = model.selected;
  const plan = model.plan;
  const actionContext: ActionContext = { connection, banner, hasView: view.epoch !== null, commands };
  const watchedItemId = selectedRow?.item.itemId ?? null;
  // Watch the selected item's attempt detail; null stops it. The client re-sends it after a reconnect.
  useEffect(() => { watch(watchedItemId); }, [watch, watchedItemId]);
  const pending = selectedRow ? answerablePending(selectedRow.item) : null;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <Breadcrumbs items={model.breadcrumbs} />

      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">SDLC</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Live item states from the durable coordinator. Plan and item actions run through the coordinator as you.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Review and deploy aren&apos;t automated yet: the coordinator doesn&apos;t move items into those states, so items stop at Validating or Completed.
        </p>
      </div>

      {banner && (
        <p
          role="status"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-300"
        >
          {bannerText(banner)}
        </p>
      )}

      <section aria-label="Item states" className="overflow-x-auto rounded-xl border border-border bg-card px-4 py-3">
        <StateGraph
          counts={model.counts}
          selected={state}
          onSelect={(s) => setState(state === s ? null : s)}
        />
      </section>

      {model.status === "waiting" && (
        <div className="rounded-lg border border-dashed border-border px-8 py-12 text-center text-sm text-muted-foreground">
          Waiting for the first snapshot from the SDLC edge.
        </div>
      )}
      {model.status === "empty" && (
        <div className="rounded-lg border border-dashed border-border px-8 py-12 text-center text-sm text-muted-foreground">
          No coordinator plans yet. Plans created through the coordinator appear here live.
        </div>
      )}

      {model.status === "ready" && (
        <>
          {model.groupLevel && model.groups.length > 0 && (
            <section aria-label={model.groupLevel === "project" ? "Projects" : "Repositories"} className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">{model.groupLevel === "project" ? "Projects" : "Repositories"}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {model.groups.map((g) => (
                  <Link
                    key={g.key}
                    href={sdlcHref(drillInto(scope, model.groupLevel!, g), state)}
                    className="rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="font-medium text-foreground">{g.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {g.count} {g.count === 1 ? "item" : "items"}
                      {g.attention > 0 && <span className="text-amber-600 dark:text-amber-400"> · {g.attention} need attention</span>}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {model.attention.length > 0 && (
            <section aria-label="Needs attention" className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">Needs attention</h2>
              <ul className="divide-y divide-border rounded-xl border border-amber-500/30">
                {model.attention.map((r) => (
                  <li key={r.item.itemId}>
                    <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-muted/50" onClick={() => setItemId(r.item.itemId)}>
                      <span className="truncate">{itemTitle(r)} <span className="text-muted-foreground">· {r.target.repository.repositoryId}</span></span>
                      <AttentionBadge state={r.item.state} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
            <section aria-label="Items" className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">
                  {state ? STATE_PRESENTATION[state].label : "All items"} ({model.listed.length})
                </h2>
                {state && (
                  <button type="button" onClick={() => setState(null)} className="text-xs text-muted-foreground hover:text-foreground">
                    Show all states
                  </button>
                )}
              </div>
              {model.listed.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No items here{state ? ` in ${STATE_PRESENTATION[state].label}` : ""}.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {model.listed.map((r) => (
                    <li key={r.item.itemId}>
                      <button
                        type="button"
                        aria-current={r.item.itemId === itemId ? "true" : undefined}
                        className={cn("flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-muted/50", r.item.itemId === itemId && "bg-muted/50")}
                        onClick={() => setItemId(r.item.itemId)}
                      >
                        <span className="truncate">
                          {itemTitle(r)}
                          <span className="text-muted-foreground"> · {r.startupName} / {r.target.repository.repositoryId}</span>
                        </span>
                        <AttentionBadge state={r.item.state} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="space-y-4">
              {selectedRow && (
                <ItemDetail
                  row={selectedRow}
                  onClose={() => setItemId(null)}
                  onOpenPlan={() => setPlanId(selectedRow.plan.planId)}
                  attempt={
                    selectedRow.item.execution ? (
                      <AttemptView
                        item={selectedRow.item}
                        attempt={attempt}
                        answer={pending && (
                          <AnswerForm key={pending.promptId} itemId={selectedRow.item.itemId} pending={pending} context={actionContext} send={send} />
                        )}
                      />
                    ) : undefined
                  }
                  actions={
                    <ActionsPanel
                      label="Item actions"
                      resourceId={selectedRow.item.itemId}
                      options={itemCommands(selectedRow.item)}
                      target={itemTarget(itemTitle(selectedRow), selectedRow.plan.planId)}
                      context={actionContext}
                      send={send}
                    />
                  }
                />
              )}
            </div>
          </div>

          {plan && (
            <PlanDag
              plan={plan}
              items={view.items}
              onSelect={setItemId}
              onClose={() => setPlanId(null)}
              actions={
                <ActionsPanel
                  label="Plan actions"
                  resourceId={plan.planId}
                  options={planCommands(plan)}
                  target={planTarget(plan.planId)}
                  context={actionContext}
                  send={send}
                />
              }
            />
          )}
        </>
      )}
    </main>
  );
}
