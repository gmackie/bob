-- Extend per-vault source_kind enum to include 'paper-openalex'.
--
-- Hand-rolled migration applied AFTER drizzle-kit's generated migrations.
-- Same pattern as 002_source_kind_paper_s2.sql — see the header there for
-- why drizzle-kit's snapshot inspector misses values on enums declared
-- inside the createVaultTaxonomyTables factory closure.
--
-- Why this exists: standing_interests previously stored OpenAlex works in
-- `sources` under kind='paper-s2', which is a lie — downstream clustering
-- calls s2.embedding(openalex_id) and gets 404s, silently breaking
-- clustering for every inbox-sourced paper. This value lets the
-- OpenAlex ingest path declare itself honestly; clustering + graph-node
-- writers can then check kind and skip the S2-only paths for OpenAlex
-- rows.
--
-- Idempotent: the pg_enum existence check makes re-applying this file a
-- no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'source_kind'
      AND n.nspname = 'personal_vault'
      AND e.enumlabel = 'paper-openalex'
  ) THEN
    ALTER TYPE "personal_vault"."source_kind" ADD VALUE 'paper-openalex';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'source_kind'
      AND n.nspname = 'research_vault'
      AND e.enumlabel = 'paper-openalex'
  ) THEN
    ALTER TYPE "research_vault"."source_kind" ADD VALUE 'paper-openalex';
  END IF;
END $$;
