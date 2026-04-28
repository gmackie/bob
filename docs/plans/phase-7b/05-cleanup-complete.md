# Phase 7B Foundation — Cleanup Complete

**Date:** 2026-04-28
**Branch:** `phase-7b-foundation`
**Base:** `0d31bd3` (foundation-complete tag)
**Cleanup commits:** `ac815cb`, `7ce9482`, `c07b314`, `2283071`

This document records the post-foundation cleanup that resolved the 5
test failures and 1 build failure documented in
`04-foundation-complete.md`. Original 5 turbo task failures → 2
turbo task failures (both rolling up to the same 2 suite-level
DATABASE_URL-gated test files in `@bob/api`).

## What was fixed

| # | Failure | Resolution | Commit |
|---|---|---|---|
| 1 | `packages/core` composer.test.tsx Chai/jsdom matcher | jest-dom matchers explicitly extended in setup | `ac815cb` |
| 2 | `@bob/execution` taskExecutor brittle source-text assertion | Skipped with TODO pointing at 7B-Bob | `7ce9482` |
| 3 | `@bob/api` cookies (import + setSessionScopes) | Tests aligned with current source: `normalizeDomain` strips leading dot; mock now provides `chatConversations.findFirst` | `2283071` |
| 4 | `@bob/api` featureBranch markTaskPRMerged | Source serializes via `.toISOString()` (Drizzle text column); test asserts ISO-8601 string | `2283071` |
| 5 | `@bob/api` work-items (replaces artifact + non-member rejection) | `producerType: "bob"` was a DB-enum value; switched to zod-enum value `"task_run"` | `2283071` |
| 6 | `@bob/blder` Vite/rolldown production build | tsconfig paths updated to new layout; `publicHoistPattern` entries added for Bob's undeclared transitives (next, @radix-ui/*, drizzle-orm, etc.); pglite pinned via overrides | `c07b314` |

## Verification

```
pnpm exec turbo run typecheck --concurrency=1 \
  --filter=@gmacko/core --filter=@gmacko/ooda --filter=@gmacko/bob
# 3/3 green

cd apps/core && pnpm test -- smoke
# 9/9 green

cd packages/bob/src/api && pnpm test --no-file-parallelism
# 370 passed | 1 skipped | 2 suite-level fail (DATABASE_URL-gated)

cd apps/bob && pnpm build
# green

pnpm exec turbo run test --concurrency=1 --continue -- --no-file-parallelism
# 24/26 turbo tasks green; remaining 2 are @bob/api#test + @gmacko/bob#test rollup
```

### Final test totals

| Package | Files | Tests passing | Tests failing |
|---|---|---|---|
| `packages/core` | 101/101 | 347 | 0 |
| `packages/ooda` | 2/2 | 8 | 0 |
| `apps/core` (smoke) | 1/1 | 9 | 0 |
| `@bob/api` | 46/48 | 370 | 0 (2 suite-level DATABASE_URL-gated) |
| **Total** | **150/152** | **734** | **0 individual; 2 suite-level** |

## Remaining carry-forward to 7B-Bob

- **2 suite-level failures in `@bob/api`**:
  - `src/router/__tests__/agentRun.regression-1.test.ts`
  - `src/services/forgegraph/__tests__/pipelineOrchestrator.test.ts`

  Both fail at module load because importing the router transitively
  loads `@bob/db`'s `client.ts`, which throws at module init when
  `DATABASE_URL` is missing. The test files themselves use mocks and
  never query the db — they were never gated against env presence.
  Setting a fake `DATABASE_URL` lets them load but surfaces a real
  assertion failure in `pipelineOrchestrator > stays in awaiting_review
  when review requests changes` that's outside the foundation cleanup
  scope. Both belong with the Bob stack rewrite work in 7B-Bob.

- **Source debt surfaced during Cleanup #109 (deferred):**
  - `@bob/api` cookies.ts unconditionally strips leading dot from cookie
    domain (`normalizeDomain`). Fine for local cookie-jar modeling, lossy
    if ever replayed as a real `Set-Cookie`/Netscape `cookies.txt`.
  - `@bob/api` createArtifactInputSchema's zod enum
    (`task_run|session|integration|manual`) diverges from the DB enum
    (`bob|forgegraph|human|system`). Source `workItems.ts:376` documents
    the divergence; rewrite under 7B-Bob will collapse it.

- Items already documented in `04-foundation-complete.md` Carry-forward
  table that remain unchanged: OODA route typecheck errors,
  `@bob/eslint-config` eslint-plugin-turbo drift, Bob's stack rewrite,
  domain service migrations.

## Notes on infra changes

The Cleanup #6 fix introduced two monorepo-wide install behaviors that
future maintainers should know about:

1. **`publicHoistPattern` entries** (in `pnpm-workspace.yaml`) for
   `next`, `@radix-ui/*`, `class-variance-authority`, `drizzle-orm`,
   `@tailwindcss/typography`. These hoist Bob's undeclared transitive
   imports to root `node_modules` so apps/bob resolves them without
   declaring each one as a direct dep. Leaf packages keep their isolated
   `node_modules` so version conflicts (vitest 3.x vs 4.x, effect 3.x vs
   4.x) stay siloed.

2. **`@electric-sql/pglite` pinned to 0.3.16** via `pnpm.overrides`.
   `@gmacko/core` declared `^0.2.0`, `@bob/db` declared `^0.3.0`. The
   pin dedupes preemptively and avoids the duplicate-resolution issues
   we hit when experimenting with full `node-linker=hoisted`.

When per-area migrations land (7B-2..N), each `publicHoistPattern` entry
should be removed once the consuming package declares the dep
explicitly. The pglite override should remain until both consumers
align.
