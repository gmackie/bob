/**
 * Zod response schemas for the Python research-backend sidecar.
 *
 * These mirror the JSON shapes returned by the FastAPI routes in
 * `packages/research-backend/src/research_backend/routes/`. Validating
 * sidecar responses at runtime catches drift between the Python and
 * TypeScript sides before it reaches callers.
 *
 * Key convention: field names match the Python JSON output (snake_case).
 * Sub-routers normalize to camelCase after parsing when needed.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// GET /api/search/thread-memory  (routes/search.py)
// ---------------------------------------------------------------------------

export const SearchThreadMemoryResponse = z.object({
  threads: z.array(
    z.object({
      thread_id: z.string(),
      title: z.string().nullable(),
      slug: z.string().nullable(),
      rolling_summary_md: z.string().nullable(),
      topic_fingerprint: z.array(z.string()).nullable(),
      updated_at: z.string().nullable(),
      score: z.number(),
    }),
  ),
  fallback: z.boolean(),
});

export type SearchThreadMemoryResponse = z.infer<
  typeof SearchThreadMemoryResponse
>;

// ---------------------------------------------------------------------------
// GET /api/search/papers  (routes/search.py)
// ---------------------------------------------------------------------------

export const SearchPapersResponse = z.object({
  papers: z.array(
    z.object({
      source_id: z.number(),
      title: z.string().nullable(),
      kind: z.string().nullable(),
      url: z.string().nullable(),
      author: z.string().nullable(),
      source_ts: z.string().nullable(),
      s2_paper_id: z.string().nullable(),
      doi: z.string().nullable(),
      influence_score: z.number().nullable(),
      score: z.number(),
    }),
  ),
  fallback: z.boolean(),
});

export type SearchPapersResponse = z.infer<typeof SearchPapersResponse>;

// ---------------------------------------------------------------------------
// GET /api/search/notes  (routes/search.py)
// ---------------------------------------------------------------------------

export const SearchNotesResponse = z.object({
  notes: z.array(
    z.object({
      note_index_id: z.string(),
      thread_id: z.string(),
      note_id: z.string(),
      title: z.string().nullable(),
      kind: z.string().nullable(),
      thread_title: z.string().nullable(),
      thread_slug: z.string().nullable(),
      score: z.number(),
    }),
  ),
  fallback: z.boolean(),
});

export type SearchNotesResponse = z.infer<typeof SearchNotesResponse>;

// ---------------------------------------------------------------------------
// GET /api/health  (routes/core.py)
// ---------------------------------------------------------------------------

export const HealthResponse = z.object({
  status: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;

// ---------------------------------------------------------------------------
// GET /api/embeddings/stats  (routes/embeddings.py)
// ---------------------------------------------------------------------------

export const EmbeddingStatsResponse = z.object({
  total_sources: z.number(),
  embedded_sources: z.number(),
  unembedded_sources: z.number(),
  model: z.string(),
  topic_count: z.number(),
  assigned_sources: z.number(),
});

export type EmbeddingStatsResponse = z.infer<typeof EmbeddingStatsResponse>;

// ---------------------------------------------------------------------------
// POST /api/embeddings/embed  (routes/embeddings.py)
// ---------------------------------------------------------------------------

export const EmbedResponse = z.object({
  embedded_count: z.number(),
  model: z.string(),
  message: z.string(),
});

export type EmbedResponse = z.infer<typeof EmbedResponse>;

// ---------------------------------------------------------------------------
// POST /api/embeddings/cluster  (routes/embeddings.py)
// ---------------------------------------------------------------------------

export const ClusterResponse = z.object({
  topic_count: z.number(),
  message: z.string(),
});

export type ClusterResponse = z.infer<typeof ClusterResponse>;

// ---------------------------------------------------------------------------
// GET /api/kb  (routes/kb.py — list)
// ---------------------------------------------------------------------------

export const KBSummary = z.object({
  name: z.string(),
  description: z.string(),
  source_count: z.number(),
  article_count: z.number(),
  categories: z.array(z.string()),
});

export type KBSummary = z.infer<typeof KBSummary>;

export const ListKBsResponse = z.array(KBSummary);
export type ListKBsResponse = z.infer<typeof ListKBsResponse>;

// ---------------------------------------------------------------------------
// POST /api/kb/{name}/compile  (routes/kb.py)
// ---------------------------------------------------------------------------

export const CompileKBResponse = z.object({
  articles_written: z.number(),
  message: z.string(),
});

export type CompileKBResponse = z.infer<typeof CompileKBResponse>;

// ---------------------------------------------------------------------------
// POST /api/extraction/note  (routes/extraction.py)
// ---------------------------------------------------------------------------

export const ExtractionResponse = z.object({
  note_index_id: z.string(),
  entities_extracted: z.number(),
  embedded: z.boolean(),
});

export type ExtractionResponse = z.infer<typeof ExtractionResponse>;
