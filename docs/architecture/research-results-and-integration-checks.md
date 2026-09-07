# Research persistence and integration verification

Research metadata keeps vault identity, focus, and admission inputs at its root. Terminal workers merge a versioned `meta.result` containing visited IDs, counts, hydrated clusters, errors, and a server completion timestamp. Running-state guards prevent late writers from replacing terminal results. Python and TypeScript validate the same v1 fixture.

Historical flat metadata remains readable with valid vault provenance. Missing or invalid provenance returns HTTP 409 `UNRESOLVED_VAULT_PROVENANCE`. Operators must establish the original vault from authoritative admission records before explicitly repairing metadata; readers never infer identity from colliding source IDs. Workers reject mismatched persisted/requested vaults before graph access.

Status and delivery acquisition apply configured SQL owner eligibility and retain the fail-closed callback. Deterministic pages of 20 use database timestamp precision plus UUID tie breakers. Denied candidates hold no locks. Each candidate is revalidated in its own `FOR UPDATE SKIP LOCKED` transaction; concurrent claimers receive disjoint leases.

## Explicit local PostgreSQL acceptance

Default runs skip PostgreSQL tests without their dedicated URLs; that is not database acceptance. Use disposable databases: suites create/drop their own tables or OODA schema. Never use inherited application `DATABASE_URL` or run the same schema suite concurrently.

Fixture setup requires local PostgreSQL binaries and a free loopback port:

```sh
fixture_dir=$(mktemp -d /tmp/bob-audit-pg.XXXXXX)
initdb -D "$fixture_dir/data" -A trust
pg_ctl -D "$fixture_dir/data" -l "$fixture_dir/server.log" -o "-h 127.0.0.1 -p 55479 -k $fixture_dir" start
createdb -h 127.0.0.1 -p 55479 bob_audit_ooda
createdb -h 127.0.0.1 -p 55479 bob_audit_research
```

From repository root, using the frozen Node 24 / pnpm 10 installation:

```sh
env -u DATABASE_URL OODA_KERNEL_TEST_DATABASE_URL=postgresql://127.0.0.1:55479/bob_audit_ooda OODA_KERNEL_TEST_DISABLE_VECTOR=1 pnpm --filter @gmacko/ooda exec vitest run src/kernel/__tests__/conversation-store.integration.test.ts src/api/clients/__tests__/dive-results.test.ts
```

From `packages/research-backend`, after `uv sync --extra dev --frozen`:

```sh
env -u DATABASE_URL RESEARCH_TEST_REQUIRE_DB=1 RESEARCH_TEST_DATABASE_URL=postgresql+psycopg2://127.0.0.1:55479/bob_audit_research uv run --frozen --no-sync pytest tests/test_dive_persistence_integration.py tests/test_dive_result_contract.py tests/test_dives_api.py tests/test_dive_worker.py -q
```

`RESEARCH_TEST_REQUIRE_DB=1` fails collection without the explicit URL. Verify the OODA integration tests execute rather than skip. Vector checks are disabled for this local fixture. Research network/algorithm boundaries use deterministic doubles; persistence, hydration, transactions, and concurrency use real SQL. This does not prove vector search or live-provider behavior.

After all reviewers finish, stop the fixture with `pg_ctl -D "$fixture_dir/data" -m fast stop`. Keep its directory and server log until review is complete; cleanup is limited to this disposable fixture.
