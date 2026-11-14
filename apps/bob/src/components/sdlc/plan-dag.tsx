import { planLayers, type ItemSnapshot, type PlanSnapshot } from "@bob/sdlc-view";

import { AttentionBadge } from "./state-badge";

/**
 * A plan's items in dependency layers (longest path first to last), then its
 * dependency edges as a list, each with the milestone the downstream item waits for.
 */
export function PlanDag({ plan, items, onSelect, onClose }: {
  plan: PlanSnapshot;
  items: Record<string, ItemSnapshot>;
  onSelect: (itemId: string) => void;
  onClose: () => void;
}) {
  const label = (id: string) => {
    const issue = plan.definition.items.find((d) => d.itemId === id)?.issue;
    return issue?.identifier ?? issue?.issueId ?? id;
  };
  const layers = planLayers(plan);
  return (
    <section aria-label="Plan dependencies" className="rounded-xl border border-border bg-card px-5 py-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">Plan <span className="font-mono">{plan.planId.slice(0, 8)}</span></h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {plan.state} · {plan.definition.items.length} items · up to {plan.definition.concurrencyLimit} at once · v{plan.resourceVersion}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close plan"
          className="rounded-md px-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          ×
        </button>
      </div>

      <div className="mt-4 flex gap-6 overflow-x-auto pb-2">
        {layers.map((layer, i) => (
          <div key={i} className="min-w-[10rem] space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Layer {i + 1}</div>
            <ol aria-label={`Layer ${i + 1}`} className="space-y-1.5">
              {layer.map((id) => {
                const item = items[id];
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => onSelect(id)}
                      className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <span className="truncate">{label(id)}</span>
                      {item ? <AttentionBadge state={item.state} /> : <span className="text-xs text-muted-foreground">not seen</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>

      <h3 className="mt-3 text-xs font-medium text-muted-foreground">Dependencies</h3>
      {plan.definition.dependencies.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">None: every item can start once the plan is active.</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-xs">
          {plan.definition.dependencies.map((d) => (
            <li key={`${d.upstreamItemId}->${d.downstreamItemId}`}>
              {label(d.downstreamItemId)} waits for {label(d.upstreamItemId)} to reach <span className="font-medium">{d.requiredMilestone}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
