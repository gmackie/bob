-- Extend per-vault source_kind enum to include 'paper-s2'.
--
-- Hand-rolled migration applied AFTER drizzle-kit's generated migrations.
-- Apply via: `pnpm --filter @ooda/db migrate:custom` (see src/migrate-custom.ts).
--
-- Why hand-rolled: `source_kind` is declared inside the `createVaultTaxonomyTables`
-- factory closure in `packages/db/src/schema/vault-taxonomy.ts`. drizzle-kit's
-- snapshot inspector does not surface enums defined inside factory closures
-- (the snapshot for migration 0003 does not list `source_kind` at all), so
-- `drizzle-kit generate` does not detect value additions. This file bridges
-- the gap by conditionally adding the new value to each vault's enum.
--
-- Transaction caveat: the migrate-custom runner wraps each .sql file in a
-- transaction. `ALTER TYPE ... ADD VALUE` inside a transaction block has
-- limited scope in Postgres (PG 12+ relaxes the rule somewhat), so we use
-- a PL/pgSQL DO block that first checks `pg_enum` and only runs the ALTER
-- when the value is absent. The check + ALTER still runs transactionally
-- per-file which is fine because we're not using the new value in the same
-- transaction.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'source_kind'
      AND n.nspname = 'personal_vault'
      AND e.enumlabel = 'paper-s2'
  ) THEN
    ALTER TYPE "personal_vault"."source_kind" ADD VALUE 'paper-s2';
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
      AND e.enumlabel = 'paper-s2'
  ) THEN
    ALTER TYPE "research_vault"."source_kind" ADD VALUE 'paper-s2';
  END IF;
END $$;
