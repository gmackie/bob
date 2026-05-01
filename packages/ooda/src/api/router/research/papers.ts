import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";

import { and, desc, eq, gte, ilike, or } from "@gmacko/ooda/db";

import { SearchPapersResponse } from "../../clients/sidecar-schemas";
import { vaultScopedProcedure } from "../../middleware/vault-scope";

export const papersRouter = {
  // --- Paper lookup surface --------------------------------------------
  //
  // Two read-side procedures that back the `papers_search` and
  // `paper_get` buddy tools. Both scan the vault's `sources` table
  // (optionally joined to `graph_node` for citation / S2 metadata) so
  // the agent can find + inspect local papers without hitting S2 live.
  // No sidecar round-trip, no rate-limiter budget burn — everything
  // returns from Postgres.

  /**
   * Substring search on the vault's `sources` table. Case-insensitive
   * ILIKE on title + body, optional year floor (source_ts >= Jan 1 of
   * year), optional min influence_score (best local proxy for citation
   * count until we start persisting S2's count), capped by `limit`.
   *
   * Venue and minCitations-proper aren't surfaced — the vault doesn't
   * store venue today, and citation_count on graph_node can be NULL
   * when the paper was ingested via OpenAlex (which doesn't expose
   * citation counts on the default projection). The agent schema
   * keeps those fields so we can wire them in when the data lands.
   */
  papersSearchVault: vaultScopedProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/papers/search", tags: ["research.papers"] } })
    .input(
      z.object({
        query: z.string().min(1),
        yearFrom: z.number().int().min(1900).max(2100).optional(),
        minInfluence: z.number().min(0).max(1).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const t = ctx.vaultTables;
      const { query, yearFrom, minInfluence, limit } = input;

      // Try semantic search via research-backend
      const apiUrl = process.env.RESEARCH_API_URL;
      if (apiUrl) {
        try {
          const params = new URLSearchParams({
            query,
            limit: String(limit),
            schema: ctx.vaultSchema,
          });
          if (yearFrom !== undefined) params.set("year_from", String(yearFrom));
          if (minInfluence !== undefined)
            params.set("min_influence", String(minInfluence));

          const res = await fetch(
            `${apiUrl.replace(/\/+$/, "")}/api/search/papers?${params}`,
          );
          if (res.ok) {
            const data = SearchPapersResponse.parse(await res.json());
            if (!data.fallback) {
              return {
                papers: data.papers.map((p) => ({
                  sourceId: p.source_id,
                  title: p.title ?? "",
                  author: p.author ?? null,
                  body: null,
                  year: p.source_ts
                    ? new Date(p.source_ts).getUTCFullYear()
                    : null,
                  doi: p.doi ?? null,
                  s2PaperId: p.s2_paper_id ?? null,
                  influenceScore: p.influence_score ?? null,
                  score: p.score,
                })),
              };
            }
          }
        } catch {
          // Fall through to ILIKE
        }
      }

      // Fallback: ILIKE text search
      const pattern = `%${query}%`;
      const conditions = [
        or(ilike(t.sources.title, pattern), ilike(t.sources.body, pattern)),
      ];
      if (yearFrom !== undefined) {
        conditions.push(gte(t.sources.sourceTs, new Date(Date.UTC(yearFrom, 0, 1))));
      }
      if (minInfluence !== undefined) {
        conditions.push(gte(t.graphNode.influenceScore, minInfluence));
      }

      const rows = await ctx.db
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
        .where(and(...conditions))
        .orderBy(desc(t.graphNode.influenceScore), desc(t.sources.sourceTs))
        .limit(limit);

      return {
        papers: rows.map((r) => ({
          sourceId: r.sourceId,
          title: r.title ?? "",
          author: r.author ?? null,
          body: r.body ?? null,
          year: r.sourceTs ? r.sourceTs.getUTCFullYear() : null,
          doi: r.doi ?? null,
          s2PaperId: r.s2PaperId ?? null,
          influenceScore: r.influenceScore ?? null,
        })),
      };
    }),

  /**
   * Look up a single paper by whichever identifier the agent happens to
   * have: local numeric `source_id`, DOI, S2 paperId, or OpenAlex id.
   * Returns `null` when the paper isn't in the vault yet so the tool
   * handler can surface a "not materialized" signal instead of an
   * error.
   *
   * Dispatch on the input shape:
   *   - number        → sources.id
   *   - "10.*"        → graph_node.doi
   *   - 40-char hex   → graph_node.s2_paper_id
   *   - "W" + digits  → graph_node.openalex_id
   *   - otherwise     → fallback to sources.external_id
   */
  paperById: vaultScopedProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/papers/get", tags: ["research.papers"] } })
    .input(
      z.object({
        id: z.string().min(1),
      }),
    )
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const t = ctx.vaultTables;

      // Build the right join target based on which field the id looks
      // like. Picking ONE condition keeps the query plan small vs
      // OR-ing across four columns on every lookup.
      // Note: id is always a string (OpenAPI query param); detect
      // numeric ids by regex and coerce for the sources.id lookup.
      let whereExpr;
      const s = input.id;
      if (/^\d+$/.test(s)) {
        whereExpr = eq(t.sources.id, Number(s));
      } else {
        if (/^10\./.test(s)) {
          whereExpr = eq(t.graphNode.doi, s);
        } else if (/^[0-9a-f]{40}$/i.test(s)) {
          whereExpr = eq(t.graphNode.s2PaperId, s);
        } else if (/^W\d+$/.test(s)) {
          whereExpr = eq(t.graphNode.openalexId, s);
        } else {
          whereExpr = eq(t.sources.externalId, s);
        }
      }

      const rows = await ctx.db
        .select({
          sourceId: t.sources.id,
          title: t.sources.title,
          author: t.sources.author,
          body: t.sources.body,
          url: t.sources.url,
          sourceTs: t.sources.sourceTs,
          externalId: t.sources.externalId,
          kind: t.sources.kind,
          doi: t.graphNode.doi,
          s2PaperId: t.graphNode.s2PaperId,
          openalexId: t.graphNode.openalexId,
          influenceScore: t.graphNode.influenceScore,
        })
        .from(t.sources)
        .leftJoin(t.graphNode, eq(t.graphNode.sourceId, t.sources.id))
        .where(whereExpr)
        .limit(1);

      const r = rows[0];
      if (!r) return { paper: null };

      return {
        paper: {
          sourceId: r.sourceId,
          title: r.title ?? "",
          author: r.author ?? null,
          body: r.body ?? null,
          url: r.url ?? null,
          year: r.sourceTs ? r.sourceTs.getUTCFullYear() : null,
          externalId: r.externalId,
          kind: r.kind,
          doi: r.doi ?? null,
          s2PaperId: r.s2PaperId ?? null,
          openalexId: r.openalexId ?? null,
          influenceScore: r.influenceScore ?? null,
        },
      };
    }),
} satisfies RouterRecord;
