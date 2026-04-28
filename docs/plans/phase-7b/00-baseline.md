# Phase 7B-0 Baseline (Task 0)

**Date:** 2026-04-28
**Branch:** `phase-7b-foundation`
**Base SHA (master):** `7e5dc2b7152a5929036c3fee60f5080915448e18`
**Worktree:** `/Users/mackieg/.config/superpowers/worktrees/gmacko/phase-7b-foundation`

## Verification command (Phase 7B-0)

From the worktree root:

    pnpm exec turbo run test --concurrency=1 -- --no-file-parallelism

Expected after Batch 1: 363/363 across 26 reporting projects (`@gmacko/core`
absorbs `@gmacko/{validators,config,cookies,i18n,settings}` totalling 31 of those
363 tests).

Each subsequent batch reduces the reporter count by N − 1 (N packages move into
`@gmacko/core`, +0 since `@gmacko/core` is already a reporter). Total test count
must remain ≥ 363 throughout 7B-0.

For smoke: `cd apps/web && pnpm test -- smoke` (expect 9/9).

**Why `--no-file-parallelism`:** PGlite-using packages (`db`, `auth`, and any
others that boot a PGlite instance per test file) flake under vitest's default
worker pool, which parallelises files within a single package. The flag forces
intra-package vitest to run files serially, which reliably resolves the flake.
Turbo `--concurrency=1` alone is not enough — it serialises packages but does
nothing about file-level parallelism inside a package.

## Pre-conditions confirmed

- `pnpm install` clean (1163 packages, lockfile up-to-date, no resolution churn).
- `apps/server/` is **absent** on master / in this worktree. It was an untracked artifact in earlier worktrees (leftover `dist/` + `node_modules/`), never committed. No commit needed to "delete" it. Step 4 of the plan's Task 0 is a no-op.

## Per-package test counts (pristine baseline)

Captured via `pnpm exec turbo run test --concurrency=1` to avoid PGlite parallelism contention (see "Notes" below).

| Package                  | Tests passed |
| ------------------------ | -----------: |
| @gmacko/agent            |        33/33 |
| @gmacko/agent-toolkit    |          1/1 |
| @gmacko/analytics        |          1/1 |
| @gmacko/app-shell        |        25/25 |
| @gmacko/auth             |        69/69 |
| @gmacko/billing          |          1/1 |
| @gmacko/client           |        10/10 |
| @gmacko/config           |        12/12 |
| @gmacko/contracts        |        12/12 |
| @gmacko/cookies          |          1/1 |
| @gmacko/db               |        49/49 |
| @gmacko/desktop-shell    |          1/1 |
| @gmacko/email            |          1/1 |
| @gmacko/i18n             |          1/1 |
| @gmacko/mcp-server       |          1/1 |
| @gmacko/mobile-shell     |          1/1 |
| @gmacko/monitoring       |          1/1 |
| @gmacko/notifications    |          1/1 |
| @gmacko/projects         |          8/8 |
| @gmacko/realtime         |        20/20 |
| @gmacko/rpc              |          3/3 |
| @gmacko/runner-base      |        14/14 |
| @gmacko/runner-protocol  |          8/8 |
| @gmacko/secrets          |        25/25 |
| @gmacko/settings         |          1/1 |
| @gmacko/storage          |          1/1 |
| @gmacko/ui               |        30/30 |
| @gmacko/validators       |        16/16 |
| @gmacko/web              |          9/9 |
| @gmacko/wiki             |          8/8 |
| **Total**                |  **363/363** |

30 packages run tests; 30/30 pass.

## Smoke result

`apps/web` smoke suite: **9/9 passed** (`cd apps/web && pnpm test -- smoke`).

## Notes / surprises

1. **Plan said `auth = 70`; actual is 69.** Plan was likely written from memory or
   a slightly older snapshot. 69 is the new floor for Phase 7B-0 verification.
2. **Plan said `agent = 33` — confirmed.**
3. **`apps/server/` is not a thing.** The plan instructs to `rm -rf apps/server/`
   and commit, but the directory does not exist on master and was an untracked
   artifact in earlier worktrees. Skipping that delete-and-commit step; this
   baseline doc serves as the explicit record.
4. **PGlite parallelism flake (corrected after Task 2 review):** the original
   diagnosis blamed inter-package parallelism and prescribed `turbo run test
   --concurrency=1`. That isn't enough — the flake is **intra-package**: vitest
   runs files inside a single package on parallel workers, and PGlite-heavy
   suites (`db`, `auth`, sometimes `secrets` / `projects` / `app-shell`) bust
   their timing budgets when multiple PGlite instances boot in the same
   package's worker pool. The fix is `-- --no-file-parallelism` passed through
   turbo to vitest. With that flag, full sweep is 28/28 turbo tasks green,
   ≥363/363 tests across the workspace, smoke 9/9 in apps/web.
