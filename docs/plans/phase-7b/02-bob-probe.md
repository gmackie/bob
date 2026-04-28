# Phase 7B-1a Task 10: Pre-copy probe of /Volumes/dev/bob/

**Date:** 2026-04-28
**Probe target:** `/Volumes/dev/bob/`
**Probe outcome:** YELLOW — Bob's tree is git-clean and most tests pass, but **6 tests fail at HEAD** (1 in `@bob/execution`, 5 in `@bob/api`). Failures appear pre-existing (predate our work). User must decide whether to (a) accept the red baseline and copy as-is, (b) skip the failing tests in Task 12's faithful copy, or (c) fix at source first.

---

## Bob HEAD

```
SHA:     0aa466ad057e45ab28ac1d12ea765d1a703f18ef
Subject: Merge branch 'feat/electron-phase-2.5'
Branch:  main (up to date with origin/main)

Last 3 commits:
  0aa466a  Merge branch 'feat/electron-phase-2.5'
  a0a702d  feat(desktop): wire Go daemon to local bob-server via env
  a7d1713  Merge branch 'feat/electron-phase-2'
```

## git status

```
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
```

Tree is clean — safe to copy from a snapshot perspective.

---

## Apps inventory

`/Volumes/dev/bob/apps/` contains 7 directories. **6 have `package.json`**; `apps/web/` does not (matches plan expectation — dead code, drop on copy).

| Dir | pkg name | Type | Key scripts | Workspace deps (`@bob/*`) | Notes |
|-----|----------|------|-------------|---------------------------|-------|
| `blder/` | `@bob/blder` | **vinext** (Vite-based RSC, deploys via wrangler/Cloudflare) | `dev: vinext dev`, `build: vinext build`, `start: vinext start`, `deploy: vinext deploy` | api, auth, config, db, execution, legacy, monitoring, ui, validators, ws | Cloudflare/wrangler deploy. Uses `vinext: latest`, `vite: latest`, `@vitejs/plugin-rsc: latest` — floating deps to pin during copy. |
| `bob-server/` | `@bob/server` | Pure Node CLI (commander) | `build: tsc`, `dev: tsc --watch`, `start: node dist/bin.js`, `test: vitest run` | blder, db | Has a `bin: { "bob-server": "./dist/bin.js" }` entry. |
| `desktop/` | `@bob/desktop` | Electron 40.6.0 | `dev: parallel tsdown + electron`, `build: tsdown`, `start: node scripts/start-electron.mjs`, `test: vitest run --passWithNoTests` | (none) | electron is in `onlyBuiltDependencies`. |
| `execution/` | `@bob/execution` | Library-only (no `dev`/`build` scripts; consumed by other apps via subpath exports) | `test: vitest run`, `lint`, `typecheck` | db, legacy | **1 failing test** (see below). |
| `mobile/` | `@bob/mobile` | Expo 55 (`expo: ~55.0.11`, `expo-router: ~55.0.10`) | `dev: expo start`, `dev:ios`, `dev:android`, `test: vitest run` | config, notifications, ws, **api as devDep** | Heavy native deps (sentry, reanimated, gesture-handler). NativeWind 5 preview. |
| `web/` | — (no `package.json`) | — | — | — | **DROP on copy.** Contains stale `dist/`, `next-env.d.ts`, `playwright-report/`, `test-results/` only. Matches plan Task 11 expectation. |
| `ws-gateway/` | `@bob/ws-gateway` | Pure Node + ws server, tsup-bundled | `build: tsup`, `dev: tsx watch src/index.ts`, `start: node dist/index.js`, `test: vitest run` | db, ws | Uses `@neondatabase/serverless` + `pg` + `drizzle-orm`. |

---

## Packages inventory

`/Volumes/dev/bob/packages/` contains **25 packages** (plan said ~27 — minor discrepancy, plan was an over-estimate).

Notable: directory `bob/` ships package name **`bob`** (not `@bob/bob`) — likely a placeholder/private. Directory `execution/` ships package name **`@bob/execution-lib`** (not `@bob/execution` — that name belongs to `apps/execution/`). Directory `bob-agent-toolkit/` ships **`@bob/agent-toolkit`**. These are name-vs-dir mismatches Task 12 must preserve.

| Dir | pkg name | Workspace deps (`@bob/*`) | Tests? | `src/*.ts(x)` count |
|-----|----------|---------------------------|--------|---------------------|
| `agents/` | `@bob/agents` | — | no | 1 |
| `analytics/` | `@bob/analytics` | config | no | 3 |
| `api/` | `@bob/api` | auth, config, db, execution, **execution-lib**, work-items, validators | yes (`__tests__/`) | **126** (largest pkg by far) |
| `auth/` | `@bob/auth` | db | yes (`__tests__/`) | 8 |
| `bob/` | `bob` (no scope) | — | no | 5 |
| `bob-agent-toolkit/` | `@bob/agent-toolkit` | — | yes (`__tests__/`) | 8 |
| `config/` | `@bob/config` | — | no | 2 |
| `cookies/` | `@bob/cookies` | — | no | 4 |
| `db/` | `@bob/db` | — | yes (`*.test.*`) | 17 |
| `email/` | `@bob/email` | config | no | 1 |
| `execution/` | `@bob/execution-lib` | — | no | 3 |
| `i18n/` | `@bob/i18n` | config | no | 3 |
| `legacy/` | `@bob/legacy` | — | no | 16 |
| `mcp-server/` | `@bob/mcp-server` | — | yes (`__tests__/`) | 14 |
| `monitoring/` | `@bob/monitoring` | config | no | 3 |
| `notifications/` | `@bob/notifications` | config | yes (`__tests__/`) | 1 |
| `payments/` | `@bob/payments` | config | no | 1 |
| `purchases/` | `@bob/purchases` | config | yes (`__tests__/`) | 1 |
| `realtime/` | `@bob/realtime` | config | no | 1 |
| `settings/` | `@bob/settings` | — | no | 3 |
| `storage/` | `@bob/storage` | config | no | 1 |
| `ui/` | `@bob/ui` | — | no | 26 |
| `validators/` | `@bob/validators` | — | no | 1 |
| `work-items/` | `@bob/work-items` | — | yes (`*.test.*`) | 5 |
| `ws/` | `@bob/ws` | — | yes (`__tests__/`) | 4 |

**Total source files in `packages/*/src/`:** ~257 `.ts`/`.tsx` files (rough size signal for the rsync).

**Internal dependency hub:** `@bob/api` is the central node — depends on 7 other `@bob/*` packages and is consumed by `@bob/blder` and `@bob/mobile` (devDep). `@bob/config` is the universal leaf-dep (8 packages depend on it). `@bob/db` is depended on by api/auth/server/ws-gateway/execution.

---

## Tooling inventory

`/Volumes/dev/bob/tooling/` — 5 packages:

| Dir | pkg name | Purpose |
|-----|----------|---------|
| `eslint/` | `@bob/eslint-config` | Shared ESLint config (used by `@bob/execution`, `@bob/mobile`) |
| `github/` | `@bob/github` | GitHub-related shared utilities (no description in package.json) |
| `prettier/` | `@bob/prettier-config` | Shared Prettier config (referenced by Bob root `package.json` `"prettier": "@bob/prettier-config"`) |
| `tailwind/` | `@bob/tailwind-config` | Shared Tailwind config (used by `@bob/blder`, `@bob/mobile`) |
| `typescript/` | `@bob/tsconfig` | Shared `tsconfig.json` base (used by every Bob package) |

**Caveat:** gmacko already has a `tooling/typescript` (`@gmacko/tsconfig`) and `tooling/tailwind`. Task 12 needs to decide: rename Bob's tooling to `tooling/bob-eslint` etc. (preserve namespace) or merge configs. Given Bob's tooling uses `@bob/*` namespace, simple rename → `tooling/bob-*/` keeps namespaces clean and avoids conflict.

---

## Bob `pnpm-workspace.yaml` (verbatim)

```yaml
packages:
  - apps/*
  - packages/*
  - tooling/*

catalog:
  '@better-auth/cli': 1.4.0-beta.9
  '@better-auth/expo': 1.4.0-beta.9
  '@eslint/js': ^9.38.0
  '@tailwindcss/postcss': 4.1.18
  '@tailwindcss/vite': ^4.1.16
  '@tanstack/react-form': ^1.23.8
  '@tanstack/react-query': ^5.90.8
  '@trpc/client': ~11.7.2
  '@trpc/server': ~11.7.2
  '@trpc/tanstack-react-query': ~11.7.2
  '@types/node': ^22.18.12
  '@types/ws': ^8.18.1
  '@vitejs/plugin-react': 5.1.0
  better-auth: 1.4.0-beta.9
  eslint: ^9.38.0
  node-pty: ^1.0.0
  prettier: ^3.6.2
  superjson: 2.2.3
  tailwindcss: 4.1.18
  tsup: ^8.5.0
  tsx: ^4.19.0
  typescript: ^5.9.3
  vite: 7.1.12
  ws: ^8.18.0
  zod: ^4.1.12

catalogs:
  react19:
    '@types/react': ~19.1.17
    '@types/react-dom': ~19.1.0
    react: 19.2.5
    react-dom: 19.2.5

linkWorkspacePackages: true

onlyBuiltDependencies:
  - '@tailwindcss/oxide'
  - electron
  - esbuild
  - node-pty
  - sqlite3

overrides:
  '@types/minimatch': 5.1.2
  lightningcss: 1.30.1
  vite: 7.1.12
  zod: ^4.1.12

publicHoistPattern:
  - '@ianvs/prettier-plugin-sort-imports'
  - prettier-plugin-tailwindcss
```

## gmacko `pnpm-workspace.yaml` (current)

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tooling/*"
```

## Workspace merge analysis

**Globs:** identical (`apps/*`, `packages/*`, `tooling/*`). No merge work needed for the `packages:` field itself — Task 12's copies will land under existing globs.

**Catalog:** gmacko has none today. Bob's `catalog:` and `catalogs:` blocks must be merged into gmacko's workspace (otherwise `catalog:` references in Bob's copied package.json files will break resolution). Task 12 must:
- Verify no version conflicts with gmacko's existing direct deps (e.g., `react`, `tailwindcss`, `zod`) — if gmacko already pins different versions in individual `package.json` files, decide which wins.
- Copy Bob's catalog blocks verbatim as the simplest path.

**`linkWorkspacePackages: true`:** Bob enables this; gmacko doesn't set it (defaults to `true` in pnpm 10). Add to gmacko's workspace yaml for explicitness.

**`onlyBuiltDependencies`:** Bob has 5 entries. gmacko's root `package.json` has its own `pnpm.onlyBuiltDependencies`; Task 12 should union the lists. Bob's set: `@tailwindcss/oxide`, `electron`, `esbuild`, `node-pty`, `sqlite3`. (Bob root `package.json` adds another set: `electron`, `node-pty`, `@swc/core`.)

**`overrides` (workspace-level):** `@types/minimatch: 5.1.2`, `lightningcss: 1.30.1`, `vite: 7.1.12`, `zod: ^4.1.12`. Need to merge with gmacko's existing `pnpm.overrides` (currently in `package.json`).

**`publicHoistPattern`:** `@ianvs/prettier-plugin-sort-imports`, `prettier-plugin-tailwindcss`. gmacko doesn't set this; merge in.

## Bob root `package.json` `pnpm` section

```json
"pnpm": {
  "overrides": {
    "@types/pg": "8.16.0",
    "node-gyp": "^10.0.0",
    "react": "19.2.5",
    "react-dom": "19.2.5"
  },
  "onlyBuiltDependencies": [
    "electron",
    "node-pty",
    "@swc/core"
  ]
}
```

These overrides (esp. `react: 19.2.5` + `react-dom: 19.2.5`) are load-bearing for Bob's React 19 alignment with `catalog:react19`. Must merge into gmacko's root `package.json` `pnpm.overrides`. No `peerDependencyRules` block.

---

## Test results

**Methodology:** `pnpm -r --workspace-concurrency=1 --no-bail --filter '@bob/*' run test` from `/Volumes/dev/bob`. (Bob has no top-level `pnpm test` script and no `test` task in `turbo.json`; running per-package with `--no-bail` is the equivalent.)

**Per-package summary (passes / fails / skipped by file count):**

| Package | Test Files | Tests | Status |
|---------|-----------|-------|--------|
| `@bob/auth` | 1/1 passed | 5/5 passed | clean |
| `@bob/agent-toolkit` | 1/1 passed | 25/25 passed | clean |
| `@bob/db` | 5/5 passed | 15/15 passed | clean |
| `@bob/mcp-server` | 5/5 passed | 65/65 passed | clean |
| `@bob/notifications` | 2/2 passed | 5/5 passed | clean |
| `@bob/execution` (apps/execution) | **1 FAILED** / 9 passed (10 total) | **1 FAILED** / 32 passed (33 total) | **RED** |
| `@bob/server` (apps/bob-server) | 5/5 passed (1 file skipped) | 40 passed (1 skipped) | clean |
| `@bob/desktop` | 2/2 passed | 5/5 passed | clean |
| `@bob/api` | **5 FAILED** / 43 passed (48 total) | **5 FAILED** / 365 passed / 1 skipped (371 total) | **RED** |
| `@bob/work-items` | 8/8 passed | 20/20 passed | clean |
| `@bob/ws-gateway` (apps/ws-gateway) | 3/3 passed (1 file skipped) | 10 passed (1 skipped) | clean |

Other packages (e.g., `@bob/blder`, `@bob/desktop`'s electron pre-build) have no `test` script or `passWithNoTests`.

**Aggregate: 6 failed / ~592 passed across 11 test-running packages.**

### Failure detail

#### Failure 1: `@bob/execution` (apps/execution) — `src/runtime/taskExecutor.test.ts`

```
× wires smol-agent launch profiles into executeTask
  AssertionError: expected 'import { and, desc, eq } from "@bob/d…' to contain 'buildSmolAgentTaskExecutionProfile'
```

The test reads `taskExecutor.ts` as a string and asserts it contains literal symbols (`buildSmolAgentTaskExecutionProfile`, `selectedAgent === "smol-agent"`, `buildSmolAgentLaunchEnv`, `env: launchEnv`). Current `taskExecutor.ts` contains zero matches for `buildSmolAgent*`. The test was added in commit `4d0e22f` ("feat: add smol-agent as Bob runtime with ACP gateway adapter") with assertions that don't match the code in the same commit. **Pre-existing, brittle source-text assertion** — not a regression introduced by anything we've done in gmacko.

#### Failure 2-3: `@bob/api` — `src/router/__tests__/cookies.test.ts`

```
× cookies router > import > should encrypt and store cookies for a domain
  AssertionError: expected [ 'github.com' ] to deeply equal [ '.github.com' ]
× cookies router > setSessionScopes > should set scopes and return count
```

Domain-normalization mismatch (leading-dot handling). Real assertion failure, not flake.

#### Failure 4: `@bob/api` — `src/router/__tests__/featureBranch.test.ts`

```
× featureBranch router > markTaskPRMerged > sets mergedAt timestamp
```

Likely a timestamp/state assertion — needs deeper look to characterize.

#### Failure 5-6: `@bob/api` — `src/router/__tests__/work-items.test.ts`

```
× workItems router > replaces the current artifact for a role and keeps history
× workItems router > rejects artifact creation when the caller is not a member of the work item's workspace
```

Authorization / artifact-history assertions.

### Test failure root-cause assessment

- All 6 failures are **pre-existing at Bob HEAD**. Bob's tree is clean (no WIP), our worktree at `/Users/mackieg/.config/superpowers/worktrees/gmacko/phase-7b-foundation/` is a separate path that hasn't touched `/Volumes/dev/bob/`.
- The `@bob/execution` failure is a brittle source-text assertion (non-functional, would always fail without code changes inside `apps/execution`).
- The 5 `@bob/api` failures appear to be real router/integration tests that happen to be red on the current branch — a known-bad baseline upstream.

---

## Anomalies & risks for Task 11/12

1. **`apps/web` has no `package.json`** — confirmed dead code. Plan correctly excludes it from copy. (Confirms plan's prediction.)
2. **Bob has 25 packages, plan said ~27** — minor over-estimate; the per-package mapping in Task 12 should iterate the actual list above.
3. **Name-vs-directory mismatches** to preserve verbatim:
   - `packages/bob/` ships `bob` (no namespace)
   - `packages/execution/` ships `@bob/execution-lib`
   - `packages/bob-agent-toolkit/` ships `@bob/agent-toolkit`
4. **6 pre-existing test failures.** Copying Bob as-is reproduces them in gmacko. Three options:
   - **Option A (recommended):** Faithful copy. Document the red baseline in Task 13's verification doc and treat fixing them as out-of-scope for Phase 7B-1a (they're Bob's tech debt, not gmacko's). Phase 7B-2+ can address.
   - **Option B:** Skip the failing tests (`it.skip`) before copy. Adds a transient diff to Bob — violates "read-only" in spirit of Task 10 but keeps gmacko's CI green.
   - **Option C:** Fix the 6 tests at Bob HEAD first, get a green baseline, then copy. Highest fidelity, slowest path; expands Task 10 scope significantly.
5. **`@bob/blder` uses floating versions (`vinext: latest`, `vite: latest`, `wrangler: latest`).** Task 12 should pin these to the resolved versions in Bob's lockfile to avoid surprise upgrades during the copy.
6. **Catalog merge required** — Bob's `package.json` files use `catalog:` and `catalog:react19` references. gmacko's workspace yaml has no catalog blocks. **Task 12 will fail outright if it copies Bob's package.json files without first merging the catalog into gmacko's `pnpm-workspace.yaml`.** This is the highest-priority sequencing item.
7. **Tooling-namespace overlap.** gmacko has `@gmacko/tsconfig` in `tooling/typescript/`; Bob has `@bob/tsconfig` in `tooling/typescript/`. Recommend renaming Bob's tooling dirs on copy → `tooling/bob-eslint/`, `tooling/bob-prettier/`, `tooling/bob-tailwind/`, `tooling/bob-tsconfig/`, `tooling/bob-github/` (preserves `@bob/*` package names; avoids dir collision).
8. **Bob `package.json` has top-level `dependencies` (`@types/dagre`, `dagre`)** — unusual for a monorepo root. Likely consumed by a workspace package via hoist. Need to verify nothing in `@bob/blder` or others breaks if the root deps aren't reproduced in gmacko's root.
9. **Floating Cloudflare/Vinext deps.** `@bob/blder` deps: `vinext: latest`, `@cloudflare/vite-plugin: latest`, `@vitejs/plugin-rsc: latest`, `vite: latest`, `wrangler: latest`. These will be a Cloudflare/edge-deploy concern in Phase 7B-2; for Task 12 just copy as-is and let `pnpm install` resolve from Bob's lockfile or pin to `pnpm-lock.yaml` versions.
10. **Bob root `pnpm.onlyBuiltDependencies` differs from workspace-level `onlyBuiltDependencies`.** Root has `electron`, `node-pty`, `@swc/core`. Workspace yaml has `@tailwindcss/oxide`, `electron`, `esbuild`, `node-pty`, `sqlite3`. Union: `@swc/core`, `@tailwindcss/oxide`, `electron`, `esbuild`, `node-pty`, `sqlite3`. Merge both into gmacko's equivalents.

---

## Recommendation for Task 11

**Proceed with copy under Option A (faithful copy, accept red baseline)** subject to user confirmation on the 6 failing tests.

**Pre-flight for Task 11/12:**
1. **Before** rsyncing any `package.json`, merge Bob's `catalog:` + `catalog:react19` blocks into gmacko's `pnpm-workspace.yaml` (else `pnpm install` post-copy will explode on unresolved `catalog:` refs).
2. Merge Bob's `pnpm-workspace.yaml` `overrides` + `onlyBuiltDependencies` + `publicHoistPattern` + `linkWorkspacePackages` into gmacko's workspace yaml.
3. Merge Bob's root `pnpm.overrides` (esp. `react: 19.2.5`, `react-dom: 19.2.5`) into gmacko's root `package.json` `pnpm.overrides`.
4. Rename Bob tooling dirs on copy: `tooling/eslint/` → `tooling/bob-eslint/` etc. Preserve internal `@bob/*` package names.
5. Copy `apps/blder/`, `apps/bob-server/`, `apps/desktop/`, `apps/execution/`, `apps/mobile/`, `apps/ws-gateway/` to plan's target names. **Skip** `apps/web/` entirely.
6. Copy all 25 `packages/*` verbatim with `@bob/*` namespace preserved.
7. Run `pnpm install` from gmacko root and verify lockfile resolves cleanly.
8. Run the per-package test suite again — expect the **same 6 failures** as documented above. Anything else is a copy bug.

**Stop conditions if encountered during Task 11/12:**
- More than 6 test failures post-copy → copy artifact (path resolution, hoisting, missing dep).
- `pnpm install` fails with unresolved `catalog:` refs → catalog merge missed step (1) above.
- Different test failures than the 6 documented → environmental difference, investigate before continuing.

---

*Probe by Task 10. Source: `/Volumes/dev/bob/` at SHA `0aa466ad057e45ab28ac1d12ea765d1a703f18ef`. Probe destination: `phase-7b-foundation` worktree.*
