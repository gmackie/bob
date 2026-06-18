import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";

import { and, count, desc, eq } from "@gmacko/ooda/db";
import { noteEntity, noteIndex, researchThread } from "@gmacko/ooda/db/schema";

import { SearchNotesResponse } from "../../clients/sidecar-schemas";
import { vaultScopedProcedure } from "../../middleware/vault-scope";

export const entitiesRouter = {
  // --- Cross-thread entity retrieval ------------------------------------
  //
  // Three procedures that expose the `note_index` + `note_entity` tables
  // populated by the extraction pipeline (Task 2/4). `notesByEntity`
  // finds notes mentioning a named entity, `relatedNotes` delegates to
  // the research-backend's semantic search endpoint, and `entityIndex`
  // returns aggregated entity counts for browsing.

  /**
   * Find notes that mention a specific entity. Optionally filter by
   * entity type. Results include the thread context (title, slug) so
   * the dashboard can link back to the originating thread.
   */
  notesByEntity: vaultScopedProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/entities/notes", tags: ["research.entities"] } })
    .input(
      z.object({
        entityName: z.string().min(1),
        entityType: z
          .enum([
            "person",
            "organization",
            "method",
            "dataset",
            "tool",
            "concept",
            "claim",
          ])
          .optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const conditions = [eq(noteEntity.name, input.entityName)];
      if (input.entityType) {
        conditions.push(eq(noteEntity.entityType, input.entityType));
      }

      const rows = await ctx.db
        .select({
          noteIndexId: noteEntity.noteIndexId,
          threadId: noteEntity.threadId,
          entityName: noteEntity.name,
          entityType: noteEntity.entityType,
          salience: noteEntity.salience,
          noteId: noteIndex.noteId,
          noteTitle: noteIndex.title,
          noteKind: noteIndex.kind,
          threadTitle: researchThread.title,
          threadSlug: researchThread.slug,
        })
        .from(noteEntity)
        .innerJoin(noteIndex, eq(noteIndex.id, noteEntity.noteIndexId))
        .innerJoin(researchThread, eq(researchThread.id, noteEntity.threadId))
        .where(and(...conditions))
        .orderBy(desc(noteEntity.salience))
        .limit(input.limit);

      return {
        items: rows.map((r) => ({
          noteIndexId: r.noteIndexId,
          threadId: r.threadId,
          threadTitle: r.threadTitle ?? null,
          threadSlug: r.threadSlug ?? null,
          noteId: r.noteId,
          noteTitle: r.noteTitle,
          noteKind: r.noteKind,
          entityName: r.entityName,
          entityType: r.entityType,
          salience: r.salience,
        })),
      };
    }),

  /**
   * Semantic search for notes related to a given note. Delegates to the
   * research-backend sidecar's `GET /api/search/notes` endpoint. Returns
   * an empty list when the sidecar is unreachable or unconfigured.
   */
  relatedNotes: vaultScopedProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/entities/related", tags: ["research.entities"] } })
    .input(
      z.object({
        noteId: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(10),
      }),
    )
    .output(z.any())
    .query(async ({ input }) => {
      const apiUrl = process.env.RESEARCH_API_URL;
      if (!apiUrl) {
        return { notes: [] };
      }

      try {
        const params = new URLSearchParams({
          query: input.noteId,
          limit: String(input.limit),
        });
        const res = await fetch(
          `${apiUrl.replace(/\/+$/, "")}/api/search/notes?${params}`,
        );
        if (res.ok) {
          const data = SearchNotesResponse.parse(await res.json());
          return {
            notes: data.notes.map((n) => ({
              noteIndexId: n.note_index_id,
              threadId: n.thread_id,
              noteId: n.note_id,
              title: n.title ?? "",
              kind: n.kind ?? "",
              threadTitle: n.thread_title ?? "",
              threadSlug: n.thread_slug ?? "",
              score: n.score,
            })),
          };
        }
      } catch {
        // sidecar unreachable
      }
      return { notes: [] };
    }),

  /**
   * Aggregated entity index: unique (name, type) pairs with their note
   * count. Used by the dashboard to render an entity browser / tag cloud.
   * Optionally filter to a single entity type.
   */
  entityIndex: vaultScopedProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/entities", tags: ["research.entities"] } })
    .input(
      z.object({
        entityType: z
          .enum([
            "person",
            "organization",
            "method",
            "dataset",
            "tool",
            "concept",
            "claim",
          ])
          .optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const conditions = [];
      if (input.entityType) {
        conditions.push(eq(noteEntity.entityType, input.entityType));
      }

      const rows = await ctx.db
        .select({
          name: noteEntity.name,
          entityType: noteEntity.entityType,
          noteCount: count(),
        })
        .from(noteEntity)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(noteEntity.name, noteEntity.entityType)
        .orderBy(desc(count()))
        .limit(input.limit);

      return {
        items: rows.map((r) => ({
          name: r.name,
          entityType: r.entityType,
          noteCount: Number(r.noteCount),
        })),
      };
    }),
} satisfies RouterRecord;
