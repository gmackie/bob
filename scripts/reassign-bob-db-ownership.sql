-- HOW TO APPLY (needs the `postgres` superuser on hetzner-master; the `bob`
-- role cannot reassign objects it does not own). base64 the file so it passes
-- cleanly through forge's outer single-quote + psql's double-quote layers:
--
--   FG="$HOME/.forgegraph/bin/fg"
--   B64=$(base64 < scripts/reassign-bob-db-ownership.sql | tr -d '\n')
--   "$FG" node exec "echo $B64 | base64 -d | sudo -u postgres psql -d bob -v ON_ERROR_STOP=1" --node hetzner-master
--
-- Idempotent: re-running only touches objects still owned by `postgres`, so a
-- clean DB prints "Reassigned 0 tables and 0 enums".
--
-- One-time systemic ownership reconciliation for the bob database.
-- Reassigns every public table + app enum still owned by the `postgres`
-- superuser to the `bob` app/migration role, so forward drizzle migrations
-- (run as `bob`) can ALTER pre-existing tables and ALTER TYPE ... ADD VALUE
-- without hitting 42501 must-be-owner / permission-denied.
--
-- Scoped deliberately: only objects currently owned by `postgres` are touched
-- (idempotent — safe to re-run), and extension-member objects (pgvector /
-- plpgsql functions + types) are LEFT untouched. Table reassignment carries
-- the table's indexes, TOAST table, and implicit row composite type with it.
-- Runs as a single DO block => one implicit transaction => all-or-nothing.
DO $reassign$
DECLARE
  r record;
  n_tables int := 0;
  n_enums  int := 0;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tableowner = 'postgres'
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO bob', r.tablename);
    n_tables := n_tables + 1;
  END LOOP;

  FOR r IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace ns ON ns.oid = t.typnamespace
    WHERE ns.nspname = 'public'
      AND t.typtype = 'e'
      AND pg_get_userbyid(t.typowner) = 'postgres'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO bob', r.typname);
    n_enums := n_enums + 1;
  END LOOP;

  RAISE NOTICE 'Reassigned % tables and % enums to bob', n_tables, n_enums;
END
$reassign$;
