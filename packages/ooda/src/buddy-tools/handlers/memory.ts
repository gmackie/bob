// Thread memory handlers.
//
// Three tools against `public.thread_memory`:
//   - thread_links_suggest — backed by `research.linksByThread`.
//   - thread_memory_search — text-fallback search via
//     `research.threadMemorySearch`. A real embedding-backed variant
//     lands when the synergy embedder replaces the zero-vec placeholder.
//   - thread_memory_update — upserts rolling_summary_md +
//     topic_fingerprint via `research.threadMemoryUpdate`.

import type { ToolHandler } from "../handler";

export const thread_memory_search: ToolHandler<"thread_memory_search"> = async (
  args,
  ctx,
) => {
  // Schema scope values map 1:1 onto the router. When scope='this' the
  // router needs the caller's thread id; pull from ctx.threadId.
  const r = await ctx.trpc.research.threadMemorySearch({
    query: args.query,
    scope: args.scope,
    ...(args.scope === "this" ? { threadId: ctx.threadId } : {}),
    limit: args.limit,
  });
  return {
    threads: r.threads.map((t) => ({
      thread_id: t.threadId,
      title: t.title,
      rolling_summary_md: t.rollingSummaryMd,
      topics: t.topics,
      score: t.score,
      updated_at:
        t.updatedAt instanceof Date
          ? t.updatedAt.toISOString()
          : String(t.updatedAt),
    })),
  };
};

export const thread_memory_update: ToolHandler<"thread_memory_update"> = async (
  args,
  ctx,
) => {
  const r = await ctx.trpc.research.threadMemoryUpdate({
    threadId: args.thread_id,
    summaryMd: args.summary_md,
    topics: args.topics,
  });
  return {
    thread_id: r.threadId,
    updated_at:
      r.updatedAt instanceof Date
        ? r.updatedAt.toISOString()
        : String(r.updatedAt),
  };
};

export const thread_links_suggest: ToolHandler<"thread_links_suggest"> = async (
  args,
  ctx,
) => {
  const r = await ctx.trpc.research.linksByThread({
    threadId: args.thread_id,
    limit: args.limit,
  });
  return {
    links: r.items.map((it) => ({
      to_thread_id: it.otherThreadId,
      to_thread_title: it.otherThreadTitle ?? null,
      // The DB schema has more `kind` values than the agent-facing tool
      // enum (topic_overlap / citation_overlap / question_answered).
      // Coerce unknown kinds to "topic_overlap" as a safe default until
      // we widen the agent schema — losing specificity is preferable to
      // crashing the dispatcher on a Zod validation error.
      kind:
        it.kind === "topic_overlap" ||
        it.kind === "citation_overlap" ||
        it.kind === "question_answered"
          ? it.kind
          : ("topic_overlap" as const),
      score: typeof it.score === "number" ? it.score : 0,
      reason_md: it.reasonMd ?? null,
    })),
  };
};
