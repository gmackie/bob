import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";

import {
  and,
  count,
  desc,
  eq,
  inArray,
  or,
} from "@gmacko/ooda/db";
import { graphExploration } from "@gmacko/ooda/db/schema";

import { vaultScopedProcedure } from "../../middleware/vault-scope";
import { GRAPH_EDGE_LIMIT, GRAPH_NODE_LIMIT } from "./_helpers";

export const graphRouter = {
  // --- Graph navigation surface (ad-hoc, non-dive) ---------------------
  //
  // Two procedures that let an agent walk the citation graph outside of a
  // dive run: one-hop neighborhood around a source, and a bounded BFS
  // shortest path between two sources. Both read the vault's graph_edge
  // / graph_node tables directly.

  /**
   * One-hop neighbors of `sourceId` in the vault's graph, grouped by the
   * requested `kinds` (cites / cited_by / similar / recommended).
   *
   * The DB stores directed edges with `kind` in {cites, references,
   * similar_embedding, recommended_by_s2}. We translate agent-facing
   * kinds onto DB kinds + direction:
   *   cites        → outbound edges (from = sourceId) with kind in
   *                   (cites, references)
   *   cited_by     → inbound edges (to = sourceId) with kind in
   *                   (cites, references)
   *   similar      → any edge touching sourceId with kind
   *                   = similar_embedding (treated as undirected)
   *   recommended  → any edge touching sourceId with kind
   *                   = recommended_by_s2 (treated as undirected)
   *
   * `limit` caps the total edges returned across all requested kinds.
   * Neighbor papers are hydrated from `sources` + `graph_node` on the
   * deduped set of counterpart source_ids.
   */
  paperNeighborhood: vaultScopedProcedure
    .input(
      z.object({
        sourceId: z.number().int().positive(),
        kinds: z
          .array(z.enum(["cites", "cited_by", "similar", "recommended"]))
          .min(1)
          .default(["cites", "cited_by"]),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const t = ctx.vaultTables;
      const { sourceId, kinds, limit } = input;

      // Build a per-kind predicate, then OR them into a single WHERE
      // so one limited scan returns the merged set.
      const kindPredicates = [];
      if (kinds.includes("cites")) {
        kindPredicates.push(
          and(
            eq(t.graphEdge.fromSourceId, sourceId),
            inArray(t.graphEdge.kind, ["cites", "references"]),
          ),
        );
      }
      if (kinds.includes("cited_by")) {
        kindPredicates.push(
          and(
            eq(t.graphEdge.toSourceId, sourceId),
            inArray(t.graphEdge.kind, ["cites", "references"]),
          ),
        );
      }
      if (kinds.includes("similar")) {
        kindPredicates.push(
          and(
            eq(t.graphEdge.kind, "similar_embedding"),
            or(
              eq(t.graphEdge.fromSourceId, sourceId),
              eq(t.graphEdge.toSourceId, sourceId),
            ),
          ),
        );
      }
      if (kinds.includes("recommended")) {
        kindPredicates.push(
          and(
            eq(t.graphEdge.kind, "recommended_by_s2"),
            or(
              eq(t.graphEdge.fromSourceId, sourceId),
              eq(t.graphEdge.toSourceId, sourceId),
            ),
          ),
        );
      }

      const edgeRows = await ctx.db
        .select({
          fromSourceId: t.graphEdge.fromSourceId,
          toSourceId: t.graphEdge.toSourceId,
          kind: t.graphEdge.kind,
          weight: t.graphEdge.weight,
        })
        .from(t.graphEdge)
        .where(or(...kindPredicates))
        .limit(limit);

      if (edgeRows.length === 0) {
        return { edges: [], papers: [] };
      }

      // Counterpart source_ids — the one that ISN'T `sourceId` for each
      // edge. For undirected `similar` / `recommended` edges the anchor
      // can be on either end.
      const counterpartIds = new Set<number>();
      for (const e of edgeRows) {
        counterpartIds.add(
          e.fromSourceId === sourceId ? e.toSourceId : e.fromSourceId,
        );
      }

      const paperRows = await ctx.db
        .select({
          sourceId: t.sources.id,
          title: t.sources.title,
          author: t.sources.author,
          body: t.sources.body,
          sourceTs: t.sources.sourceTs,
          doi: t.graphNode.doi,
          s2PaperId: t.graphNode.s2PaperId,
          influenceScore: t.graphNode.influenceScore,
        })
        .from(t.sources)
        .leftJoin(t.graphNode, eq(t.graphNode.sourceId, t.sources.id))
        .where(inArray(t.sources.id, Array.from(counterpartIds)));

      return {
        edges: edgeRows.map((e) => ({
          fromSourceId: e.fromSourceId,
          toSourceId: e.toSourceId,
          kind: e.kind,
          weight: e.weight ?? null,
        })),
        papers: paperRows.map((p) => ({
          sourceId: p.sourceId,
          title: p.title ?? "",
          author: p.author ?? null,
          body: p.body ?? null,
          year: p.sourceTs ? p.sourceTs.getUTCFullYear() : null,
          doi: p.doi ?? null,
          s2PaperId: p.s2PaperId ?? null,
          influenceScore: p.influenceScore ?? null,
        })),
      };
    }),

  /**
   * Bounded BFS shortest path between two source_ids. Walks the vault's
   * graph_edge table up to `maxHops` levels, treating every edge kind
   * as traversable (so a citation path, an embedding-similar hop, and
   * an S2-recommended hop all count). Directionality is ignored for
   * pathfinding — we want "is there a route?", not "does citation flow
   * this way?".
   *
   * Returns the first path found (BFS is optimal for unit-weight) as a
   * list of edges plus the hop count. Empty path + hops=0 when `from`
   * and `to` are identical; empty path + hops=-1 when no route within
   * the bound.
   */
  paperPath: vaultScopedProcedure
    .input(
      z.object({
        from: z.number().int().positive(),
        to: z.number().int().positive(),
        maxHops: z.number().int().min(1).max(5).default(3),
      }),
    )
    .query(async ({ ctx, input }) => {
      const t = ctx.vaultTables;
      const { from, to, maxHops } = input;

      if (from === to) {
        return { path: [], hops: 0 };
      }

      // Frontier = Set<source_id>, predecessor map remembers the
      // edge we arrived via so we can reconstruct the path.
      type PredEdge = {
        viaFrom: number;
        viaTo: number;
        kind: string;
      };
      const predecessor = new Map<number, PredEdge>();
      let frontier = new Set<number>([from]);
      const visited = new Set<number>([from]);

      for (let hop = 0; hop < maxHops; hop++) {
        if (frontier.size === 0) break;
        const frontierArr = Array.from(frontier);

        // Pull every edge touching any node in the current frontier.
        const edges = await ctx.db
          .select({
            fromSourceId: t.graphEdge.fromSourceId,
            toSourceId: t.graphEdge.toSourceId,
            kind: t.graphEdge.kind,
          })
          .from(t.graphEdge)
          .where(
            or(
              inArray(t.graphEdge.fromSourceId, frontierArr),
              inArray(t.graphEdge.toSourceId, frontierArr),
            ),
          );

        const nextFrontier = new Set<number>();
        for (const e of edges) {
          // For each edge, the "other" endpoint is the next candidate.
          // We may arrive at it from either direction — record the
          // first predecessor seen, since BFS guarantees optimality.
          const fromIn = frontier.has(e.fromSourceId);
          const toIn = frontier.has(e.toSourceId);
          const candidate = fromIn ? e.toSourceId : e.fromSourceId;
          if (visited.has(candidate)) continue;

          predecessor.set(candidate, {
            viaFrom: e.fromSourceId,
            viaTo: e.toSourceId,
            kind: e.kind,
          });
          visited.add(candidate);
          nextFrontier.add(candidate);

          if (candidate === to) {
            // Walk predecessors back to `from` to materialize the path.
            const path: Array<{
              fromSourceId: number;
              toSourceId: number;
              kind: string;
            }> = [];
            let cursor = to;
            while (cursor !== from) {
              const pred = predecessor.get(cursor);
              if (!pred) break; // shouldn't happen given BFS invariant
              path.unshift({
                fromSourceId: pred.viaFrom,
                toSourceId: pred.viaTo,
                kind: pred.kind,
              });
              // Move cursor to whichever endpoint ISN'T the current.
              cursor = pred.viaFrom === cursor ? pred.viaTo : pred.viaFrom;
            }
            return { path, hops: path.length };
          }

          // Ignore unused branch — just silencing potential lint
          // about toIn when both endpoints happen to be in frontier.
          void toIn;
        }

        frontier = nextFrontier;
      }

      return { path: [], hops: -1 };
    }),

  graphByThread: vaultScopedProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const t = ctx.vaultTables;

      // Pull edges first: this is what ties us to the thread (via
      // graph_exploration.thread_id → graph_edge.discovered_in).
      const edgeRows = await ctx.db
        .select({
          fromSourceId: t.graphEdge.fromSourceId,
          toSourceId: t.graphEdge.toSourceId,
          kind: t.graphEdge.kind,
          weight: t.graphEdge.weight,
        })
        .from(t.graphEdge)
        .where(
          inArray(
            t.graphEdge.discoveredIn,
            ctx.db
              .select({ id: graphExploration.id })
              .from(graphExploration)
              .where(eq(graphExploration.threadId, input.threadId)),
          ),
        )
        .limit(GRAPH_EDGE_LIMIT);

      if (edgeRows.length === 0) {
        return { nodes: [], edges: [] };
      }

      // Dedupe endpoints across all returned edges — this is the node set.
      const sourceIdSet = new Set<number>();
      for (const e of edgeRows) {
        sourceIdSet.add(e.fromSourceId);
        sourceIdSet.add(e.toSourceId);
      }
      const sourceIds = Array.from(sourceIdSet).slice(0, GRAPH_NODE_LIMIT);

      const nodeRows = await ctx.db
        .select({
          sourceId: t.sources.id,
          title: t.sources.title,
          author: t.sources.author,
          sourceTs: t.sources.sourceTs,
          influenceScore: t.graphNode.influenceScore,
          s2PaperId: t.graphNode.s2PaperId,
        })
        .from(t.sources)
        .leftJoin(t.graphNode, eq(t.graphNode.sourceId, t.sources.id))
        .where(inArray(t.sources.id, sourceIds))
        .limit(GRAPH_NODE_LIMIT);

      return {
        nodes: nodeRows.map((r) => ({
          sourceId: r.sourceId,
          title: r.title ?? null,
          author: r.author ?? null,
          // The dashboard wants a year for node labels. `sources` stores
          // full timestamps; extract the year so the renderer doesn't have
          // to touch dates.
          year:
            r.sourceTs instanceof Date
              ? r.sourceTs.getUTCFullYear()
              : null,
          influenceScore: r.influenceScore ?? null,
          s2PaperId: r.s2PaperId ?? null,
        })),
        edges: edgeRows.map((e) => ({
          fromSourceId: e.fromSourceId,
          toSourceId: e.toSourceId,
          kind: e.kind,
          weight: e.weight ?? null,
        })),
      };
    }),

  /**
   * Vault-wide graph summary: total nodes, total edges, per-edge-kind
   * counts, and total sources. Powers the landing page's GraphStats
   * counters so users see the vault's overall "shape" at a glance.
   */
  graphStats: vaultScopedProcedure
    .input(z.object({}))
    .query(async ({ ctx }) => {
      const t = ctx.vaultTables;

      const [[nodeRow], [edgeRow], [sourceRow], edgeKindRows] =
        await Promise.all([
          ctx.db.select({ c: count() }).from(t.graphNode),
          ctx.db.select({ c: count() }).from(t.graphEdge),
          ctx.db.select({ c: count() }).from(t.sources),
          ctx.db
            .select({
              kind: t.graphEdge.kind,
              c: count(),
            })
            .from(t.graphEdge)
            .groupBy(t.graphEdge.kind),
        ]);

      const edgesByKind: Record<string, number> = {};
      for (const row of edgeKindRows as Array<{ kind: string; c: number }>) {
        edgesByKind[row.kind] = Number(row.c);
      }

      return {
        totalNodes: Number(nodeRow?.c ?? 0),
        totalEdges: Number(edgeRow?.c ?? 0),
        totalSources: Number(sourceRow?.c ?? 0),
        edgesByKind,
      };
    }),
} satisfies RouterRecord;
