# Bob Builder Merge Status And Remaining MVP Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement the remaining tasks in controlled batches.

**Goal:** Finish the Bob + Kanbanger merge into one Bob Builder product with a single web app, a single mobile app, a single database, one auth model, one product-facing API, and a task-scoped execution workspace that is built into the product instead of integrated from the side.

**Architecture:** Bob is now the destination monorepo and product shell. Planning, workspace, project, inbox, and collaboration flows are converging on the former Kanbanger model, while chat, task execution, worktrees, CLI/file-browser flows, and agent orchestration are converging on the former Bob model. The target end state is one Bob Builder product where planning is primary, execution is deeply integrated, and `task` work items are the executable unit.

**Tech Stack:** Turborepo, pnpm workspaces, Next.js App Router, Expo/React Native, tRPC, Drizzle ORM, Postgres, workspace-scoped auth, Bob execution services, normalized work-item/artifact/comment/notification models.

## Purpose Of This Document

This document supersedes the earlier "target-only" merge notes by adding:

1. the finished-product vision we are aiming at,
2. a status snapshot of what has already been implemented,
3. the concrete work that is still required to reach a launchable MVP.

Use this as the current coordination document for the merge.

## Product Vision

Bob Builder should feel like one coherent construction-management product, not "Bob plus Kanbanger" hidden behind shared auth.

### Core product shape

- `issue` is the intake layer for observations, bugs, ideas, spikes, and possible work.
- `epic` is an optional planning/decomposition layer.
- `task` is the executable work unit.
- only `task` rows are executable by Bob in MVP.
- every task lives in workspace/project context and has a parent planning node.

### Primary user experience

- planning and coordination happen in the workspace/project/work-item surfaces
- humans mostly stay in those planning surfaces
- execution happens in a dedicated task workspace route
- the execution workspace is explicitly task-scoped, not a second project-management shell
- mobile and web use the same work model and the same auth model

### Architecture end state

- one canonical `apps/web`
- one canonical `apps/mobile`
- one `apps/execution` runtime for long-running agent/session orchestration
- one product-facing tRPC API in `packages/api`
- one shared DB schema in `packages/db`
- one notification/inbox model
- one user-facing realtime model
- one artifact model

### Product principles

- planning is primary; execution is embedded
- the task is the boundary between planning and execution
- Bob sessions/runs are durable execution records, not the planning model
- Kanbanger-style comments/notifications/artifacts remain canonical product primitives
- Bob-specific runtime details stay in the execution domain unless the product UI needs them

## Current Status Snapshot

The merge is materially underway. We are no longer at the "design only" stage.

### What is already true

- the Bob repo is the active destination monorepo
- the merged apps now live under `apps/web`, `apps/mobile`, and `apps/execution`
- the product-facing planning shell exists inside `apps/web`
- typed `work_items` and collaboration primitives exist in the Bob DB/API
- mobile planning + task execution flows have been merged into the Bob tree
- one product-facing app router has been established
- DB cutover/backfill work has landed
- pre-merge desktop/product surfaces were removed
- outward-facing planning route/config aliases exist
- the internal schema/runtime rename away from `kanbanger*` has started and is now established at the schema boundary

### What is not yet true

- the codebase still has legacy naming above the schema boundary in several payloads and flows
- compatibility route aliases still exist and are still doing real work
- the old dashboard/task-control surfaces still carry legacy naming and legacy UX assumptions
- execution service extraction is not fully complete operationally
- launch-hardening work is still outstanding

## Completed Work So Far

This section is organized by completed migration area, not by chronological order alone.

### 1. Monorepo destination and app structure

Completed by:

- `cb6e124` `refactor(packages): add merged domain package roots`
- `d4343fb` `feat(auth): add shared session and workspace auth primitives`
- `3af068e` `feat(mobile): merge planning and task execution mobile flows`
- `0a444c1` `refactor(api): converge on one product-facing app router`
- `0c7f3a0` `refactor(cleanup): remove obsolete pre-merge app surfaces`

What landed:

- normalized app/package layout centered on `apps/web`, `apps/mobile`, and `apps/execution`
- shared auth/session/workspace primitives in Bob
- product-facing router convergence in `packages/api`
- initial merged mobile and web app structure
- removal of obsolete pre-merge product surfaces that were no longer part of the target architecture

Key paths:

- `/Volumes/dev/bob/apps/web`
- `/Volumes/dev/bob/apps/mobile`
- `/Volumes/dev/bob/apps/execution`
- `/Volumes/dev/bob/packages/api`
- `/Volumes/dev/bob/packages/auth`

### 2. Canonical work-item and collaboration model

Completed by:

- `56c3e20` `feat(db): add typed work items model`
- `2c7815d` `feat(domain): unify work item collaboration primitives`

What landed:

- typed `work_items`
- comments
- activities
- notifications
- normalized work-item artifacts
- work-item/project/workspace API surfaces

Key paths:

- `/Volumes/dev/bob/packages/db/src/schema.ts`
- `/Volumes/dev/bob/packages/api/src/router/workItems.ts`
- `/Volumes/dev/bob/packages/api/src/router/project.ts`
- `/Volumes/dev/bob/packages/api/src/router/workspace.ts`

### 3. Merged planning shell on web

Completed by:

- `6d5bf66` `feat(web): add merged planning shell`

What landed:

- planning landing surface
- project detail surfaces
- work-item detail surfaces
- app-local planning components in the Bob web app

Key paths:

- `/Volumes/dev/bob/apps/web/src/app/(dashboard)/planning/page.tsx`
- `/Volumes/dev/bob/apps/web/src/app/(dashboard)/projects/[projectId]/page.tsx`
- `/Volumes/dev/bob/apps/web/src/app/(dashboard)/work-items/[workItemId]/page.tsx`
- `/Volumes/dev/bob/apps/web/src/components/projects`
- `/Volumes/dev/bob/apps/web/src/components/work-items`

### 4. Task-scoped execution workspace foundations

Completed by:

- `b7e0e70` `test(merge): add task workspace verification coverage`

What landed:

- dedicated task execution route in the merged web app
- planning-to-workspace entry points
- routing helpers for task-scoped execution
- execution runtime verification coverage

Key paths:

- `/Volumes/dev/bob/apps/web/src/app/(dashboard)/work-items/[workItemId]/workspace/page.tsx`
- `/Volumes/dev/bob/apps/web/src/components/work-items/work-item-detail-card.tsx`
- `/Volumes/dev/bob/apps/web/src/lib/planning/task-workspace.ts`
- `/Volumes/dev/bob/apps/execution/src/runtime.ts`

### 5. Database cutover and merged data migration work

Completed by:

- `eb5630c` `feat(db): add monorepo cutover migration and backfills`

What landed:

- cutover migration and backfill path for merged work-items
- data migration helpers for work items, artifacts, and session/task links

Key paths:

- `/Volumes/dev/bob/packages/db/drizzle`
- `/Volumes/dev/bob/packages/db/src/migrations`

### 6. Outward-facing planning naming and routing cleanup

Completed by:

- `1d75fb3` `feat(planning): add public task control aliases`
- `d8ed14a` `feat(planning): add webhook and env aliases`
- `00091f0` `feat(planning): prefer planning config in api package`
- `0e4aba2` `feat(planning): align web cron config aliases`
- `0c46af3` `refactor(planning): make planning routes canonical`
- `94b9430` `refactor(planning): make planning api routes canonical`
- `2733dd7` `refactor(planning): rename internal control modules`

What landed:

- planning-named route groups and webhook aliases
- planning-named env/config aliases
- planning routes are now the canonical implementation path, with old `kanbanger` routes acting as compatibility wrappers
- core integration modules moved from `kanbanger*` names to `planning*` names

Key paths:

- `/Volumes/dev/bob/apps/web/src/app/api/planning`
- `/Volumes/dev/bob/apps/web/src/app/api/webhooks/planning/route.ts`
- `/Volumes/dev/bob/packages/api/src/services/integrations/planningControlConfig.ts`
- `/Volumes/dev/bob/packages/api/src/services/integrations/planningControlVerifier.ts`
- `/Volumes/dev/bob/packages/api/src/services/integrations/planningWriteService.ts`

### 7. Internal schema-boundary alias migration

Completed by:

- `617392b` `refactor(work-items): prefer work item aliases in task flows`
- `34742ba` `refactor(work-items): rename schema boundary aliases`

What landed:

- `session` and `taskRun` flows now prefer `workItemId` / `workItemIdentifier`
- the Drizzle schema now exposes planning/work-item aliases instead of the old `kanbanger*` property names for the highest-impact legacy columns
- API/web consumers at the schema boundary were moved over to the new aliases
- a dedicated regression test now guards the alias contract

Key paths:

- `/Volumes/dev/bob/packages/db/src/schema.ts`
- `/Volumes/dev/bob/packages/api/src/router/session.ts`
- `/Volumes/dev/bob/packages/api/src/router/workItems.ts`
- `/Volumes/dev/bob/packages/api/src/services/tasks/taskExecutor.ts`
- `/Volumes/dev/bob/apps/web/src/lib/tasks/taskExecutor.ts`
- `/Volumes/dev/bob/packages/api/src/router/__tests__/planning-schema-aliases.test.ts`

## Current Codebase Shape

As of this document, the repo has three naming layers:

1. target naming
   - `planning`
   - `workItem`
   - `planningProjectId`
   - `planningItemId`
2. compatibility naming
   - old `kanbanger` routes and payload aliases still present in some places
3. historical storage naming
   - several SQL column names still use legacy `kanbanger_*` names under the hood

This is acceptable temporarily, but not acceptable for MVP launch. The remaining work below is largely about removing layer 2 and minimizing layer 3.

## Review Amendments

This section records decisions made during the CEO and engineering plan reviews (2026-03-13). These decisions are load-bearing constraints for implementation.

### Naming and data migration decisions

- **Stored DB values require backfill migration.** The `linkTypeEnum` value `"kanbanger_task"`, the `webhookDeliveries.provider` value `"kanbanger"`, and the `webhookDeliveries.eventType` values `"kanbanger_comment"` / `"kanbanger_comment_late"` are all stored as VARCHAR strings in Postgres. Renaming the TS constants without backfilling the DB causes silent query failures. A Drizzle migration with `UPDATE ... SET ... WHERE` statements must run BEFORE deploying renamed code.
- **Deploy order is migrate-first.** Run the backfill migration, verify with `SELECT count(*) FROM worktree_links WHERE link_type = 'kanbanger_task'` returning 0, then deploy the renamed code.
- **HTTP header rename requires coordinated deploy.** The planning service sends `x-kanbanger-signature` and `x-kanbanger-timestamp` headers. Rename to `x-planning-*` on both Bob and the planning service in the same deploy window.
- **tRPC zod fields rename atomically.** All clients (web, mobile) are controlled. Rename zod input fields like `kanbangerTaskId` → `planningTaskId` and all call sites in the same commit. Typecheck catches any missed call site.
- **Delete `/api/kanbanger/*` routes immediately.** No redirect shims — all external configs (webhook URLs) are controlled and can be updated in the same deploy.

### Architecture decisions

- **Delete duplicate `packages/api/src/services/tasks/taskExecutor.ts`** in Phase 1. The `apps/web/src/lib/tasks/taskExecutor.ts` (584 lines) is the canonical, feature-complete copy. The packages/api copy (390 lines) is older and simpler. Remove it to avoid confusion.
- **Add `planningTaskId` alias** for `pullRequests.kanbangerTaskId` in `schema.ts`. This is the one remaining schema property with no Drizzle alias.
- **Dashboard surgery strategy: extract + delete.**
  - Extract system controls (Terminal, AgentPanel, SystemStatusPanel) to a new `(dashboard)/system/page.tsx` route inside the existing dashboard layout group (reuses DashboardProviders and dashboard.css).
  - Merge the existing `(dashboard)/system-status/page.tsx` into the new `/system` route.
  - Move RepositoryPanel and RepositoryDashboardPanel to the project detail view (`projects/[projectId]/page.tsx`), adapting them to accept project context instead of global dashboard state.
  - Redirect `/` to `/planning`.
  - Delete `apps/web/src/app/(dashboard)/page.tsx` (3384 lines) entirely.
- **Rename legacy test files** during Phase 1: `kanbangerWriteService.test.ts` → `planningWriteService.test.ts`, `kanbanger-control-auth.test.ts` → `planning-control-auth.test.ts`, `kanbangerWebhook.test.ts` → `planningWebhook.test.ts`.

### Testing decisions

- **Add regression test for backfill migration.** In `planning-schema-aliases.test.ts`, insert rows with old values, run migration logic, verify new values are queryable.
- **Add smoke tests for Phase 2 route changes:** (1) `GET /` returns 301 to `/planning`, (2) `/system` renders without error, (3) old dashboard path returns 404.

### Scope decisions

- **Full auth (better-auth token validation) is in scope for v1.** There is a pre-existing TODO at `apps/web/src/app/api/auth/status/route.ts:39`. This becomes a new phase between Phase 2 and Phase 3.
- **SQL column renames are NOT in scope.** Drizzle aliases handle the TS layer; actual `ALTER TABLE ... RENAME COLUMN` migrations are deferred.

## Remaining Work

The rest of the work is organized into the execution phases that should get us to MVP. This is the active plan from here.

### Phase 1: Finish the naming and domain cleanup

**Why this matters:** We have the right architecture in place, but the codebase still leaks old names across API payloads, UI state, integration services, and link models. This adds cognitive overhead and makes future changes more error-prone.

**Rename scope by risk tier:**

```
  TIER 1: SAFE INTERNAL (79 refs across ~30 files)
  ──────────────────────────────────────────────────
  Type defs, function names, variable names, comments.
  Mechanical search-and-replace. Caught entirely by typecheck.

  TIER 2: EXTERNAL-TOUCHING (15 refs)
  ────────────────────────────────────
  ┌──────────────────────────┬───────────────────────────────────┐
  │ Env vars (4 refs)        │ KANBANGER_URL                     │
  │                          │ KANBANGER_CONTROL_SHARED_SECRET    │
  │                          │ KANBANGER_CONTROL_MAX_SKEW_MS      │
  │                          │ KANBANGER_WEBHOOK_SECRET            │
  ├──────────────────────────┼───────────────────────────────────┤
  │ HTTP headers (3 refs)    │ x-kanbanger-signature              │
  │                          │ x-kanbanger-timestamp              │
  ├──────────────────────────┼───────────────────────────────────┤
  │ Webhook provider (1)     │ "kanbanger" literal in DB          │
  ├──────────────────────────┼───────────────────────────────────┤
  │ SQL columns in raw (4)   │ kanbanger_task_id etc in raw SQL   │
  ├──────────────────────────┼───────────────────────────────────┤
  │ Exported functions (3)   │ linkPrToKanbangerTask              │
  │                          │ processKanbangerWebhook            │
  │                          │ addCommentToKanbangerIssue         │
  └──────────────────────────┴───────────────────────────────────┘

  TIER 3: DB STORED VALUES (backfill migration)
  ──────────────────────────────────────────────
  linkTypeEnum "kanbanger_task" → "planning_task"
  webhookDeliveries.provider "kanbanger" → "planning"
  webhookDeliveries.eventType "kanbanger_comment" → "planning_comment"
  webhookDeliveries.eventType "kanbanger_comment_late" → "planning_comment_late"
```

#### Task 1.1: Remove remaining `kanbanger*` naming above the schema boundary

Primary areas:

- `/Volumes/dev/bob/packages/api/src/router/repository.ts` — 12 refs: zod schemas, param maps, DB writes
- `/Volumes/dev/bob/packages/api/src/router/pullRequest.ts` — 7 refs: zod schemas, `linkPrToKanbangerTask`
- `/Volumes/dev/bob/packages/api/src/router/git.ts`
- `/Volumes/dev/bob/packages/api/src/services/tasks/taskAutoCreate.ts` — 23 refs: `KanbangerCreateIssueInput`, `KanbangerIssue`, `kanbangerRequest`, param names
- `/Volumes/dev/bob/packages/api/src/services/webhooks/processWebhook.ts` — 24 refs: `WebhookProvider` type, `KanbangerCommentPayload`, handler functions, event type literals
- `/Volumes/dev/bob/packages/api/src/services/integrations/planningWriteService.ts` — 16 refs: type defs (`KanbangerIssueStatus`, etc.), header constants
- `/Volumes/dev/bob/packages/api/src/services/integrations/planningControlVerifier.ts` — 7 refs: header constant imports
- `/Volumes/dev/bob/packages/api/src/services/integrations/planningControlConfig.ts` — 5 refs: env var names, default URL
- `/Volumes/dev/bob/packages/api/src/services/git/prService.ts` — 6 refs: `linkPrToKanbangerTask`, param fields
- `/Volumes/dev/bob/packages/api/src/services/sessions/workflowStatusService.ts` — 4 refs: type fields, raw SQL column
- `/Volumes/dev/bob/packages/mcp-server/src/tools/pr.ts` — 2 refs: type fields
- `/Volumes/dev/bob/packages/mcp-server/src/tools/task.ts` — 4 refs: comments
- `/Volumes/dev/bob/packages/mcp-server/src/tools/context.ts` — 1 ref: comment
- `/Volumes/dev/bob/packages/bob-agent-toolkit/src/oh-my-opencode/bob-workflow-skill.ts` — 5 refs: comments
- `/Volumes/dev/bob/apps/web/src/app/cesp-notifications-provider.tsx` — 2 refs: type fields
- `/Volumes/dev/bob/apps/mobile/src/providers/cesp-notifications-provider.tsx` — 3 refs: type fields
- `/Volumes/dev/bob/apps/web/src/app/api/cron/awaiting-input-expiry/route.ts` — 5 refs: type fields, conditional
- `/Volumes/dev/bob/apps/web/src/env.ts` — 1 ref: `KANBANGER_WEBHOOK_SECRET` env var

Also in this task:

- **Delete** `/Volumes/dev/bob/packages/api/src/services/tasks/taskExecutor.ts` (duplicate, 390 lines)
- **Add** `planningTaskId` alias for `pullRequests.kanbangerTaskId` in `/Volumes/dev/bob/packages/db/src/schema.ts`
- **Rename test files:**
  - `kanbangerWriteService.test.ts` → `planningWriteService.test.ts`
  - `kanbanger-control-auth.test.ts` → `planning-control-auth.test.ts`
  - `kanbangerWebhook.test.ts` → `planningWebhook.test.ts`

Deliverables:

- rename all 79 internal references (type defs, function names, variable names, comments) to planning/work-item terminology
- rename 15 external-touching references (env vars, headers, exported functions) with coordinated planning-service deploy
- rename tRPC zod input fields atomically across all call sites
- delete duplicate taskExecutor in packages/api
- add planningTaskId schema alias

Verification:

```bash
rg -n "kanbanger(Task|Issue|Project|Workspace)|kanbanger[A-Z]" /Volumes/dev/bob/apps /Volumes/dev/bob/packages
pnpm -C /Volumes/dev/bob --filter @bob/api typecheck
pnpm -C /Volumes/dev/bob --filter @bob/web typecheck
pnpm -C /Volumes/dev/bob --filter @bob/mobile typecheck
```

Expected state:

- remaining hits are only: migration SQL files, `schema.ts` SQL column name strings, and plan docs

#### Task 1.2: Backfill stored DB values and replace legacy link types

Primary areas:

- `/Volumes/dev/bob/packages/db/src/schema.ts` — `linkTypeEnum` array
- `/Volumes/dev/bob/packages/db/drizzle/` — new migration file
- `/Volumes/dev/bob/packages/api/src/router/link.ts`
- `/Volumes/dev/bob/packages/api/src/router/repository.ts`
- `/Volumes/dev/bob/packages/api/src/services/webhooks/processWebhook.ts`

Deliverables:

- add Drizzle migration with backfill UPDATEs:
  ```sql
  UPDATE worktree_links SET link_type = 'planning_task' WHERE link_type = 'kanbanger_task';
  UPDATE webhook_deliveries SET provider = 'planning' WHERE provider = 'kanbanger';
  UPDATE webhook_deliveries SET event_type = 'planning_comment' WHERE event_type = 'kanbanger_comment';
  UPDATE webhook_deliveries SET event_type = 'planning_comment_late' WHERE event_type = 'kanbanger_comment_late';
  ```
- update `linkTypeEnum` array: `"kanbanger_task"` → `"planning_task"`
- update `WebhookProvider` type: `"kanbanger"` → `"planning"`
- update event type string literals in `processWebhook.ts`
- replace any remaining planning-file metadata keys that still encode the old naming
- add regression test in `planning-schema-aliases.test.ts` that inserts rows with old values, runs migration logic, and verifies new values are queryable

Deploy requirement:

- **Run migration BEFORE deploying renamed code**
- Verify: `SELECT count(*) FROM worktree_links WHERE link_type = 'kanbanger_task'` returns 0
- Verify: `SELECT count(*) FROM webhook_deliveries WHERE provider = 'kanbanger'` returns 0
- Then deploy renamed application code

Verification:

```bash
rg -n "kanbanger_task|kanbanger_comment" /Volumes/dev/bob/packages --glob '!*.sql' --glob '!*migration*' --glob '!*plan*'
pnpm -C /Volumes/dev/bob --filter @bob/api test -- link repository planning-schema-aliases
```

#### Task 1.3: Delete old `/api/kanbanger/*` route files

Primary areas:

- `/Volumes/dev/bob/apps/web/src/app/api/webhooks/kanbanger/route.ts`
- `/Volumes/dev/bob/apps/web/src/app/api/integrations/kanbanger/`
- `/Volumes/dev/bob/apps/web/src/app/api/cron/kanbanger-sync-repos/`
- associated test files

Deliverables:

- delete all `/api/kanbanger/*` route files (the `/api/planning/*` equivalents are already canonical)
- update any external webhook configurations to point to `/api/planning/*` URLs

Verification:

```bash
ls /Volumes/dev/bob/apps/web/src/app/api/webhooks/kanbanger 2>/dev/null && echo "STILL EXISTS" || echo "DELETED"
ls /Volumes/dev/bob/apps/web/src/app/api/integrations/kanbanger 2>/dev/null && echo "STILL EXISTS" || echo "DELETED"
pnpm -C /Volumes/dev/bob --filter @bob/web typecheck
```

### Phase 2: Replace the dashboard with task-scoped surfaces

**Why this matters:** The product architecture is correct, but the user-facing execution experience still carries old Bob dashboard assumptions. The 3384-line dashboard page is the single largest source of legacy UX and legacy naming. MVP needs the task workspace as the primary execution surface and a clean operational view for system controls.

**Dashboard surgery architecture:**

```
  BEFORE                                    AFTER
  ──────                                    ─────
  / → (dashboard)/page.tsx (3384 lines)     / → redirect 301 to /planning
      ├── TerminalComponent
      ├── SystemStatusPanel                 (dashboard)/system/page.tsx (NEW)
      ├── AgentPanel                            ├── TerminalComponent
      ├── RepositoryPanel                       ├── SystemStatusPanel
      ├── RepositoryDashboardPanel              └── AgentPanel
      ├── 47 kanbanger refs
      ├── WebSocket session mgmt            projects/[projectId]/page.tsx (UPDATED)
      └── project/run/instance state            └── RepositoryPanel (adapted to project scope)

  DELETED:
  ├── (dashboard)/page.tsx (3384 lines)
  ├── (dashboard)/system-status/page.tsx (merged into /system)
  └── RepositoryDashboardPanel (subsumed by RepositoryPanel in project view)

  KEPT UNCHANGED:
  ├── (dashboard)/layout.tsx + DashboardProviders + dashboard.css
  ├── (dashboard)/planning/page.tsx
  ├── (dashboard)/projects/*/page.tsx
  ├── (dashboard)/work-items/*/page.tsx
  ├── (dashboard)/database/page.tsx
  └── All shared infra: WebSocket, API client, contexts
```

#### Task 2.1: Create the `/system` operational route

Primary areas:

- `/Volumes/dev/bob/apps/web/src/app/(dashboard)/system/page.tsx` — new file
- `/Volumes/dev/bob/apps/web/src/app/(dashboard)/system-status/page.tsx` — merge into above
- `/Volumes/dev/bob/apps/web/src/components/dashboard/Terminal.tsx`
- `/Volumes/dev/bob/apps/web/src/components/dashboard/AgentPanel.tsx`
- `/Volumes/dev/bob/apps/web/src/components/dashboard/SystemStatusPanel.tsx`

Deliverables:

- new `(dashboard)/system/page.tsx` that renders Terminal, AgentPanel, and SystemStatusPanel
- the page lives inside the `(dashboard)` layout group, reusing DashboardProviders and dashboard.css
- merge content from existing `system-status/page.tsx` into the new route
- delete `(dashboard)/system-status/page.tsx` after merge

#### Task 2.2: Move repository controls to project detail view

Primary areas:

- `/Volumes/dev/bob/apps/web/src/components/dashboard/RepositoryPanel.tsx` — adapt to project scope
- `/Volumes/dev/bob/apps/web/src/app/(dashboard)/projects/[projectId]/page.tsx`

Deliverables:

- RepositoryPanel adapted to accept a `projectId` prop instead of managing global dashboard state
- integrated into the project detail page
- RepositoryDashboardPanel deleted (functionality subsumed)

#### Task 2.3: Redirect landing and delete old dashboard

Primary areas:

- `/Volumes/dev/bob/apps/web/src/app/(dashboard)/page.tsx` — delete
- `/Volumes/dev/bob/apps/web/src/app/(dashboard)/dashboard/page.tsx` — delete (re-export)
- root redirect configuration

Deliverables:

- `/` redirects (301) to `/planning`
- `apps/web/src/app/(dashboard)/page.tsx` (3384 lines) deleted entirely
- `apps/web/src/app/(dashboard)/dashboard/page.tsx` deleted
- API endpoints under `/api/kanbanger/dashboard-v2`, `/api/kanbanger/repo-options`, `/api/kanbanger/sync-repos` evaluated for deletion (only kept if needed by the new project-scoped RepositoryPanel or `/system` route)

#### Task 2.4: Add smoke tests for route changes

Deliverables:

- test: `GET /` returns 301 redirect to `/planning`
- test: `/system` renders without error (components present)
- test: old dashboard path returns 404

Verification:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/web typecheck
pnpm -C /Volumes/dev/bob --filter @bob/web test -- task-workspace planning-utils system
```

#### Task 2.5: Finish task context, artifacts, and run history inside the workspace

Primary areas:

- `/Volumes/dev/bob/apps/web/src/app/(dashboard)/work-items/[workItemId]/workspace/**`
- `/Volumes/dev/bob/apps/web/src/lib/planning/task-workspace.ts`
- `/Volumes/dev/bob/packages/api/src/router/session.ts`
- `/Volumes/dev/bob/packages/api/src/router/workItems.ts`

Deliverables:

- richer task context in the execution workspace
- current artifacts and validation state surfaced in the workspace
- run history and handoff context presented cleanly

### Phase 2.5: Implement full auth

**Why this matters:** Auth is partially wired. `apps/web/src/app/api/auth/status/route.ts:39` has a TODO: "wire real token validation (better-auth) when REQUIRE_AUTH is enabled." Full auth is required for v1 launch.

Primary areas:

- `/Volumes/dev/bob/apps/web/src/app/api/auth/`
- `/Volumes/dev/bob/packages/auth/`
- `/Volumes/dev/bob/apps/web/src/app/(dashboard)/layout.tsx`

Deliverables:

- wire better-auth token validation so REQUIRE_AUTH is functional
- all product routes require authenticated sessions
- auth flows work consistently on web and mobile

Verification:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/web typecheck
pnpm -C /Volumes/dev/bob --filter @bob/auth test
pnpm -C /Volumes/dev/bob --filter @bob/web test -- auth
```

### Phase 3: Finish the execution service split

**Why this matters:** The target architecture includes a dedicated execution runtime. Some of the code has already moved, but the operational boundary still needs to be completed and simplified. Currently `apps/execution` is only a process supervisor that spawns `apps/gateway`; the actual long-running task orchestration still lives in `apps/web/src/lib/tasks/`.

**Current execution architecture:**

```
  apps/execution/          → Process supervisor only (spawns gateway)
  apps/web/src/lib/tasks/  → ACTUAL task orchestration (584 lines)
    taskExecutor.ts          executeTask, resumeBlockedTask, supersedeAndRestart
    planningControl.ts       startIssueSession, resumeIssueSession, stopIssueSession
  apps/web/src/server/     → Service singletons (GitService, AgentService, TerminalService)
  packages/api/services/   → Request/response task logic (taskAutoCreate, contextHeuristics)
```

#### Task 3.1: Audit all long-running task/session runtime responsibilities

Primary areas:

- `/Volumes/dev/bob/apps/execution`
- `/Volumes/dev/bob/apps/web/src/lib/tasks`
- `/Volumes/dev/bob/apps/web/src/server`
- `/Volumes/dev/bob/packages/api/src/services/tasks`
- `/Volumes/dev/bob/packages/mcp-server`

Deliverables:

- clear list of what must live in `apps/execution`
- clear list of what should remain request/response code in web/api packages

#### Task 3.2: Move remaining runtime-only paths behind `apps/execution`

Deliverables:

- long-running orchestration, polling, worktree/session state machines, and runtime agents live in `apps/execution`
- `apps/web` becomes a clean product UI + thin control layer, not a runtime host

Verification:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/execution typecheck
pnpm -C /Volumes/dev/bob --filter @bob/execution test
pnpm -C /Volumes/dev/bob --filter @bob/web typecheck
```

### Phase 4: Finish product-model convergence

**Why this matters:** We have the base work-item model, but the finished product still needs a clean issue/epic/task progression and clearer product semantics.

#### Task 4.1: Formalize issue-to-task promotion flows

Primary areas:

- `/Volumes/dev/bob/packages/api/src/router/workItems.ts`
- `/Volumes/dev/bob/apps/web/src/components/work-items`
- `/Volumes/dev/bob/apps/mobile`

Deliverables:

- explicit promotion UX from issue to task
- correct parent relationships for issue -> task and issue -> epic -> task
- agent execution constrained to tasks

#### Task 4.2: Align UI copy and domain language around Bob Builder theming

Deliverables:

- remove visible "Kanbanger" product references from the UI
- ensure issue/task/epic semantics are visible and understandable

### Phase 5: Mobile polish and parity

**Why this matters:** The merged mobile app exists, but MVP launch requires the mobile experience to feel first-party rather than just co-located code.

Primary areas:

- `/Volumes/dev/bob/apps/mobile`

Deliverables:

- workspace/project/work-item navigation aligned with web
- task execution/chat surfaces trimmed to task scope
- notification/inbox flows wired to the canonical model
- artifact visibility and task state visibility aligned with web

Verification:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/mobile typecheck
pnpm -C /Volumes/dev/bob --filter @bob/mobile test
```

### Phase 6: Launch-hardening and cleanup

**Why this matters:** The architecture is converging, but MVP launch needs a clean repository and predictable operational behavior.

#### Task 6.1: Delete compatibility wrappers that are no longer needed

Primary areas:

- any remaining `kanbanger` env alias fallback handling (once planning names are canonical everywhere)
- any remaining migration-only helpers

#### Task 6.2: Expand end-to-end verification

Required verification coverage:

- workspace/project/work-item list/detail
- issue/task progression
- task execution launch
- task workspace open/resume/stop
- artifact creation and visibility
- notifications for blocked / needs-input / review-ready
- mobile task navigation and task execution entry

Recommended commands:

```bash
pnpm -C /Volumes/dev/bob typecheck
pnpm -C /Volumes/dev/bob test
pnpm -C /Volumes/dev/bob --filter @bob/web test:e2e
```

#### Task 6.3: Fix remaining lint/config instability

Known cleanup target:

- repo-wide lint stability should be restored so the monorepo can be treated as healthy by default, not only by selective typecheck/test commands

## Recommended Execution Order From Here

1. Finish the remaining naming cleanup (Phase 1.1, 1.2, 1.3).
2. Replace the dashboard with task-scoped surfaces (Phase 2.1–2.5).
3. Implement full auth (Phase 2.5).
4. Complete the execution-service operational split (Phase 3).
5. Finish issue/epic/task progression and UI copy convergence (Phase 4).
6. Bring mobile to MVP parity (Phase 5).
7. Remove compatibility shims and run full hardening (Phase 6).

## Definition Of Done For MVP

The merge should be considered MVP-complete when all of the following are true:

1. There is one coherent Bob Builder web app and one coherent Bob Builder mobile app.
2. Users operate through one workspace/auth/notification/comment model.
3. `task` is the canonical executable work unit.
4. The execution workspace is task-scoped and is the canonical way to work with Bob on a task.
5. Artifacts, comments, notifications, and work-item state are shared product primitives across planning and execution.
6. Remaining `kanbanger` naming is gone from product-facing code except for temporary storage-level compatibility where explicitly justified.
7. The execution runtime is cleanly separated from product UI request handling.
8. Repo-wide verification is reliable enough to ship from the merged tree.
9. Full auth is functional — all product routes require authenticated sessions.

## Immediate Next Batch Recommendation

If continuing right away, the next batch should be:

1. delete the duplicate `packages/api/src/services/tasks/taskExecutor.ts`,
2. add the `planningTaskId` alias for `pullRequests.kanbangerTaskId` in schema.ts,
3. remove remaining `kanbanger*` payload names from repository/PR/task-control/webhook flows (Task 1.1),
4. write and run the backfill migration for stored DB values (Task 1.2),
5. delete old `/api/kanbanger/*` route files (Task 1.3).

That completes Phase 1 and is the shortest path from "architecturally merged" to "naming-coherent."
