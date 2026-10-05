-- Align existing identity foreign keys with the canonical plural auth schema.
-- The migration runner wraps this file in one transaction. ADD CONSTRAINT
-- validates existing references, so a missing canonical identity fails closed
-- and rolls every preceding constraint replacement back; no user rows change.
DO $migration$
DECLARE
  legacy_oid oid := to_regclass('public."user"');
  canonical_oid oid := to_regclass('public.users');
  fk record;
  old_target text;
  definition text;
  missing bigint;
  source_column text;
  target_column text;
BEGIN
  IF canonical_oid IS NULL THEN
    RAISE EXCEPTION 'Canonical auth users table is required';
  END IF;
  IF legacy_oid IS NULL THEN
    RETURN;
  END IF;

  LOCK TABLE public."user", public.users IN SHARE ROW EXCLUSIVE MODE;

  -- Legacy identities must already exist in the canonical table. Abort rather
  -- than copying or altering any personal account or previously unvalidated FK.
  SELECT count(*) INTO missing FROM public."user" old
  LEFT JOIN public.users canonical ON canonical.id = old.id
  WHERE canonical.id IS NULL;
  IF missing <> 0 THEN
    RAISE EXCEPTION 'Legacy auth identities are missing canonical counterparts';
  END IF;

  FOR fk IN
    SELECT c.conname, c.conrelid::regclass AS relation,
           c.conkey, c.confkey, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    WHERE c.contype = 'f' AND c.confrelid = legacy_oid
    ORDER BY c.conrelid, c.conname
  LOOP
    IF array_length(fk.conkey, 1) <> 1 OR array_length(fk.confkey, 1) <> 1 THEN
      RAISE EXCEPTION 'Unexpected composite legacy auth constraint %', fk.conname;
    END IF;
    SELECT attname INTO source_column FROM pg_attribute
    WHERE attrelid = fk.relation AND attnum = fk.conkey[1];
    SELECT attname INTO target_column FROM pg_attribute
    WHERE attrelid = legacy_oid AND attnum = fk.confkey[1];
    IF target_column <> 'id' THEN
      RAISE EXCEPTION 'Unexpected legacy auth target column for constraint %', fk.conname;
    END IF;
    -- Explicitly validate NOT VALID constraints too, without changing their
    -- validation flag or any data when replacing the target.
    EXECUTE format('SELECT count(*) FROM %s source LEFT JOIN public.users target ON target.id = source.%I WHERE source.%I IS NOT NULL AND target.id IS NULL',
                   fk.relation, source_column, source_column) INTO missing;
    IF missing <> 0 THEN
      RAISE EXCEPTION 'Missing canonical references for constraint %', fk.conname;
    END IF;
    -- Keep column order, match/action modes, deferrability, and validation
    -- status exactly as PostgreSQL describes the existing constraint.
    old_target := 'REFERENCES ' || legacy_oid::regclass::text || '(';
    definition := replace(fk.definition, old_target,
                          'REFERENCES public.users(');
    IF definition = fk.definition THEN
      RAISE EXCEPTION 'Cannot identify legacy auth target for constraint %', fk.conname;
    END IF;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.relation, fk.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',
                   fk.relation, fk.conname, definition);
  END LOOP;
END
$migration$;
