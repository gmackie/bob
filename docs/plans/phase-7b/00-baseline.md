# Phase 7B-0 Baseline (Task 0)

**Date:** 2026-04-28
**Branch:** `phase-7b-foundation`
**Base SHA (master):** `7e5dc2b7152a5929036c3fee60f5080915448e18`
**Worktree:** `/Users/mackieg/.config/superpowers/worktrees/gmacko/phase-7b-foundation`

## Verification command (Phase 7B-0)

From the worktree root:

    pnpm exec turbo run test --concurrency=1

Expected: 363/363 across 30 packages.
For smoke: `cd apps/web && pnpm test -- smoke` (expect 9/9).

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
4. **PGlite parallelism flake under default `pnpm test`:** running `turbo run test`
   without a concurrency cap produces sporadic failures in agent / projects /
   secrets / app-shell because many packages spin up their own in-process PGlite
   instance simultaneously, and a few exceed timing budgets. Each package passes
   cleanly when run in isolation, and `pnpm exec turbo run test --concurrency=1`
   gives 30/30. Future Phase 7B-0 verification gates should use `--concurrency=1`
   (or per-package isolation) to get a deterministic signal — otherwise we will
   be chasing flakes that aren't real regressions.
