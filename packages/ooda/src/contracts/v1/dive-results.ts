import { z } from "zod";

const cluster = z
  .object({
    cluster_id: z.number().int(),
    size: z.number().int().nonnegative(),
    label_terms: z.array(z.string()).optional(),
    paper_source_ids: z.array(z.number().int()).optional(),
    top_papers: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

/** Matches research_backend.dive.results; golden fixture is shared across runtimes. */
export const DiveStoredResultV1Schema = z
  .object({
    version: z.literal("v1"),
    visited_source_ids: z.array(z.number().int()),
    edge_count: z.number().int().nonnegative(),
    n_clusters: z.number().int().nonnegative(),
    noise_count: z.number().int().nonnegative(),
    cluster_summary: z
      .object({
        n_papers: z.number().int().nonnegative(),
        n_clusters: z.number().int().nonnegative(),
        noise_count: z.number().int().nonnegative(),
        clusters: z.array(cluster),
      })
      .passthrough(),
    errors: z.array(z.record(z.string(), z.unknown())),
    finished_at: z.string().datetime({ offset: true }),
  })
  .passthrough();

export const DiveResultsResponseSchema = z
  .object({
    exploration_id: z.string().uuid(),
    status: z.string(),
    summary_md: z.string().nullable(),
    papers: z.array(z.record(z.string(), z.unknown())),
    clusters: z.array(z.record(z.string(), z.unknown())),
    edge_counts_by_kind: z.record(z.string(), z.number().int().nonnegative()),
    // Old sidecars remain readable; a present versioned result is always validated.
    vault_schema: z
      .enum(["research_vault", "personal_vault"])
      .nullable()
      .optional(),
    result: DiveStoredResultV1Schema.nullable().optional(),
  })
  .passthrough();
