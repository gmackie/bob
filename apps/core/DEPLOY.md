# Reference app runtime and verification

This app supports the explicit procedure inventory in `src/server/handlers/surface.ts`, rather than the entire shared Bob/OODA RPC inventory. It includes authentication identity/memberships/API keys/device flow, project create/list/getBySlug/delete, secret create/list/getEnvelope/decryptForUse/markUsed/delete, and agent createSession/sendTurn/cancelSession/closeSession/getTranscript. Unsupported tags return an RPC Defect identifying the unknown method. Supported methods derive authority from authenticated tenant membership.

## Database lifecycle

Set BETTER_AUTH_SECRET, GMACKO_SECRET_ENCRYPTION_KEY (32 characters or more) and PUBLIC_BASE_URL; configure GitHub credentials when using that provider. Email/password defaults off. Local tests explicitly enable it and disable email verification, using GMACKO_AGENT_ADAPTER=mock.

GMACKO_DB_DRIVER accepts only pglite (default) or postgres. Postgres requires an explicit valid PostgreSQL DATABASE_URL with no localhost fallback. PGLITE_DATA_DIR retains its default ~/.gmacko/data and requires a single owning process.

The first request opens the selected driver and applies real Drizzle migrations before auth/RPC services become available. Concurrent callers share the pending initialization. A failed attempt closes and permits a later retry. The HMR-global manager survives module reloads; module/static-path evaluation performs no database IO. Manager close waits for initialization and closes the correct PGlite handle or postgres-js pool; get waits for an active close before reopening. The Next process owns these resources until shutdown; do not call its shutdown close during requests.

## Explicit acceptance

Use frozen Node 24 / pnpm 10 dependencies. From repository root:

```sh
pnpm --filter @gmacko/core exec vitest run src/db/__tests__/initialization.test.ts src/db/__tests__/migrate.test.ts
pnpm --filter @gmacko/core-web exec tsc --noEmit --incremental false
pnpm --filter @gmacko/core-web test:smoke
```

Default app tests include the smoke, use a temporary PGlite directory and Next dev webpack on port 3500 (CORE_SMOKE_PORT overrides). The smoke asserts signed-in identity, session creation/readback, second-account denial and unsupported-method rejection. HTTP NDJSON sends request frames only: Effect HTTP appends Eof itself. The old duplicate Eof produced Interrupt failures on both drivers.

For PostgreSQL, create a dedicated disposable database using the local fixture recipe in ../../docs/architecture/research-results-and-integration-checks.md, then run:

```sh
env -u DATABASE_URL CORE_SMOKE_REQUIRE_POSTGRES=1 CORE_SMOKE_DATABASE_URL=postgresql://127.0.0.1:55479/bob_audit_core pnpm --filter @gmacko/core-web test:smoke
```

The required flag fails without the explicit URL. This applies migrations and persists randomized test accounts/sessions; an independent SQL read verifies the account exists in the configured PostgreSQL database. Never use application data. Run smoke processes sequentially because they share the Next build directory. CORE_SMOKE_SERVER_LOG=/tmp/bob-core-smoke.log captures child logs.

These checks prove local HTTP/auth/SQL composition. Production build, multi-process migration orchestration, live providers/OAuth, visual behavior and deployment remain separate acceptance work. No new CI PostgreSQL service is provisioned.
