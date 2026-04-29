// Paper lookup handlers.
//
// `papers_search` and `paper_get` both map onto vault-scoped tRPC
// procedures that read the vault's `sources` (+ `graph_node`) tables
// directly. No sidecar round-trip, no S2 rate-limit burn — the agent
// sees only papers the vault already knows about. Dives are what bring
// new papers in.
//
// The tool schemas carry a few fields the router can't populate today
// (venue, citation_count, tldr) because the vault doesn't persist them.
// Those surface as `null` rather than being dropped, matching the
// schema so `paper_get.result.paper.venue: string | null` stays stable
// as we plumb more data in.

import { ToolHandlerError } from "../handler";
import type { ToolHandler } from "../handler";

export const papers_search: ToolHandler<"papers_search"> = async (
  args,
  ctx,
) => {
  const r = await ctx.trpc.research.papersSearchVault({
    query: args.query,
    ...(args.year_from !== undefined ? { yearFrom: args.year_from } : {}),
    // `min_citations` on the tool schema is a count (0..∞); the vault
    // stores `influence_score` in [0, 1] (fraction of citations marked
    // influential). We can't translate count→score without a live
    // lookup, so V1.5 ignores min_citations and leaves the schema field
    // for when citation_count gets persisted.
    limit: args.limit,
  });
  return {
    papers: r.papers.map((p) => ({
      source_id: p.sourceId,
      s2_paper_id: p.s2PaperId,
      title: p.title,
      abstract: p.body,
      authors: p.author ? [p.author] : [],
      year: p.year,
      venue: null,
      citation_count: null,
      doi: p.doi,
    })),
  };
};

export const paper_get: ToolHandler<"paper_get"> = async (args, ctx) => {
  const r = await ctx.trpc.research.paperById({ id: args.id });
  if (!r.paper) {
    // Match other handlers' error surface — the dispatcher wraps
    // `ToolHandlerError` into a structured `{ok:false, error:{...}}`
    // envelope without surfacing a raw 500.
    throw new ToolHandlerError(
      "NOT_FOUND",
      `paper ${String(args.id)} is not materialized in the vault`,
      { retryable: false },
    );
  }
  const p = r.paper;
  return {
    paper: {
      source_id: p.sourceId,
      s2_paper_id: p.s2PaperId,
      doi: p.doi,
      title: p.title,
      // The vault stores full text in `body` — treat that as the
      // abstract for now. When a future ingest splits abstract vs
      // body text, this handler is the right place to project.
      abstract: p.body,
      tldr: null,
      authors: p.author ? [p.author] : [],
      year: p.year,
      venue: null,
      citation_count: null,
      influential_citation_count: null,
      url: p.url,
      oa_pdf_url: null,
    },
  };
};
