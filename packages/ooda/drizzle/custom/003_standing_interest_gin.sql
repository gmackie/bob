-- GIN index on standing_interest.query_terms (text[]) for both vault schemas.
--
-- coldThreadUpdatesByThread (router/research.ts) uses the array-overlap `&&`
-- operator between thread_memory.topic_fingerprint and
-- standing_interest.query_terms. Without a GIN index, Postgres can't index-
-- scan the `&&` predicate and falls back to a row-by-row sequential scan,
-- which collapses to O(total vault interests) per dashboard page load once
-- vault-global interests dominate.
--
-- Idempotent: uses IF NOT EXISTS so re-running this migration after the first
-- apply is a no-op.

CREATE INDEX IF NOT EXISTS standing_interest_query_terms_gin_idx
  ON research_vault.standing_interest USING gin (query_terms);

CREATE INDEX IF NOT EXISTS standing_interest_query_terms_gin_idx
  ON personal_vault.standing_interest USING gin (query_terms);
