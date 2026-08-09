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

On Linux, metered jobs additionally require Bubblewrap to create unprivileged
user namespaces. Prove this as the runner account before promotion:

```sh
sudo -u bob /usr/bin/bwrap \
  --die-with-parent \
  --ro-bind /usr /usr \
  --proc /proc \
  --dev /dev \
  -- /usr/bin/true
```

Ubuntu hosts with `kernel.apparmor_restrict_unprivileged_userns=1` deny that
operation until `/usr/bin/bwrap` receives an explicit AppArmor `userns` grant.
The checked-in installer uses the same narrow grant as Ubuntu's standard
rootless-tool profiles, refuses to overwrite a different profile, validates it
before loading, and requires a host-specific confirmation:

```sh
sudo apps/ooda-runner/ops/install-bwrap-apparmor.sh \
  --runner-user=bob \
  --confirm="ENABLE-OODA-BWRAP:$(hostname -s)"
```

This is a separate just-in-time host mutation. Do not fold it into an
unattended code deploy.

After the reviewed branch has merged and the exact master SHA is green, promote
the trusted runner without touching its live environment or systemd unit:

```sh
apps/ooda-runner/deploy-hetzner-bob.sh \
  --sha="$MERGED_MASTER_SHA" \
  --confirm="DEPLOY-OODA-RUNNER:$MERGED_MASTER_SHA"
```

The script rejects non-master SHAs, tracked live changes, and non-fast-forward
updates. Untracked operator environment/backup files are preserved. It installs
from the frozen lockfile and runs runner typecheck, tests, and build on the host
before restarting the service.

The OODA edge has a separate master-branch deployment job. It always builds but
will not deploy unless the Forgejo repository secret
`OODA_EDGE_DEPLOY_ENABLED` is exactly `true`. Enable it only after the database
bootstrap/backfill verification and runner promotion pass; disable it again as
the immediate code-deploy kill switch. Cloudflare secrets remain in the worker
and are never copied into the repository or client bundle.

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

A second rehearsal used a fresh production backup at
`~/Library/Application Support/OODA/backups/production-20260809/bob-pre-ooda-personal-os.dump`
(143 MB; SHA-256
`f43109d2c270fab32f6e24e3b3cad24ef459479975af8768d032199913870e80`).
The PostgreSQL 17/pgvector 0.8.6 restore matched the live source counts exactly:
5,180 `agent_runs`, 2,592 `chat_conversations`, 38 `research_thread` rows,
63 `runner_session` rows, 356 `session_event` rows, 269,753 `session_events`,
461 `research_vault.sources`, 116 `research_vault.retrieval_unit` rows, and
546 `work_items`. The full guarded bootstrap, two legacy backfills, transcript
and sequence hashes, and application-role DML checks passed again. The
disposable restore environment was removed after verification.

## Rollback boundary

Before any canonical Personal OS turns are accepted, the preferred rollback is
to stop the new edge/runner versions and restore the fresh full backup. A
schema-only rollback is acceptable only before writes: apply the checked-in
`0019` down migration, then drop `ooda` and `ooda_migrations`. Once new turns or
approved deliveries exist, never drop the schema; restore/reconcile through a
reviewed incident plan so accepted events are not lost.
