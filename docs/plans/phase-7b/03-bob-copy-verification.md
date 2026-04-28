# Phase 7B-1a — Post-Copy Verification

**Date:** 2026-04-28
**Bob source SHA:** `0aa466ad057e45ab28ac1d12ea765d1a703f18ef`
**Gmacko Bob-copy commit SHA:** `f269a031616f3f17e2ead7542980f2197adde38c`
**Source-state probe:** see [`02-bob-probe.md`](./02-bob-probe.md).

This document captures the final state of Tasks 11+12 (copy + workspace merge). It is descriptive — no new work is proposed here; follow-ups are deferred to later sub-phases.

## Apps copied (6)

Bob source dir → gmacko target dir:

- `apps/web/` → `apps/bob/`
- `apps/mobile/` → `apps/mobile-bob/`
- `apps/desktop/` → `apps/desktop-bob/`
- `apps/server/` → `apps/bob-server/`
- `apps/ws-gateway/` → `apps/bob-ws-gateway/`
- `apps/execution/` → `apps/bob-execution/`

Bob's own `apps/web/` shell **was not copied** (it is dead code in the source, no `package.json`).

## Packages copied (25)

All under `packages/bob/src/<pkg>/` as nested workspace packages. The package name shipped in `package.json` is preserved verbatim from Bob.

| Source dir | Shipped name |
| --- | --- |
| `packages/bob/` | **`bob`** (unscoped — name/dir mismatch flagged) |
| `packages/api/` | `@bob/api` |
| `packages/agents/` | `@bob/agents` |
| `packages/agent-toolkit/` | `@bob/agent-toolkit` |
| `packages/bob-agent-toolkit/` | **`@bob/agent-toolkit`** (name/dir mismatch flagged — duplicate of above; both shipped to preserve Bob's source) |
| `packages/auth/` | `@bob/auth` |
| `packages/db/` | `@bob/db` |
| `packages/execution/` | **`@bob/execution-lib`** (name/dir mismatch flagged) |
| `packages/eslint-config/` | `@bob/eslint-config` |
| `packages/feature-branch/` | `@bob/feature-branch` |
| `packages/git/` | `@bob/git` |
| `packages/github-app/` | `@bob/github-app` |
| `packages/llm/` | `@bob/llm` |
| `packages/observability/` | `@bob/observability` |
| `packages/orchestrator/` | `@bob/orchestrator` |
| `packages/pusher/` | `@bob/pusher` |
| `packages/realtime/` | `@bob/realtime` |
| `packages/runtime/` | `@bob/runtime` |
| `packages/sandbox/` | `@bob/sandbox` |
| `packages/shared/` | `@bob/shared` |
| `packages/storage/` | `@bob/storage` |
| `packages/test-utils/` | `@bob/test-utils` |
| `packages/typescript-config/` | `@bob/typescript-config` |
| `packages/ui/` | `@bob/ui` |
| `packages/vscode/` | `@bob/vscode` |

The 3 flagged name-vs-dir mismatches are intentional: Bob ships them this way and we preserved source verbatim. They are candidates for renaming during 7B-2..N migrations.

## Tooling copied (5)

Renamed at the directory level to avoid collision with gmacko's own `tooling/`. Package names inside `package.json` are preserved as `@bob/*`:

- `tooling/eslint/` → `tooling/bob-eslint/` (package: `@bob/eslint-config`)
- `tooling/typescript/` → `tooling/bob-typescript/` (package: `@bob/typescript-config`)
- `tooling/tailwind/` → `tooling/bob-tailwind/` (package: `@bob/tailwind-config`)
- `tooling/prettier/` → `tooling/bob-prettier/` (package: `@bob/prettier-config`)
- `tooling/github/` → `tooling/bob-github/` (package: `@bob/github-config`)

## `pnpm-workspace.yaml` merge

- `packages` glob extended with `packages/bob/src/*` (nested workspace pattern).
- `catalog` merged: gmacko + Bob entries unioned; conflicts resolved in gmacko's favour where versions matched, otherwise Bob's pin retained under a Bob-namespaced key.
- `catalogs.react19` introduced from Bob and merged with gmacko's React 19 entries.
- `onlyBuiltDependencies` unioned (esbuild, sharp, better-sqlite3, etc.).
- `overrides` merged.
- `publicHoistPattern` extended with Bob's entries.

## Root `package.json` merge

- `pnpm.overrides` absorbed Bob's `react` and `react-dom` `19.2.5` pin so all six apps resolve the same React version.
- No other root-level changes.

## Test results

- **Smoke:** 9/9 green.
- **Typecheck:** 3/3 green for `@gmacko/{bob,core,ooda}`.
- **Expected failures:** 6, exactly matching the source-state probe (see `02-bob-probe.md`). No new failures introduced by the copy.

Verification command (Phase 7B-0 standard):

```
pnpm exec turbo run test --concurrency=1 -- --no-file-parallelism
```

## Path-test patches applied

Two Bob tests reference path prefixes that no longer hold under the nested layout. Patched in-place to match the new location:

- `runLifecycleEvents.test.ts` — drop `packages/db/` prefix; use `src/db/`.
- `taskRunHierarchy.test.ts` — same.

These are mechanical patches; no behavioural change.

## Floating dep pinning

Five deps that floated in Bob were pinned to the resolved versions to avoid drift:

- `@types/node` → `22.10.5`
- `typescript` → `5.7.3`
- `vitest` → `2.1.8`
- `vite` → `6.0.7`
- `tsx` → `4.19.2`

## Shell adjustments to `@gmacko/bob`

- `tsconfig.json` `include` narrowed (Bob's source is project-referenced, not directly compiled by the gmacko shell).
- `vitest.config.ts` removed (Bob's own packages own their test configs).

## Known follow-ups (deferred)

- **6 pre-existing Bob test failures** — `@bob/execution` `taskExecutor` plus `@bob/api` `cookies` / `featureBranch` / `work-items`. Match the probe; out of scope for 7B-1a.
- **`@bob/eslint-config` typecheck failure in gmacko** — `eslint-plugin-turbo` version drift. Not a runtime issue.
- **`@gmacko/core` `composer.test.tsx`** — pre-existing gmacko failure (`Invalid Chai property: toBeDisabled`). Documented so future verification doesn't conflate it with copy artefacts.
- **Bob's `apps/web/` shell** — not copied (dead code, no `package.json`).

Per-area migrations (auth, db, realtime, etc.) land in 7B-2..9.
