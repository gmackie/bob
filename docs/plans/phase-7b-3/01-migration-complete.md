# Phase 7B-3 Auth Migration — Complete

Completed 2026-04-29 on branch `phase-7b-3-auth-migration`.

## What Changed

Bob's auth now runs on gmacko's `@gmacko/core/auth` Effect services via a
`ManagedRuntime` bridge. Single shared DB, single better-auth instance.

### DB convergence (Task 1)

- gmacko's 4 auth tables (`users`, `sessions`, `accounts`, `verifications`)
  added to Bob's schema barrel and PGlite bootstrap
- Bob's `apiKeys` + `deviceCodes` tables remain Bob-owned (different columns
  from gmacko's `api_keys`/`device_codes`)

### Effect auth runtime bridge (Task 2)

- `createAuthRuntime(opts)` → `AuthRuntimeBundle` containing:
  - `runtime`: `ManagedRuntime<Sessions | ApiKeys | DeviceCodes | Tenancy>`
  - `authInstance`: raw better-auth instance for `getSession()` calls
- Imports `initAuth`, `layerAuth`, `layerGmackoDb`, `layerBetterAuth` from
  `@gmacko/core/auth` and `@gmacko/core/db`

### tRPC context wiring (Task 3)

- `createTRPCContext` accepts `{ authBundle: AuthRuntimeBundle }` instead of
  `{ auth: Auth }`
- `resolveAuthContext()` uses `authBundle.authInstance.api.getSession()` for
  the full better-auth session shape (backwards compatible with 370+ tests)
- API key validation still uses Bob's own `validateApiKey()` against Bob's
  `apiKeys` table

### Retired internals (Task 4)

- Bob's `initAuth()` function and `Auth` type — deleted
- `validateSessionToken()` — deleted (dead: queried non-existent singular
  `session` table)
- `resolveRequestAuthContext()` — deleted (replaced by `resolveAuthContext()`)
- 4 better-auth table definitions (`user`, `session`, `account`,
  `verification`) → aliased re-exports from gmacko
  (`users as user`, `sessions as session`, etc.)
- PGlite bootstrap deduplication added for aliased pgTable objects

### App wiring (Task 5)

- `apps/bob/src/auth/server.ts` uses single `createAuthRuntime()` instance
- Legacy dual-instance issue eliminated
- `githubScopes` option added to `InitAuthOptions` for Bob's `repo` scope

### Auth client (Task 6)

- No changes needed — client is a thin `createAuthClient` wrapper pointing
  at `/api/auth/*` which still serves from the shared better-auth instance

## Test Results (post-migration)

| Suite | Result |
|-------|--------|
| `@bob/api` | 370 passed, 1 skipped |
| `@bob/auth` | 7 passed |
| `@bob/db` | 15 passed |
| `@gmacko/core` | 347 passed |
| `apps/core` smoke | 9/9 |

## Import Sites

- 0 imports from retired subpaths (`@bob/auth/session`, `@bob/auth/context`)
- 13 imports from `@bob/auth/schema` (11 area packages + db barrel + comment)
- 1 import from `@bob/auth/runtime` (trpc.ts)
- 1 import from `@bob/auth` barrel (trpc.ts: resolveAuthContext, ApiKeyAuth, ApiKeyPermission)

## Known Issues

- **Turbo `^build` cycle**: Pre-existing from 7B-2. `pnpm exec turbo run
  test` fails with cyclic dependency. Use `--filter` or direct `pnpm test`.
- **Bob's API keys remain Bob-specific**: `validateApiKey()` queries Bob's
  `apiKeys` table, not gmacko's `ApiKeys` Effect service. Migration to
  gmacko's ApiKeys is deferred — different table schema.
- **`nextCookies()` plugin removed**: The shared auth instance doesn't use
  better-auth's `nextCookies()` plugin. Cookie resolution works via raw
  headers passed to `getSession()`. If RSC cookie-write operations are
  needed later, this may need revisiting.

## What's Next

- **7B-4**: Domain table convergence (Bob's domain tables → shared schema)
- **Future**: Migrate Bob's API key system to gmacko's `ApiKeys` Effect
  service (requires schema alignment)
- **Future**: Migrate remaining tRPC routes to Effect-RPC
