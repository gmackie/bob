import { STATE_PRESENTATION, type Attention, type ItemState } from "@bob/sdlc-view";

import { cn } from "@gmacko/core/ui";

const TONE: Record<Attention, string> = {
  ok: "border-border text-muted-foreground",
  stalled: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  needs_human: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** An item state, tinted by how much it needs attention. */
export function AttentionBadge({ state, className }: { state: ItemState; className?: string }) {
  const s = STATE_PRESENTATION[state];
  return (
    <span data-attention={s.attention} className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium", TONE[s.attention], className)}>
      {s.label}
    </span>
  );
}
