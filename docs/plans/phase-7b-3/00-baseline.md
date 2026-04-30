# Phase 7B-3 Baseline — Auth Migration

Captured 2026-04-29, branch `phase-7b-3-auth-migration` off `master` (post 7B-2 merge).

## Test Counts

| Suite | Result |
|-------|--------|
| `@bob/api` tests | 370 passed, 1 skipped |
| `@gmacko/bob` typecheck | green |
| `@gmacko/core` tests | 347 passed |
| `apps/core` smoke | 9/9 |

## Import Sites: `@bob/auth`

**16 total import sites** (excluding `.d.ts` and `node_modules`).

### Non-schema consumers (3 files)

| File | Imports |
|------|---------|
| `packages/bob/src/api/src/trpc.ts` | `resolveRequestAuthContext`, `ApiKeyAuth`, `ApiKeyPermission`, `Auth` |
| `apps/bob/src/auth/server.ts` | `initAuth` |
| `apps/bob/src/env.ts` | `authEnv` (from `@bob/auth/env`) |

### Schema consumers (13 references)

All import `user` from `@bob/auth/schema`:

| # | File |
|---|------|
| 1 | `packages/bob/src/agents/src/schema.ts` |
| 2 | `packages/bob/src/chat/src/schema.ts` |
| 3 | `packages/bob/src/cookies/src/schema.ts` |
| 4 | `packages/bob/src/db/src/schema.ts` (re-export barrel) |
| 5 | `packages/bob/src/db/src/client-pglite.ts` (comment only) |
| 6 | `packages/bob/src/git/src/schema.ts` |
| 7 | `packages/bob/src/notifications/src/schema.ts` |
| 8 | `packages/bob/src/projects/src/schema.ts` |
| 9 | `packages/bob/src/secrets/src/schema.ts` |
| 10 | `packages/bob/src/settings/src/schema.ts` |
| 11 | `packages/bob/src/tenancy/src/schema.ts` |
| 12 | `packages/bob/src/webhooks/src/schema.ts` |
| 13 | `packages/bob/src/work-items/src/schema.ts` |

## Auth Tables (Bob's current 6)

Defined in `packages/bob/src/auth/src/schema.ts`:
`user`, `session`, `account`, `verification`, `apikey`, `jwks`

## Auth Tables (gmacko's current 5)

Defined in `packages/core/src/auth/schema.ts`:
`users`, `sessions`, `accounts`, `verifications`, `api_keys`

Name collision: singular (Bob) vs plural (gmacko) — no actual SQL conflicts.
