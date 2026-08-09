# OODA Personal OS production bootstrap

This runbook is the only supported path for adding the OODA Personal OS schema
to the shared Bob production database. Do **not** run the generic Drizzle
migrator against that database: research migrations `0000` through `0005` are
already represented by live objects but were not recorded in a Drizzle journal.

The guarded bootstrap:

- verifies PostgreSQL, pgvector, the Bob application role, and eight concrete
  research-schema landmarks;
- records migrations `0000` through `0005` as adopted without replaying them;
- applies only migrations `0006` and later, one transaction at a time;
- records every checked-in SQL SHA-256 in `ooda_migrations.migrations`;
- holds a database advisory lock throughout the operation;
- refuses ledger gaps, code-hash drift, unmanaged OODA schemas, and partial
  schema claims;
- grants the configured application role access to OODA and the two vault
  schemas, including forward default privileges.

## Preflight and backup

Use the exact release checkout that will be deployed. Obtain a fresh custom
format database backup and calculate its SHA-256. Restore that backup into the
same PostgreSQL major version and a compatible pgvector image before touching
production.

Run the read-only inspection first:

```sh
DATABASE_URL="$PRODUCTION_DATABASE_URL" \
  pnpm --filter @gmacko/ooda db:bootstrap:personal-os-production -- \
  --app-role=bob
```

The report must say `mode: fresh` for the first production application, list
`0000` through `0005` only under `baselineAdoptions`, list `0006` and later
under `pending`, and contain no problems. Copy the database-specific
`expectedConfirmation` from this report.

## Apply and verify

The mutation is deliberately guarded by both the copied confirmation and the
fresh backup digest:

```sh
DATABASE_URL="$PRODUCTION_DATABASE_URL" \
  pnpm --filter @gmacko/ooda db:bootstrap:personal-os-production -- \
  --apply \
  --app-role=bob \
  --confirm="$EXPECTED_CONFIRMATION" \
  --backup-sha256="$FRESH_BACKUP_SHA256"
```

Then backfill legacy research threads twice and verify the second run is
identical:

```sh
DATABASE_URL="$PRODUCTION_DATABASE_URL" \
  pnpm --filter @gmacko/ooda db:backfill:personal-os-v1
DATABASE_URL="$PRODUCTION_DATABASE_URL" \
  pnpm --filter @gmacko/ooda db:backfill:personal-os-v1
DATABASE_URL="$PRODUCTION_DATABASE_URL" \
  pnpm --filter @gmacko/ooda db:verify:personal-os-v1
```

Do not deploy the OODA edge or the new runner until all checks are true and the
application role can read and write every OODA table. Run the bootstrap command
again without `--apply`; it must report `mode: complete`, 20 applied migrations,
and no pending work.

## Rehearsal evidence — 2026-08-09

The procedure was exercised against the verified Phase 0 Bob backup
`6728d1ad55247c51e4e2b9a43cdb7a3e943d739ed6e42356f1b37606620b7a7f`
in an isolated PostgreSQL 17.10/pgvector 0.8.6 container.

- The read-only plan adopted exactly six baseline migrations and selected
  exactly fourteen additive migrations.
- The first apply recorded all 20 hashes; an immediate second apply performed
  no schema work and remained complete.
- The rehearsal exposed and fixed a missing deterministic
  `agent_job_events.idempotency_key` in the legacy backfill.
- Two complete backfill runs produced 38 conversations, 38 branches, 63 jobs,
  356 conversation events, and 356 job events each time.
- Transcript hash `827bea056f0f37dddd5c16ee375b3c9b` and last-sequence hash
  `29b48319cd5e3f27a16e2c5520cba2c8` matched source and destination.
- The `bob` role had schema usage and full DML privileges on all 20 OODA tables.

## Rollback boundary

Before any canonical Personal OS turns are accepted, the preferred rollback is
to stop the new edge/runner versions and restore the fresh full backup. A
schema-only rollback is acceptable only before writes: apply the checked-in
`0019` down migration, then drop `ooda` and `ooda_migrations`. Once new turns or
approved deliveries exist, never drop the schema; restore/reconcile through a
reviewed incident plan so accepted events are not lost.
