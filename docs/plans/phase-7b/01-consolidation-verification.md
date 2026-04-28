# Phase 7B-0 Consolidation — Verification (Task 9)

**Date:** 2026-04-28
**Branch:** `phase-7b-foundation`
**Tag:** `phase-7b-0-consolidation-complete`

## Final state

`packages/` contains exactly three namespace shells:

```
bob/    (empty placeholder; populated in Phase 7B-1a)
core/   (74 export entries — 1 root + 73 subpaths)
ooda/   (3 export entries — 1 root + ./wiki + ./ext)
```

The 32 original `@gmacko/*` leaf packages are gone — every one folded as a
subpath under one of the three shells.

## Verification commands

From the worktree root:

    pnpm install                                                          # clean
    pnpm exec turbo run typecheck --concurrency=1 --force                  # 3/3 packages green
    pnpm exec turbo run test --concurrency=1 --force -- --no-file-parallelism  # 4/4 tasks, 364 tests
    cd apps/web && pnpm test -- smoke                                      # 9/9

## Final test totals

| Package      | Tests       |
| ------------ | ----------: |
| @gmacko/core |     347/347 |
| @gmacko/ooda |         8/8 |
| @gmacko/bob  |         0/0 |
| @gmacko/web  |         9/9 |
| **Total**    | **364/364** |

Workspace total preserved against the Task 0 baseline (364 — see
`00-baseline.md`); zero tests lost during consolidation.

## Phase 7A invariants preserved

- `@gmacko/core/{auth,secrets,projects,agent}/errors` remain dependency-free
  subpaths importing only `effect/Schema`. Verified: `contracts/stubs/*.ts`
  files import from `@gmacko/core/<svc>/errors`, NOT from the heavy barrel.
- Smoke (`apps/web/src/__tests__/smoke.test.ts`) passes 9/9, exercising the
  client-bundle compile path that catches `UnhandledSchemeError`-class issues.

## Notable decisions during execution

1. **`@gmacko/agent` rolled forward** into core during Task 4-fix (alongside
   Batch 4's contracts/client/rpc) because `@gmacko/contracts` consumed
   `@gmacko/agent/errors` and a transitional vitest-alias shim was leaving
   workspace typecheck red. Folding agent in the same commit as Batch 4
   dissolved both the cycle and the shim atomically. Task 6 (Batch 5)
   therefore covered 6 packages instead of the originally-planned 7.

2. **vitest dual-environment** required for Batch 6: core's tests now run a
   mix of node-env (PGlite, db, secrets, etc.) and jsdom-env (ui, *-shell)
   suites. Solved with `environmentMatchGlobs` in
   `packages/core/vitest.config.ts`, scoping jsdom to
   `src/{ui,app-shell,mobile-shell,desktop-shell}/**`.

3. **`compilerOptions.types`** added to `packages/core/tsconfig.json` to
   declare `["node", "vitest/globals", "@testing-library/jest-dom"]`. The
   `node` entry is explicit because adding a `types` array disables the
   default auto-include of `@types/*`.

4. **Verification command corrected** in Task 2 review: original
   `--concurrency=1` was insufficient because the PGlite flake is
   intra-package (vitest workers booting multiple PGlite instances inside a
   single package). Adding `-- --no-file-parallelism` passes the flag through
   to vitest and produces a deterministic green sweep.

5. **`ext-ooda` renamed to `ext`** when folded into `@gmacko/ooda`. The path
   `@gmacko/ooda/ext` is cleaner than `@gmacko/ooda/ext-ooda` (which would
   have been redundant inside the ooda namespace). No consumers existed yet,
   so the rename was a no-op.

## Commit history (Phase 7B-0)

```
7d89e25 refactor(workspace): batch 7 — move wiki/ext-ooda into @gmacko/ooda
4300935 refactor(workspace): batch 6 — move ui/app-shell/mobile-shell/desktop-shell/models into @gmacko/core
4918585 refactor(workspace): batch 5 — move agent-toolkit/realtime/ws-gateway/runner-protocol/runner-base/mcp-server into @gmacko/core
7e56c1e docs(phase-7b): note that agent rolled forward into Task 4-fix
dc96593 refactor(workspace): batch 4 + agent — fold contracts/client/rpc/agent into @gmacko/core
18c93e8 refactor(workspace): batch 3 — move auth/secrets/projects/billing/email/notifications into @gmacko/core
55a5fb9 refactor(workspace): batch 2 — move db/storage/monitoring/analytics into @gmacko/core
7cc8cd1 docs(phase-7b): correct verification command (Task 2 review I-1)
85bb4b2 refactor(workspace): batch 1 — move validators/config/cookies/i18n/settings into @gmacko/core
571ae38 fix(workspace): correct bob/ooda barrel comments (Task 1 review I-1)
5d56492 feat(workspace): create @gmacko/{core,bob,ooda} shells
5db1105 chore(phase-7b-0): capture baseline test counts (Task 0)
```

## Follow-up cleanup (deferred — not blocking)

- `describe()` block strings in tests still reference old package names
  (e.g., `"@gmacko/auth ..."` should be `"@gmacko/core/auth ..."`). Cosmetic.
- A handful of doc comments in source files reference old package names
  (e.g., `packages/core/src/realtime/layer.ts` mentions `@gmacko/config`).
  Semantic, not load-bearing.
- `tokens.test.tsx` deep relative path (`../../../../../tooling/tailwind/...`)
  could be replaced with a tooling alias for hardening.
- Several `apps/web/src/app/{wiki,capture,explore,graph}/` routes are stubs
  not yet wired to ooda's wiki helpers — these get relocated to `apps/ooda/`
  in Phase 7B-1b Task 16.
