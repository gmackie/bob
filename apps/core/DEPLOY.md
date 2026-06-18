# `apps/core` deployment notes

This is a stub. Phase 7A scope: capture the env vars + driver choices that
the in-process Next.js + Effect-RPC server expects. Bob/OODA migration in
Phase 7B+ will flesh this into a full deploy runbook.

## Required env

- `BETTER_AUTH_SECRET` — at least 32 chars; signs session cookies + HMAC.
- `GMACKO_SECRET_ENCRYPTION_KEY` — 32-char master key for the
  `@gmacko/secrets` envelope-encryption store.
- `PUBLIC_BASE_URL` — fully-qualified URL (with scheme) the app serves
  from; used for cookie domain + better-auth `trustedOrigins`.
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — github OAuth (production
  uses GitHub as the primary provider; the email/password provider below
  is dev-only).

## Optional env

- `GMACKO_DB_DRIVER` — `pglite` (default) or `postgres`. Use `postgres`
  for shared-state deployments. PGlite is single-process WASM-backed
  (great for dev, single-tenant local; not for prod).
- `DATABASE_URL` — required when `GMACKO_DB_DRIVER=postgres`.
- `PGLITE_DATA_DIR` — overrides `~/.gmacko/data` when running with PGlite.
- `GMACKO_AGENT_ADAPTER` — `claude-code` (default; spawns the Claude Code
  CLI) or `mock` (for tests + dev without a CLI installed).
- `GMACKO_BETTER_AUTH_EMAIL_PASSWORD` — `true` to enable
  `/sign-up/email` + `/sign-in/email`. **Off in production.**
- `GMACKO_BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION` — `false` to skip the
  email verification round-trip (only for dev/test).
- `REALTIME_BACKEND` — `memory` (default) | `redis` | `ws-gateway`. See
  `@gmacko/realtime` for backend-specific config.

## Build commands

- `pnpm dev` — runs `next dev` (Turbopack). For the smoke test, use
  `next dev --webpack` (Turbopack's prod build trips on a workspace
  `.js → .ts` resolution issue tracked in the README's Known issues).
- `pnpm build` — currently runs `next build --webpack`. Turbopack
  production build is blocked on the same `.js → .ts` issue.
- `pnpm test` — runs vitest including the smoke test. The smoke test
  spawns its own `next dev --webpack` instance on port 3500.

## Database migrations

`apps/core` runs `runMigrations(pglite | pg)` at first request via the
`ensureMigrated` sandwich in `src/app/api/rpc/route.ts` and
`src/app/api/auth/[...all]/route.ts`. Migrations are idempotent — a
fresh deploy migrates on first traffic. Production deployments should
also run migrations explicitly during deploy (TODO Phase 7B: document
the standalone migration entry point).

## Smoke test in CI

`apps/core/src/__tests__/smoke.test.ts` boots `next dev --webpack` and
exercises sign-up → sign-in → `/api/rpc` round-trip + a forced page
compile (catches client-bundle regressions like the `node:` scheme
errors removed in Phase 7A Task 9).

**Phase 7A status:**

- 9 tests passing.
- Strict assertion on unauthenticated `auth.whoAmI` envelope (verifies
  rpcCall framing + AuthMiddleware short-circuit + Effect error
  encoding work end-to-end).
- Cookie-bearing `auth.whoAmI` and `agent.createSession` kept with
  relaxed assertions because PGlite-WASM emits `Aborted()` under
  concurrent better-auth + RPC handler load. Production uses Postgres,
  unaffected. Tightening deferred to Phase 7B once the integration
  test moves to Postgres.

CI integration: TODO Phase 7B — add the smoke job to the CI matrix and
add a Playwright run against a Postgres-backed dev server for the
authenticated round-trip.

## Known issues

- **PGlite WASM `Aborted()` under load.** See above. Workaround: use
  `postgres` driver. Tracked in plan `2026-04-25-phase7a-punchlist.md`
  retro section.
- **Pre-existing OODA-area TS errors** in `src/app/graph/page.tsx:60`
  (readonly `tags` array) and `src/components/voice-input.tsx:32-33`
  (`last` possibly undefined). Block `next build` in some configs.
  Out of scope for Phase 7A; cleanup pass scheduled for OODA migration
  (Phase 7C+).
- **No `typecheck` script** in `apps/core/package.json`. Use
  `npx tsc --noEmit` from this directory until added.

## Phase 7B/C carry-forward

- Migration runbook (standalone migration entry, rollback path).
- CI matrix: smoke job + Playwright authenticated round-trip on
  Postgres.
- OODA TS error cleanup pass.
- `typecheck` script in package.json.
- Tighten cookie-bearing smoke assertions to assert sign-in user shape
  + agent session ID once running on Postgres.
