// KB promotion handler — drafts a PR-style note. Never auto-commits.
//
// The tRPC procedure returns `{id, relativePath, status}`. The
// agent-facing schema wants `{promotion_id, kb_slug, dashboard_url,
// source_ids}`. We synthesize the dashboard URL from an env var; when
// `BUDDY_DASHBOARD_BASE_URL` is unset, we fall back to a relative path
// so the agent can still emit a clickable suggestion even without
// config.

import type { ToolHandler } from "../handler";

function dashboardUrl(relativePath: string): string {
  const base = process.env.BUDDY_DASHBOARD_BASE_URL?.trim();
  if (base) {
    return `${base.replace(/\/+$/, "")}/research/drafts/${encodeURIComponent(
      relativePath,
    )}`;
  }
  // Last-resort default — the dashboard on localhost in dev. Keeps the
  // agent-facing contract honoured (`z.string().url()`) without requiring
  // config in test runs.
  return `http://localhost:3000/research/drafts/${encodeURIComponent(relativePath)}`;
}

export const kb_promote_request: ToolHandler<"kb_promote_request"> = async (
  args,
  ctx,
) => {
  const r = await ctx.trpc.research.kbPromoteRequest({
    threadId: ctx.threadId,
    sourceIds: args.source_ids,
    kbSlug: args.kb_slug,
    noteMd: args.note_md,
    createdByThreadId: ctx.threadId,
  });
  return {
    promotion_id: r.id,
    kb_slug: args.kb_slug,
    dashboard_url: dashboardUrl(r.relativePath),
    source_ids: args.source_ids,
  };
};
