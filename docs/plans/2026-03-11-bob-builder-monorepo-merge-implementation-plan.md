# Bob Builder Monorepo Merge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge the current Bob and Kanbanger codebases into one Bob-branded monorepo with a single web app, a single mobile app, a shared database schema, a shared auth/permission model, and Bob task execution built in as an internal service.

**Architecture:** Use Bob's monorepo as the destination. Replace the current cross-app integration architecture with first-party codepaths. Standardize on `apps/web`, `apps/mobile`, and `apps/execution`, one product-facing tRPC API, Kanbanger's auth/workspace model, a typed `work_items` schema, and task-scoped Bob execution sessions.

**Tech Stack:** Turborepo, pnpm workspaces, Next.js App Router, Expo/React Native, tRPC, Drizzle ORM, Postgres/Neon, Bob execution/worktree services, realtime/notifications packages.

## Before starting

1. Work from `/Volumes/dev/bob` as the destination monorepo.
2. Treat `/Volumes/dev/linear-clone` as the source tree to copy from; do not try to preserve git history.
3. Keep commits small and repo-local to `/Volumes/dev/bob`.
4. Follow `@superpowers:test-driven-development` for feature work where tests already exist or are easy to add.
5. Use temporary compatibility adapters only when needed to keep the tree building between phases. Delete them as soon as the replacement path is live.

## Task 1: Normalize the monorepo root for the merged app/service layout

**Files:**
- Modify: `/Volumes/dev/bob/pnpm-workspace.yaml`
- Modify: `/Volumes/dev/bob/turbo.json`
- Modify: `/Volumes/dev/bob/package.json`
- Create: `/Volumes/dev/bob/apps/web/package.json`
- Create: `/Volumes/dev/bob/apps/mobile/package.json`
- Create: `/Volumes/dev/bob/apps/execution/package.json`

**Step 1: Write the failing workspace validation**

Run:

```bash
pnpm -C /Volumes/dev/bob install --frozen-lockfile
```

Expected: FAIL or no-op against the desired target because `apps/web`, `apps/mobile`, and `apps/execution` do not exist yet as workspace packages.

**Step 2: Create the target workspace entries**

Update `/Volumes/dev/bob/pnpm-workspace.yaml` so the workspace explicitly covers:

```yaml
packages:
  - apps/*
  - packages/*
  - tooling/*
```

Create minimal `package.json` stubs for:

- `/Volumes/dev/bob/apps/web/package.json`
- `/Volumes/dev/bob/apps/mobile/package.json`
- `/Volumes/dev/bob/apps/execution/package.json`

Use Bob-branded names, for example:

```json
{
  "name": "@bob/web",
  "private": true
}
```

**Step 3: Update Turbo pipeline roots**

Edit `/Volumes/dev/bob/turbo.json` so build, typecheck, lint, and test pipelines include the new app names and no longer assume `apps/nextjs` or `apps/expo` are the final product targets.

**Step 4: Run workspace validation**

Run:

```bash
pnpm -C /Volumes/dev/bob install
pnpm -C /Volumes/dev/bob exec turbo run typecheck --filter=@bob/web --dry=json
```

Expected: PASS, with the new workspace packages discoverable.

**Step 5: Commit**

```bash
git -C /Volumes/dev/bob add pnpm-workspace.yaml turbo.json package.json apps/web/package.json apps/mobile/package.json apps/execution/package.json
git -C /Volumes/dev/bob commit -m "chore(monorepo): add merged app and service workspace roots"
```

## Task 2: Move Bob web into `apps/web` and Bob Expo into `apps/mobile`

**Files:**
- Move: `/Volumes/dev/bob/apps/nextjs` -> `/Volumes/dev/bob/apps/web`
- Move: `/Volumes/dev/bob/apps/expo` -> `/Volumes/dev/bob/apps/mobile`
- Modify: `/Volumes/dev/bob/apps/web/package.json`
- Modify: `/Volumes/dev/bob/apps/mobile/package.json`
- Modify: `/Volumes/dev/bob/apps/web/tsconfig.json`
- Modify: `/Volumes/dev/bob/apps/mobile/tsconfig.json`
- Modify: `/Volumes/dev/bob/apps/web/next.config.*`
- Modify: `/Volumes/dev/bob/apps/mobile/app.json` or `/Volumes/dev/bob/apps/mobile/app.config.*`

**Step 1: Write the failing app-resolution check**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/nextjs typecheck
pnpm -C /Volumes/dev/bob --filter @bob/expo typecheck
```

Expected: PASS before the move, establishing the baseline package identities that will be replaced.

**Step 2: Move the directories**

Rename:

- `/Volumes/dev/bob/apps/nextjs` to `/Volumes/dev/bob/apps/web`
- `/Volumes/dev/bob/apps/expo` to `/Volumes/dev/bob/apps/mobile`

Update package names to:

- `@bob/web`
- `@bob/mobile`

**Step 3: Fix path and script references**

Update references in:

- root scripts
- Turbo filters
- Playwright config
- Expo/Metro config
- any docs/scripts pointing at `apps/nextjs` or `apps/expo`

**Step 4: Run verification**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/web typecheck
pnpm -C /Volumes/dev/bob --filter @bob/mobile typecheck
```

Expected: PASS with the moved apps.

**Step 5: Commit**

```bash
git -C /Volumes/dev/bob add apps/web apps/mobile pnpm-workspace.yaml turbo.json package.json
git -C /Volumes/dev/bob commit -m "refactor(apps): move Bob web and mobile to merged app paths"
```

## Task 3: Add the execution service app and move long-running runtime code into it

**Files:**
- Create: `/Volumes/dev/bob/apps/execution/src/index.ts`
- Create: `/Volumes/dev/bob/apps/execution/src/config.ts`
- Create: `/Volumes/dev/bob/apps/execution/tsconfig.json`
- Modify: `/Volumes/dev/bob/apps/execution/package.json`
- Move or copy from: `/Volumes/dev/bob/apps/gateway/src/**`
- Move or copy from: `/Volumes/dev/bob/packages/mcp-server/src/**`
- Modify: `/Volumes/dev/bob/packages/execution/**` if created in later tasks

**Step 1: Write the failing service smoke test**

Create a minimal startup test or script entry for `apps/execution` and run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/execution typecheck
```

Expected: FAIL because the app does not exist yet.

**Step 2: Create the service app**

Add:

- `package.json` scripts for `dev`, `build`, `typecheck`
- `src/index.ts`
- configuration loading
- a small boot path that wires the execution runtime without product UI code

**Step 3: Move runtime responsibilities**

Move long-running responsibilities out of old product-facing app code into `apps/execution`, including:

- task/session orchestration
- worktree coordination
- execution polling
- internal MCP or agent runtime hosting that should not live in the web request path

**Step 4: Run verification**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/execution typecheck
pnpm -C /Volumes/dev/bob --filter @bob/execution build
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/bob add apps/execution apps/gateway packages/mcp-server
git -C /Volumes/dev/bob commit -m "feat(execution): add dedicated execution service app"
```

## Task 4: Copy Kanbanger web and mobile code into staging locations inside Bob

**Files:**
- Create: `/Volumes/dev/bob/_merge/kanbanger-web/**`
- Create: `/Volumes/dev/bob/_merge/kanbanger-mobile/**`
- Create: `/Volumes/dev/bob/_merge/kanbanger-packages/**`
- Source: `/Volumes/dev/linear-clone/apps/web/**`
- Source: `/Volumes/dev/linear-clone/apps/mobile/**`
- Source: `/Volumes/dev/linear-clone/packages/**`

**Step 1: Record a failing import reference**

Create a temporary checklist file in the plan or local notes showing the source directories that still live only in `/Volumes/dev/linear-clone`.

Expected: no code yet in Bob for those modules.

**Step 2: Copy the source trees**

Copy, do not move:

- `/Volumes/dev/linear-clone/apps/web`
- `/Volumes/dev/linear-clone/apps/mobile`
- `/Volumes/dev/linear-clone/packages/api`
- `/Volumes/dev/linear-clone/packages/db`
- `/Volumes/dev/linear-clone/packages/auth`
- `/Volumes/dev/linear-clone/packages/realtime`
- `/Volumes/dev/linear-clone/packages/notifications`
- any additional package needed for planning/mobile UX

Place them under `_merge/` in Bob first so they can be diffed and mined without immediately colliding with existing package paths.

**Step 3: Verify copied code is present**

Run:

```bash
find /Volumes/dev/bob/_merge -maxdepth 2 -type d | sort
```

Expected: copied staging trees visible.

**Step 4: Commit**

```bash
git -C /Volumes/dev/bob add _merge
git -C /Volumes/dev/bob commit -m "chore(merge): import Kanbanger source trees for consolidation"
```

## Task 5: Converge shared package names and delete app-local UI package assumptions

**Files:**
- Modify: `/Volumes/dev/bob/apps/web/package.json`
- Modify: `/Volumes/dev/bob/apps/mobile/package.json`
- Modify: `/Volumes/dev/bob/packages/api/package.json`
- Modify: `/Volumes/dev/bob/packages/db/package.json`
- Modify: `/Volumes/dev/bob/packages/auth/package.json`
- Create: `/Volumes/dev/bob/packages/work-items/package.json`
- Create: `/Volumes/dev/bob/packages/agents/package.json`
- Create: `/Volumes/dev/bob/packages/execution/package.json`
- Delete later: `/Volumes/dev/bob/packages/ui/package.json`
- Delete later: `/Volumes/dev/bob/_merge/kanbanger-packages/ui/package.json`
- Delete later: `/Volumes/dev/bob/_merge/kanbanger-packages/ui-native/package.json`

**Step 1: Write the failing dependency-map check**

Run:

```bash
rg -n "@linear-clone|@bob/ui|@linear-clone/ui|@linear-clone/ui-native" /Volumes/dev/bob /Volumes/dev/bob/_merge
```

Expected: many old package references remain.

**Step 2: Create the target shared package set**

Add new package roots where needed:

- `packages/work-items`
- `packages/agents`
- `packages/execution`

Decide which existing packages remain and which get merged or deleted.

**Step 3: Repoint app-local UI ownership**

Update imports so:

- web-specific UI moves under `apps/web/src/components/**`
- native-specific UI moves under `apps/mobile/src/**`
- no new shared `ui` or `ui-native` dependency is introduced in the target architecture

**Step 4: Run verification**

Run:

```bash
pnpm -C /Volumes/dev/bob install
rg -n "@linear-clone" /Volumes/dev/bob
```

Expected: package manifests begin converging; remaining `@linear-clone` hits are intentional migration leftovers.

**Step 5: Commit**

```bash
git -C /Volumes/dev/bob add apps/web apps/mobile packages
git -C /Volumes/dev/bob commit -m "refactor(packages): converge shared package structure for merged product"
```

## Task 6: Standardize on Kanbanger auth and workspace context

**Files:**
- Modify: `/Volumes/dev/bob/packages/auth/src/**`
- Modify: `/Volumes/dev/bob/apps/web/src/app/api/auth/**`
- Modify: `/Volumes/dev/bob/apps/web/src/lib/auth/**`
- Modify: `/Volumes/dev/bob/apps/mobile/src/**`
- Source references: `/Volumes/dev/bob/_merge/kanbanger-packages/auth/src/**`
- Source references: `/Volumes/dev/bob/_merge/kanbanger-web/src/lib/auth/**`

**Step 1: Write the failing auth-context test**

Create or extend tests proving the app context can resolve:

- user
- workspace
- project membership
- task access

Run the relevant auth tests or typechecks.

Expected: FAIL where Bob-only auth assumptions still exist.

**Step 2: Port Kanbanger auth/session primitives**

Merge in:

- canonical workspace membership resolution
- project access checks
- session/user context used by both web and mobile

Keep package path under `/Volumes/dev/bob/packages/auth`.

**Step 3: Update app consumers**

Make `apps/web` and `apps/mobile` both consume the same auth/workspace primitives.

**Step 4: Run verification**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/auth typecheck
pnpm -C /Volumes/dev/bob --filter @bob/web typecheck
pnpm -C /Volumes/dev/bob --filter @bob/mobile typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/bob add packages/auth apps/web apps/mobile
git -C /Volumes/dev/bob commit -m "feat(auth): standardize merged app on workspace auth model"
```

## Task 7: Replace separate issue/task models with typed `work_items`

**Files:**
- Modify: `/Volumes/dev/bob/packages/db/src/schema.ts`
- Modify: `/Volumes/dev/bob/packages/db/src/index.ts`
- Modify: `/Volumes/dev/bob/packages/db/drizzle.config.ts`
- Create: `/Volumes/dev/bob/packages/db/drizzle/000X_work_items.sql`
- Create: `/Volumes/dev/bob/packages/work-items/src/index.ts`
- Create: `/Volumes/dev/bob/packages/work-items/src/types.ts`
- Create: `/Volumes/dev/bob/packages/work-items/src/conversions.ts`
- Source references: `/Volumes/dev/bob/_merge/kanbanger-packages/db/src/schema.ts`

**Step 1: Write the failing schema tests**

Add DB-level or package-level tests for:

- `work_items.kind` in `issue | epic | task`
- parent-child relationships
- task-only execution eligibility
- issue-to-task conversion helper behavior

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/db typecheck
```

Expected: FAIL until the schema and types are added.

**Step 2: Add the schema**

Introduce a canonical `work_items` table or equivalent replacement in `/Volumes/dev/bob/packages/db/src/schema.ts`.

Minimum shape:

```ts
export const workItemKindEnum = pgEnum("work_item_kind", ["issue", "epic", "task"]);
```

Include:

- project/workspace linkage
- parent linkage
- title/description/status fields
- creator/assignee linkage as appropriate
- timestamps

**Step 3: Add domain helpers**

In `packages/work-items`, add helpers for:

- determining executability
- converting/promoting issue -> task
- resolving parent context

**Step 4: Run verification**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/db typecheck
pnpm -C /Volumes/dev/bob --filter @bob/work-items typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/bob add packages/db packages/work-items
git -C /Volumes/dev/bob commit -m "feat(db): add typed work items model"
```

## Task 8: Consolidate comments, notifications, and artifacts onto the merged work model

**Files:**
- Modify: `/Volumes/dev/bob/packages/db/src/schema.ts`
- Modify: `/Volumes/dev/bob/packages/api/src/routers/**`
- Modify: `/Volumes/dev/bob/packages/notifications/src/**`
- Modify: `/Volumes/dev/bob/packages/realtime/src/**`
- Create: `/Volumes/dev/bob/packages/api/src/routers/work-items.ts`
- Source references: `/Volumes/dev/bob/_merge/kanbanger-packages/notifications/src/**`
- Source references: `/Volumes/dev/bob/_merge/kanbanger-packages/realtime/src/**`

**Step 1: Write the failing integration tests**

Add tests covering:

- comments attach to `work_items`
- notifications reference `work_items`
- artifacts attach to `work_items` and optionally task runs
- parent artifact roll-up queries

**Step 2: Implement the unified model**

Update routers and schema so:

- comment APIs resolve by work item
- notification APIs resolve by work item and workspace
- artifact APIs resolve by work item with typed categories

**Step 3: Remove temporary integration projections**

Delete or deprecate fields/tables introduced only for cross-app syncing where first-party joins now replace them.

**Step 4: Run verification**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/api test -- work-items
pnpm -C /Volumes/dev/bob --filter @bob/notifications typecheck
pnpm -C /Volumes/dev/bob --filter @bob/realtime typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/bob add packages/db packages/api packages/notifications packages/realtime
git -C /Volumes/dev/bob commit -m "feat(domain): unify comments notifications and artifacts on work items"
```

## Task 9: Merge Kanbanger planning routes into `apps/web`

**Files:**
- Modify: `/Volumes/dev/bob/apps/web/src/app/**`
- Create: `/Volumes/dev/bob/apps/web/src/components/projects/**`
- Create: `/Volumes/dev/bob/apps/web/src/components/work-items/**`
- Create: `/Volumes/dev/bob/apps/web/src/components/views/**`
- Source references: `/Volumes/dev/bob/_merge/kanbanger-web/src/app/**`
- Source references: `/Volumes/dev/bob/_merge/kanbanger-web/src/components/**`

**Step 1: Write the failing page-level smoke tests**

Add page tests or Playwright coverage for:

- workspace dashboard
- project detail
- work item list/board
- work item detail

Expected: FAIL because those Kanbanger planning surfaces are not yet present in `apps/web`.

**Step 2: Port the planning shell**

Bring over:

- dashboard shell
- project browsing
- list/board views
- work item detail layout
- inbox/notification entry points if already part of the web flow

Do not preserve Kanbanger-specific naming in user-facing UI.

**Step 3: Wire to merged routers**

Update data hooks so all pages read from `/Volumes/dev/bob/packages/api`.

**Step 4: Run verification**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/web typecheck
pnpm -C /Volumes/dev/bob --filter @bob/web test -- projects
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/bob add apps/web packages/api
git -C /Volumes/dev/bob commit -m "feat(web): add planning shell and work item surfaces"
```

## Task 10: Refocus Bob chat into a task-scoped execution workspace route

**Files:**
- Modify: `/Volumes/dev/bob/apps/web/src/app/chat/**`
- Create or modify: `/Volumes/dev/bob/apps/web/src/app/tasks/[taskId]/workspace/**`
- Modify: `/Volumes/dev/bob/apps/web/src/app/(dashboard)/**` if still present
- Modify: `/Volumes/dev/bob/apps/web/src/components/**`

**Step 1: Write the failing workspace-route test**

Add coverage for:

- entering task execution workspace from a task page
- displaying task context in the workspace
- showing CLI/file browser/chat in one route
- hiding obsolete Bob project-management UI

**Step 2: Implement the task-scoped workspace**

Keep:

- chat
- session header
- terminal/CLI
- file browser
- validation/artifact surfaces

Remove or trim:

- Bob-wide project browsing
- any overlapping planning shell elements

**Step 3: Wire to task/work-item context**

Ensure the workspace route is backed by canonical `task` work items and parent context.

**Step 4: Run verification**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/web test:e2e --grep "task workspace"
pnpm -C /Volumes/dev/bob --filter @bob/web typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/bob add apps/web
git -C /Volumes/dev/bob commit -m "feat(web): make Bob execution workspace task-scoped"
```

## Task 11: Merge Kanbanger mobile shell and add Bob task execution screens

**Files:**
- Modify: `/Volumes/dev/bob/apps/mobile/src/**`
- Source references: `/Volumes/dev/bob/_merge/kanbanger-mobile/src/**`
- Source references: `/Volumes/dev/bob/apps/mobile/src/**` from the old Bob Expo app

**Step 1: Write the failing mobile navigation tests**

Add or extend tests for:

- workspace/project/work item navigation
- opening a task detail screen
- opening a task execution/chat screen

Expected: FAIL until the shells are merged.

**Step 2: Port Kanbanger mobile information architecture**

Bring over:

- workspace/project navigation
- list/detail flows
- inbox/notification flows

**Step 3: Port Bob mobile execution surfaces**

Add:

- task chat
- execution status
- artifacts/verification views

Do not recreate Bob desktop-like surfaces on mobile.

**Step 4: Run verification**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/mobile typecheck
pnpm -C /Volumes/dev/bob --filter @bob/mobile test
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/bob add apps/mobile
git -C /Volumes/dev/bob commit -m "feat(mobile): merge planning and task execution mobile flows"
```

## Task 12: Collapse to one product-facing API router

**Files:**
- Modify: `/Volumes/dev/bob/packages/api/src/router/**`
- Modify: `/Volumes/dev/bob/packages/api/src/index.ts`
- Modify: `/Volumes/dev/bob/apps/web/src/app/api/trpc/**`
- Modify: `/Volumes/dev/bob/apps/mobile/src/**` tRPC client setup
- Source references: `/Volumes/dev/bob/_merge/kanbanger-packages/api/src/**`

**Step 1: Write the failing router-shape test**

Add tests for:

- work item queries/mutations
- project/workspace queries
- task workspace/session queries
- notifications/comments/artifacts flows

Expected: FAIL where Kanbanger and Bob still require separate router concepts.

**Step 2: Merge router modules**

Consolidate onto one app router with clear subrouters such as:

- `workspace`
- `project`
- `workItem`
- `comment`
- `notification`
- `taskRun`
- `session`

**Step 3: Keep execution internals behind service interfaces**

Do not expose all low-level execution controls directly in tRPC just because they exist internally.

**Step 4: Run verification**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/api typecheck
pnpm -C /Volumes/dev/bob --filter @bob/api test
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/bob add packages/api apps/web apps/mobile
git -C /Volumes/dev/bob commit -m "refactor(api): converge on one product-facing app router"
```

## Task 13: Add the database cutover migration and data backfill path

**Files:**
- Modify: `/Volumes/dev/bob/packages/db/src/schema.ts`
- Create: `/Volumes/dev/bob/packages/db/drizzle/000Y_monorepo_cutover.sql`
- Create: `/Volumes/dev/bob/packages/db/src/migrations/work-items-backfill.ts`
- Create: `/Volumes/dev/bob/packages/db/src/migrations/artifact-backfill.ts`
- Create: `/Volumes/dev/bob/packages/db/src/migrations/session-task-link-backfill.ts`

**Step 1: Write the failing migration verification**

Prepare local seed fixtures or migration tests that assert:

- old issue/task data maps into `work_items`
- Bob session/task-run rows map to `task` work items
- comment/notification/artifact references remain valid

**Step 2: Implement the SQL and backfill scripts**

Write:

- schema DDL migration
- data backfill scripts
- id remapping helpers as needed

Prefer deterministic, rerunnable backfill scripts.

**Step 3: Run verification**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/db typecheck
pnpm -C /Volumes/dev/bob --filter @bob/db exec drizzle-kit generate
pnpm -C /Volumes/dev/bob --filter @bob/db test
```

Expected: PASS.

**Step 4: Commit**

```bash
git -C /Volumes/dev/bob add packages/db
git -C /Volumes/dev/bob commit -m "feat(db): add monorepo cutover migration and backfills"
```

## Task 14: Remove obsolete Bob and Kanbanger surfaces after replacement paths are live

**Files:**
- Delete: `/Volumes/dev/bob/apps/gateway/**` if fully replaced
- Delete: `/Volumes/dev/bob/electron/**`
- Delete: `/Volumes/dev/bob/frontend/**` if obsolete
- Delete: `/Volumes/dev/bob/backend/**` legacy-only code if obsolete
- Delete: `/Volumes/dev/bob/packages/ui/**`
- Delete: `/Volumes/dev/bob/_merge/**` after all needed code is integrated
- Delete: compatibility-only files created during earlier tasks

**Step 1: Write the failing dead-reference check**

Run:

```bash
rg -n "apps/nextjs|apps/expo|@linear-clone|electron|frontend|backend|_merge" /Volumes/dev/bob
```

Expected: remaining hits identify legacy references still in the tree.

**Step 2: Delete dead code**

Only delete surfaces after the replacement path is live and verified.

**Step 3: Run verification**

Run:

```bash
pnpm -C /Volumes/dev/bob typecheck
pnpm -C /Volumes/dev/bob lint
```

Expected: PASS with no references to removed product surfaces.

**Step 4: Commit**

```bash
git -C /Volumes/dev/bob add -A
git -C /Volumes/dev/bob commit -m "refactor(cleanup): remove obsolete pre-merge app surfaces"
```

## Task 15: Add merged end-to-end verification across web, mobile, and execution service

**Files:**
- Modify: `/Volumes/dev/bob/apps/web/e2e/**`
- Modify: `/Volumes/dev/bob/apps/mobile/**` test setup
- Modify: `/Volumes/dev/bob/apps/execution/**` test setup
- Create: merged test fixtures as needed under existing app test directories

**Step 1: Write the end-to-end scenarios**

Add tests for:

1. Create issue -> promote to task
2. Open task -> launch task workspace
3. Agent requests input -> comment reply resolves it
4. Agent produces artifact -> artifact appears on task and parent
5. Task completes -> notifications and status update everywhere
6. Mobile can view task context and interact with execution state

**Step 2: Run targeted suites**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/web test:e2e
pnpm -C /Volumes/dev/bob --filter @bob/mobile test
pnpm -C /Volumes/dev/bob --filter @bob/execution test
```

Expected: PASS.

**Step 3: Commit**

```bash
git -C /Volumes/dev/bob add apps/web apps/mobile apps/execution
git -C /Volumes/dev/bob commit -m "test(e2e): verify merged planning and execution flows"
```

## Final verification

Run:

```bash
pnpm -C /Volumes/dev/bob install
pnpm -C /Volumes/dev/bob typecheck
pnpm -C /Volumes/dev/bob lint
pnpm -C /Volumes/dev/bob build
pnpm -C /Volumes/dev/bob --filter @bob/web test:e2e
pnpm -C /Volumes/dev/bob --filter @bob/mobile test
pnpm -C /Volumes/dev/bob --filter @bob/execution test
```

Expected: PASS.

## Cleanup checklist

Before calling the migration complete, confirm all of the following are true:

1. No product-critical code depends on `/Volumes/dev/linear-clone`.
2. No user-facing surface still requires a Bob-vs-Kanbanger integration bridge.
3. No primary product route still depends on obsolete desktop/Electron code.
4. One auth model, one tRPC router, one database schema, one notification model, and one artifact model are active.
5. Managed execution sessions are task-scoped and backed by canonical `work_items`.
6. The `_merge` staging tree is removed.
