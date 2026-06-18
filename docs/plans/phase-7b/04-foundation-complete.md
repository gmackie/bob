# Phase 7B Foundation — Final Verification

**Date:** 2026-04-28
**Branch:** `phase-7b-foundation`
**Branch SHA at completion (Task 17):** `2dd8aff9bedee3c467dd694d7f20161a8a0d8d87`
**Tag:** `phase-7b-foundation-complete`

This document records the final state of the Phase 7B foundation: 32 leaf
`@gmacko/*` packages collapsed into three namespace shells; Bob's source
tree faithfully copied in; OODA promoted to its own app; `apps/web` →
`apps/core` rename. The two stacks (gmacko Effect-RPC + Bob tRPC/Vite)
coexist unchanged, ready for per-area migrations in 7B-2..N.

## Apps inventory (10 dirs)

| Dir | Stack | Role |
|---|---|---|
| `apps/core/` | gmacko Next.js 16 + Effect-RPC | gmacko reference web app, hosts the `/api/rpc` route + better-auth at `/api/auth/[...all]`, agent harness, smoke test infra. Renamed from `apps/web` in 7B-1b. Package name: `@gmacko/core-web`. |
| `apps/mobile-core/` | gmacko Expo 55 | gmacko reference Expo app. Renamed from `apps/mobile` in 7B-1b. Package name: `@gmacko/core-mobile`. |
| `apps/desktop/` | gmacko Electron | gmacko reference desktop app. |
| `apps/ooda/` | gmacko Next.js 16 | OODA-specific routes (capture/explore/graph/wiki + voice-input). Promoted out of `apps/web` in Task 16. Talks to `apps/core`'s RPC route via `NEXT_PUBLIC_RPC_BASE_URL`; will migrate to its own RPC host later. |
| `apps/bob/` | Vite + CF Workers + React 19 | Bob's main web app. Copied verbatim from `/Volumes/dev/bob/apps/blder` in 7B-1a. |
| `apps/mobile-bob/` | Expo 55 | Bob mobile. Copied verbatim. |
| `apps/desktop-bob/` | Electron 40 | Bob desktop. Copied verbatim. |
| `apps/bob-server/` | Node | Bob's HTTP server. Copied verbatim. |
| `apps/bob-ws-gateway/` | Node WebSocket | Bob's realtime gateway. Copied verbatim. |
| `apps/bob-execution/` | Node task runner | Bob's execution runner. Copied verbatim. |

The user-facing "6 eventual apps" target (`apps/{core, bob, ooda,
mobile-core, mobile-bob, mobile-ooda}`) is not yet at parity:
`mobile-ooda` doesn't exist, and `desktop` / `desktop-bob` plus the three
`bob-*` services live alongside as supporting apps. Per-area migrations
in 7B-2..N will whittle this down.

## Packages inventory (3 namespace shells)

| Package | Role |
|---|---|
| `packages/core/` | All 30 former `@gmacko/*` infrastructure packages collapsed into one shell with subpath exports (`auth`, `db`, `agent`, `contracts`, `client`, `ui`, `app-shell`, `mobile-shell`, `desktop-shell`, `realtime`, `runner-protocol`, `runner-base`, `mcp-server`, `validators`, `config`, `cookies`, `i18n`, `settings`, `secrets`, `projects`, `billing`, `email`, `notifications`, `monitoring`, `analytics`, `storage`, `models`, `agent-toolkit`, `ws-gateway`, `rpc`). |
| `packages/ooda/` | OODA-specific code: wiki article writer, cross-linker, ext stubs. |
| `packages/bob/` | Nested workspace root holding 25 `@bob/*` packages (plus one unscoped `bob`) under `packages/bob/src/<pkg>/`. Workspace glob `packages/bob/src/*` registers each as a leaf. Source preserved unchanged for now. |

## Tooling

- `tooling/typescript`, `tooling/tailwind` — gmacko shared configs.
- `tooling/bob-{typescript,tailwind,eslint,prettier,github}` — Bob's
  tooling, dirs renamed; package names preserved as `@bob/*`.

## Verification results (this commit)

### Typecheck (3/3 green)

```
pnpm exec turbo run typecheck --concurrency=1 \
  --filter=@gmacko/core --filter=@gmacko/ooda --filter=@gmacko/bob
```

3 tasks successful, 3 cached (FULL TURBO). All gmacko package shells
typecheck clean.

### Apps/core smoke (9/9 green)

```
cd apps/core && pnpm test -- smoke
```

9 tests passing in `src/__tests__/smoke.test.ts`. Boots `next dev`
in a temp dir, hits `/api/rpc`, exercises sign-up + sign-in
+ cookie ferrying + agent flow with the mock adapter. The smoke test
discovers its own cwd via `resolve(process.cwd())` so the rename
didn't break its path resolution.

### Gmacko-side test totals

| Package | Files | Tests passing | Tests failing |
|---|---|---|---|
| `packages/core` | 100/101 | 346 | 1 (known: `composer.test.tsx` Chai jsdom matcher; documented carry-forward) |
| `packages/ooda` | 2/2 | 8 | 0 |
| `apps/core` (smoke) | 1/1 | 9 | 0 |
| **Gmacko total** | **103** | **363 passing** | **1 known carry-forward** |

### Workspace-wide test sweep

```
pnpm exec turbo run test --concurrency=1 --continue -- --no-file-parallelism
```

26 tasks total; 21 succeeded; 5 failed:

- `@gmacko/core#test` — 1 known pre-existing failure (composer Chai/jsdom).
- `@gmacko/bob#test` — 5 known pre-existing test files failing
  (`@bob/execution` taskExecutor + `@bob/api` cookies/featureBranch/work-items).
  486 tests in @gmacko/bob: 480 passed, 5 failed, 1 skipped.
- `@bob/execution#test` — pre-existing taskExecutor failures (Bob's
  tech debt; surfaced again at the leaf-package level by the workspace glob).
- `@bob/api#test` — pre-existing cookies/featureBranch/work-items failures.
- `@bob/blder#build` — Bob's Vite/rolldown production build can't
  resolve `@bob/db/schema` etc. when run from the new monorepo root;
  not a test failure, and not in scope for the foundation phase.
  Investigation deferred to the Bob stack rewrite (7B-Bob phase).

The 5 originally-flagged Bob test failures are still present and
unchanged in nature. The 6th pre-existing failure cited in earlier
plans is the same `@bob/api` work-items routing test that fans out into
multiple sub-cases.

## Carry-forward to Phase 7B-2..N

| Item | Where flagged | Phase to land |
|---|---|---|
| 5 pre-existing Bob test failures (`@bob/execution` taskExecutor + `@bob/api` cookies/featureBranch/work-items) | `docs/plans/phase-7b/02-bob-probe.md` | 7B-Bob (per-area) |
| 5 pre-existing OODA route typecheck errors (`graph/page.tsx` readonly tags array, `voice-input.tsx` SpeechRecognition possibly-undefined access) | `apps/core/README.md` Known issues, `apps/core/DEPLOY.md` | 7B-OODA (per-area) |
| 1 pre-existing gmacko core test failure (`packages/core/src/.../composer.test.tsx` Chai/jsdom matcher) | this doc | 7B-2..N when touching the affected component |
| `@bob/eslint-config` typecheck failure due to eslint-plugin-turbo version drift | Phase 7B-1a verification | 7B-Bob tooling sub-phase |
| `@bob/blder` Vite/rolldown production build can't resolve `@bob/db/schema` etc. from the gmacko monorepo root | this doc | 7B-Bob stack rewrite |
| Bob's stack rewrite (Vite → Next.js, tRPC → Effect-RPC, etc.) | plan doc 2026-04-27-phase7b-foundation.md | Later sub-phase |
| Domain service migrations (auth, db, realtime, agent, runner, UI, retire shells) | plan doc | 7B-2..9 |

## Foundation phase tag

```
git tag phase-7b-foundation-complete
```

Tag points at this commit. Together with
`phase-7b-0-consolidation-complete` (mid-foundation, after the 32→3
package collapse), these tags mark the two checkpoints of the
foundation phase.
