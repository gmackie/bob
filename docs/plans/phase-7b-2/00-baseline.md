# Phase 7B-2 Baseline (Task 0)

**Date:** 2026-04-28
**Branch:** `phase-7b-2-db-merge`
**Base:** `41fe0c4` (master, post phase-7b-foundation merge)

## Pre-merge state

### Monolith schema files

| File | Lines | Tables |
|---|---:|---:|
| `packages/bob/src/db/src/schema.ts` | 2824 | 62 |
| `packages/bob/src/db/src/auth-schema.ts` | 53 | 4 |
| **Total** | **2877** | **66** |

After 7B-2: 0 tables in `db/schema.ts`; the file becomes a 13-line barrel
re-exporting from 13 area packages. Bob's tables redistribute as 65 (Post
dropped) across the area packages.

### Import-site counts (post-split must stay equivalent)

| Import shape | Count | Stays working how |
|---|---:|---|
| `from "@bob/db/schema"` | 62 | barrel re-exports from areas |
| `from "@bob/db"` (operators) | 52 | unchanged — `db/index.ts` still re-exports drizzle-orm |
| `from "@bob/db/client"` | 30 | unchanged — `db/client.ts` not touched |
| **Total `@bob/db*` imports** | **144** | All 144 must keep resolving |

### Test baseline

| Package | Status |
|---|---|
| `@bob/api` (370 passed, 1 skipped, 2 suite-level DATABASE_URL gates) | reproduced |
| `@gmacko/bob#typecheck` | green |

The 2 suite-level DATABASE_URL gates (`agentRun.regression-1.test.ts`,
`pipelineOrchestrator.test.ts`) are documented carry-forward from
`phase-7b/05-cleanup-complete.md`; they remain out of scope.

### Existing area packages that gain a `schema.ts`

- `packages/bob/src/auth/` — gains 6 tables (4 from auth-schema.ts + apiKeys + deviceCodes)
- `packages/bob/src/settings/` — gains 1 table (userPreferences)
- `packages/bob/src/work-items/` — gains 12 tables
- `packages/bob/src/agents/` — gains 12 tables
- `packages/bob/src/notifications/` — gains 4 tables
- `packages/bob/src/cookies/` — gains 2 tables

### New area packages to create (Tasks 1–7)

- `packages/bob/src/tenancy/` — 4 tables
- `packages/bob/src/projects/` — 6 tables
- `packages/bob/src/chat/` — 3 tables
- `packages/bob/src/git/` — 6 tables
- `packages/bob/src/webhooks/` — 2 tables
- `packages/bob/src/ci/` — 4 tables
- `packages/bob/src/secrets/` — 3 tables

### Drop list

- `Post` table (t3 boilerplate, line 8 of schema.ts) — Task 21.

## Verification command

Run after each area-move task:

```
cd packages/bob/src/api && pnpm test --no-file-parallelism
# expect: 370 passed | 1 skipped (371) — same as baseline

pnpm exec turbo run typecheck --concurrency=1 --filter=@gmacko/bob
# expect: green
```

Final sweep (Task 23):

```
pnpm exec turbo run test --concurrency=1 --continue -- --no-file-parallelism
# expect: 24/26 turbo tasks green; the 2 documented DATABASE_URL gates remain
```
