// Inbox handlers: list + triage.
//
// The tRPC `inboxByThread` returns row-shaped items with camelCase keys
// and joined `title/author/year` fields (no full paper snapshot). We
// re-shape into the agent's flatter envelope here and synthesize a
// PaperSummary-shaped `paper` field from what the join gave us.

import type { ToolHandler } from "../handler";

export const inbox_list: ToolHandler<"inbox_list"> = async (args, ctx) => {
  const r = await ctx.trpc.research.inboxByThread({
    threadId: ctx.threadId,
    triage: args.triage ?? "pending",
    limit: args.limit,
  });

  // `since` isn't supported by the tRPC procedure yet — it filters in
  // memory here so the agent's surface stays consistent. The procedure
  // already caps at `limit` so the memory cost is bounded.
  const since = args.since ? new Date(args.since).getTime() : null;

  return {
    items: r.items
      .filter((it) => {
        if (since === null) return true;
        const t =
          it.foundAt instanceof Date
            ? it.foundAt.getTime()
            : new Date(it.foundAt).getTime();
        return t >= since;
      })
      .map((it) => ({
        id: it.id,
        source_id: it.sourceId ?? null,
        paper:
          it.sourceId === null || it.sourceId === undefined
            ? null
            : {
                source_id: it.sourceId,
                s2_paper_id: null,
                title: it.title ?? "",
                abstract: null,
                authors: it.author ? [it.author] : [],
                year: it.year ?? null,
                venue: null,
                citation_count: null,
                doi: null,
              },
        // The tRPC shape doesn't return the interest id, just the label.
        // Until that's exposed, we leave the id null so the agent knows
        // not to rely on it.
        standing_interest_id: null,
        thread_id: null,
        found_at:
          it.foundAt instanceof Date
            ? it.foundAt.toISOString()
            : String(it.foundAt),
        triage: it.triage,
        reason_md: it.reasonMd ?? null,
      })),
  };
};

export const inbox_triage: ToolHandler<"inbox_triage"> = async (args, ctx) => {
  const r = await ctx.trpc.research.inboxTriage({
    id: args.id,
    action: args.action,
  });
  return {
    id: r.id,
    triage: r.triage,
  };
};
