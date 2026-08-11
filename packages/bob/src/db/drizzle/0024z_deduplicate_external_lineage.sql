-- Prepare existing work-item lineage for the global provider/id uniqueness
-- guard added by 0025. Preserve every work item: only the non-canonical copy
-- loses its live external claim, and the original claim remains inspectable in
-- source_metadata.
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "source_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;

WITH ranked_lineage AS (
  SELECT
    "id",
    "external_provider",
    "external_id",
    "external_url",
    row_number() OVER (
      PARTITION BY "external_provider", "external_id"
      ORDER BY
        CASE
          WHEN "status" IN (
            'draft', 'backlog', 'todo', 'planned', 'ready', 'in_progress',
            'in_review', 'blocked'
          ) THEN 0
          ELSE 1
        END,
        "updated_at" DESC NULLS LAST,
        "created_at" DESC NULLS LAST,
        "id" DESC
    ) AS lineage_rank
  FROM "work_items"
  WHERE "external_provider" IS NOT NULL
    AND "external_id" IS NOT NULL
), detached_lineage AS (
  UPDATE "work_items" AS item
  SET
    "source_metadata" = coalesce(item."source_metadata", '{}'::jsonb)
      || jsonb_build_object(
        'deduplicatedExternalLineage',
        jsonb_strip_nulls(jsonb_build_object(
          'provider', ranked."external_provider",
          'id', ranked."external_id",
          'url', ranked."external_url"
        ))
      ),
    "external_provider" = NULL,
    "external_id" = NULL,
    "external_url" = NULL
  FROM ranked_lineage AS ranked
  WHERE item."id" = ranked."id"
    AND ranked.lineage_rank > 1
  RETURNING item."id"
)
SELECT count(*) AS detached_external_lineage_claims
FROM detached_lineage;

-- The migration runner commits each file independently. Install the guard in
-- this same transaction so a live importer cannot recreate a duplicate in the
-- gap before 0025 runs (0025 repeats this with IF NOT EXISTS).
CREATE UNIQUE INDEX IF NOT EXISTS "work_items_external_provider_id_uidx"
  ON "work_items" ("external_provider", "external_id")
  WHERE "external_provider" IS NOT NULL AND "external_id" IS NOT NULL;
