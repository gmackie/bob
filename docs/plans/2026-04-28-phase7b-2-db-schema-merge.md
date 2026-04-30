# Phase 7B-2 — DB Schema Merge

**Date:** 2026-04-28
**Branch:** `phase-7b-2-db-merge`
**Worktree:** `~/.config/superpowers/worktrees/gmacko/phase-7b-2-db-merge`
**Base:** `41fe0c4` (master, post phase-7b-foundation merge)

## Goal

Break Bob's 2824-line monolithic `packages/bob/src/db/src/schema.ts`
(62 tables) plus `auth-schema.ts` (4 tables) into co-located
`packages/bob/src/<area>/schema.ts` files — per Tenet #9 from the
foundation plan ("Drizzle schemas co-located with services").

Gmacko's schemas already follow this layout under
`packages/core/src/db/schema/<area>.ts`; this phase brings Bob's tree
into alignment.

**Greenfield**: no data migration. Bob and gmacko apps target separate
databases. Table-name collisions (apiKeys, deviceCodes, projects,
sessions) stay siloed in their respective DBs until 7B-3+ retires
Bob's duplicates onto gmacko's canonical versions.

**Mechanical refactor**: zero behavioral change. Bob's 62 schema-import sites (+ 52 operator-imports + 30 client-imports = 144 `@bob/db*` total)
keep working unchanged because `@bob/db/schema` becomes a thin barrel
that re-exports from the new co-located locations.

## Final layout

13 areas owning 65 tables (Post t3-boilerplate dropped, -1 from 66).

| Area pkg | Status | Tables |
|---|---|---|
| `packages/bob/src/auth` | existing | user, session, account, verification (already in `auth-schema.ts`); apiKeys, deviceCodes (move from main) — **6 tables** |
| `packages/bob/src/settings` | existing | userPreferences — **1 table** |
| `packages/bob/src/tenancy` | **new** | tenants, tenantMembers, workspaces, workspaceMembers — **4 tables** |
| `packages/bob/src/projects` | **new** | projects, repositories, discoveredDirs, worktrees, worktreePlans, worktreeLinks — **6 tables** |
| `packages/bob/src/work-items` | existing | workItems, planDrafts, planDraftDependencies, workItemDependencies, dispatchBatches, dispatchItems, requirements, workItemArtifacts, workItemSnapshots, planTaskItems, taskRuns, comments — **12 tables** |
| `packages/bob/src/agents` | existing | agentRuns, runArtifacts, agentInstances, runLifecycleEvents, sessionEvents, sessionConnections, sessionCheckpoints, tokenUsageSessions, instanceUsageSummary, dailyUsageStats, skills, skillExecutions — **12 tables** |
| `packages/bob/src/chat` | **new** | chatConversations, chatMessages, chatAttachments — **3 tables** |
| `packages/bob/src/git` | **new** | pullRequests, prReviews, featureBranches, featureBranchTaskPRs, gitCommits, gitProviderConnections — **6 tables** |
| `packages/bob/src/webhooks` | **new** | webhookConfigs, webhookDeliveries — **2 tables** |
| `packages/bob/src/ci` | **new** | forgeRevisions, forgeBuilds, forgeDeployments, forgeRunEvents — **4 tables** |
| `packages/bob/src/notifications` | existing | notifications, devicePushTokens, eventLog, activities — **4 tables** |
| `packages/bob/src/cookies` | existing | browserCookies, sessionCookieScopes — **2 tables** |
| `packages/bob/src/secrets` | **new** | sessionSecrets, sessionSecretUsages, projectDeploySecretBindings — **3 tables** |

**7 new packages**: tenancy, projects, chat, git, webhooks, ci, secrets.
**Dropped**: `Post` (t3 boilerplate, never used).

## `@bob/db/schema` after the split

Becomes a thin barrel:

```ts
// packages/bob/src/db/src/schema.ts
export * from "@bob/auth/schema";
export * from "@bob/settings/schema";
export * from "@bob/tenancy/schema";
export * from "@bob/projects/schema";
export * from "@bob/work-items/schema";
export * from "@bob/agents/schema";
export * from "@bob/chat/schema";
export * from "@bob/git/schema";
export * from "@bob/webhooks/schema";
export * from "@bob/ci/schema";
export * from "@bob/notifications/schema";
export * from "@bob/cookies/schema";
export * from "@bob/secrets/schema";
```

All 114 existing import sites that read `from "@bob/db/schema"` keep
working unchanged.

## Migrations

Bob's existing migrations under `packages/bob/src/db/src/migrations/`
are **left untouched**. Greenfield means new Bob deployments get a
single combined initial migration produced by drizzle-kit from the new
schema layout; existing developer environments using PGlite re-init
from scratch. Migration generation is out of scope for 7B-2 — that
lands in 7B-3 (Auth migration) when Bob's auth flips to gmacko's.

## Constraints

- Each new area pkg is a workspace member with `name: "@bob/<area>"`,
  `package.json` exports `./schema` only (no service code yet).
- Each new area pkg has its own `tsconfig.json` extending `@bob/tsconfig`.
- No service code moves in this phase. Only schemas + the barrel.
- Bob's `packages/bob/src/db/src/auth-schema.ts` content moves into
  `packages/bob/src/auth/src/schema.ts`. The `auth-schema.ts` file is
  deleted; `db/index.ts` updated to re-export from the new location.
- The 114 `from "@bob/db/schema"` import sites stay unchanged. The 0 `from "@bob/db"`
  imports that touch tables directly (we'll spot-check) also stay
  unchanged unless they're using something the barrel doesn't re-export.
- No drizzle-kit migration generation. Schema files MOVE; column types,
  defaults, FKs preserved verbatim.
- All `@bob/api` tests stay at the same pass/fail count.
- Smoke (apps/core) stays 9/9.
- @gmacko/core tests stay 347/347.

## Tasks

### Task 0 — Baseline

1. Run the full sweep, capture: per-package test counts, the 114
   import-site count, the @bob/db typecheck status. Doc to
   `docs/plans/phase-7b-2/00-baseline.md`.

### Tasks 1–7 — Create 7 new area packages (one per task)

For each new area: tenancy, projects, chat, git, webhooks, ci, secrets:

1. Create `packages/bob/src/<area>/` with: `package.json` (name
   `@bob/<area>`, exports `./schema`), `tsconfig.json`, `src/schema.ts`
   (initially empty barrel), `src/index.ts` (re-exports from schema).
2. Update `pnpm-workspace.yaml` if not already covered by the
   `packages/bob/src/*` glob (it is — verified during 7B-1a).
3. Add `@bob/<area>: workspace:*` to `packages/bob/src/db/package.json`
   dependencies so the barrel can re-export.
4. `pnpm install`. Verify `@gmacko/bob#typecheck` stays green (empty
   barrels are valid no-ops).

These can each be done as one small commit. **Parallel-safe** — each
new pkg is its own dir, no shared files except `pnpm-workspace.yaml`
(unchanged) and `packages/bob/src/db/package.json` (one consolidated
edit at the end of these 7 tasks).

### Tasks 8–20 — Move tables, area by area (one task per area)

Order chosen to minimize cross-area FK pain: areas with the most
inbound foreign keys first (tenancy, projects, work-items, agents),
then dependents.

Each task:

1. Identify the table block in
   `packages/bob/src/db/src/schema.ts` (line numbers in the probe
   output).
2. **Cut** the table definitions (and any helpers used by them) into
   `packages/bob/src/<area>/src/schema.ts`. Preserve verbatim — no
   column changes, no rename.
3. Add necessary `import` statements at the top of the new
   `<area>/schema.ts` (imports from `drizzle-orm/pg-core` and any
   cross-area FK imports).
4. Update the barrel `packages/bob/src/db/src/schema.ts` to re-export
   from `@bob/<area>/schema` (replacing the inline definitions just
   removed).
5. Run `@bob/db` and `@bob/api` typecheck — both must stay green.
6. Run `@bob/api` tests — count must stay at `370 passed | 1 skipped`
   plus the 2 documented suite-level DATABASE_URL gates.
7. Commit with message `refactor(bob): move <area> tables to @bob/<area>/schema (Phase 7B-2 Task N)`.

The 13 area-move tasks in order:

| Task | Area | Tables | Notes |
|---|---|---|---|
| 8 | tenancy | 4 | Most-FK'd; do first |
| 9 | auth | 2 (move apiKeys, deviceCodes) + relocate auth-schema.ts | Delete auth-schema.ts |
| 10 | settings | 1 | userPreferences |
| 11 | projects | 6 | Includes worktrees, worktreePlans, worktreeLinks |
| 12 | work-items | 12 | Largest area |
| 13 | agents | 12 | Includes session* and skills |
| 14 | chat | 3 | |
| 15 | git | 6 | |
| 16 | webhooks | 2 | |
| 17 | ci | 4 | forge* tables |
| 18 | notifications | 4 | |
| 19 | cookies | 2 | |
| 20 | secrets | 3 | |

### Task 21 — Drop `Post` table

Delete the `Post` table definition (lines 8-26 of original schema.ts).
Confirm zero references in source. Commit.

### Task 22 — Wire `apps/bob/drizzle.config.ts`

Verify the drizzle-kit config still resolves all schemas via the barrel.
Update `out` path or `schema` glob if needed. Run
`pnpm --filter @bob/db drizzle-kit check` (or equivalent).

### Task 23 — Final verification + doc

1. Re-run full sweep:
   `pnpm exec turbo run test --concurrency=1 --continue -- --no-file-parallelism`
2. Confirm: 24/26 turbo tasks green (the 2 documented DATABASE_URL gates
   remain).
3. Confirm: smoke 9/9, @gmacko/core 347/347, @gmacko/ooda 8/8.
4. Confirm: 62 schema-import sites (+ 52 operator-imports + 30 client-imports = 144 `@bob/db*` total) still resolve.
5. Write `docs/plans/phase-7b-2/01-merge-complete.md` recording final
   state, per-area table counts, line counts moved.
6. Tag `phase-7b-2-db-merge-complete`.

## Risk / unknowns

- **54 `relations(...)` blocks** in the monolith. Each declares cross-
  table relationships. When tables move, the matching relations block
  moves with them. Relations that span new areas (e.g. `agentRunsRelations`
  references `workItems`) need cross-area imports added. Mitigation:
  typecheck after each move catches missing imports.
- **~20 `pgEnum` declarations** are co-located near their primary tables
  in the current monolith. Each enum moves with its primary table. Enums
  used by multiple areas (uncommon — verify per-task) duplicate or hoist
  to a shared `packages/bob/src/db/src/shared-enums.ts` only if needed.
- **Cross-area FKs**: Drizzle FK references work via JS object reference,
  not string names — cross-area imports must be added carefully (e.g.
  `taskRuns.workItemId → workItems.id` requires
  `import { workItems } from "@bob/work-items/schema"` from the
  agents area). Mitigation: typecheck after each move.
- **`@bob/db` (not `/schema`) barrel** only re-exports drizzle-orm
  operators (and, eq, sql, etc.) — no table re-exports. Verified at
  `packages/bob/src/db/src/index.ts`. Stays unchanged.
- **`auth-schema.ts` deletion**: file is imported only by the
  monolithic `schema.ts` itself (verified). Once auth tables move into
  `@bob/auth/schema` and the barrel re-exports from there, the file is
  safe to delete.

## Workflow

Per `subagent-driven-development`:

- Each Task gets a fresh subagent.
- Each commit gets a code review subagent before moving to next.
- Tasks 1–7 (new pkg creation) can run as a single batch since they're
  isolated.
- Tasks 8–20 must run sequentially because they share the barrel file
  (`packages/bob/src/db/src/schema.ts`).
- Final tag + doc happens in main session.

## Out of scope

- Drizzle-kit migration generation (deferred to 7B-3).
- Renaming tables (Bob keeps `api_keys`/`device_codes`/etc. as physical
  table names; collision with gmacko's same-named tables is OK because
  separate DBs).
- Moving service code into the new area pkgs.
- Wiring `@gmacko/bob` namespace; the package shell stays a barrel-only
  re-exporter; this phase doesn't change which physical packages are
  workspace members.
