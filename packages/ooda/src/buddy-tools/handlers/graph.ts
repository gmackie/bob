// Graph navigation handlers.
//
// Two tools that let an agent walk the citation graph ad-hoc, outside
// of a dive run. Both map 1:1 onto vault-scoped tRPC procedures
// (`research.paperNeighborhood` + `research.paperPath`). Naming shifts
// snake_case (wire / agent) → camelCase (tRPC), and the neighborhood
// response flattens sources + graph_node columns into the agent's
// `PaperSummary` shape.

import type { ToolHandler } from "../handler";

export const graph_neighborhood: ToolHandler<"graph_neighborhood"> = async (
  args,
  ctx,
) => {
  const r = await ctx.trpc.research.paperNeighborhood({
    sourceId: args.source_id,
    kinds: args.kinds,
    limit: args.limit,
  });
  return {
    edges: r.edges.map((e) => ({
      from_source_id: e.fromSourceId,
      to_source_id: e.toSourceId,
      kind: e.kind,
      weight: e.weight,
    })),
    papers: r.papers.map((p) => ({
      source_id: p.sourceId,
      s2_paper_id: p.s2PaperId,
      // The router doesn't hydrate a split title/abstract — title comes
      // from `sources.title`, the rest live behind a richer `paper_get`
      // lookup when the agent wants more than a neighbor card.
      title: p.title,
      abstract: p.body,
      authors: p.author ? [p.author] : [],
      year: p.year,
      venue: null,
      // `influence_score` is the closest proxy to citation_count we
      // have on-vault today; surface it as such so the agent has a
      // relative signal without an extra S2 round-trip.
      citation_count: null,
      doi: p.doi,
    })),
  };
};

export const graph_path: ToolHandler<"graph_path"> = async (args, ctx) => {
  const r = await ctx.trpc.research.paperPath({
    from: args.from,
    to: args.to,
    maxHops: args.max_hops,
  });
  return {
    path: r.path.map((p) => ({
      from_source_id: p.fromSourceId,
      to_source_id: p.toSourceId,
      kind: p.kind,
    })),
    // router returns hops=-1 when no path found; expose 0 in that case
    // so the agent sees "empty path + 0 hops" as a uniform no-route
    // signal (the tool schema declares `hops: int(min=0)` implicitly
    // via the int type).
    hops: r.hops < 0 ? 0 : r.hops,
  };
};
