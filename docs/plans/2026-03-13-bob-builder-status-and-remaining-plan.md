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

## Remaining Work

The rest of the work is organized into the execution phases that should get us to MVP. This is the active plan from here.

### Phase 1: Finish the naming and domain cleanup

**Why this matters:** We have the right architecture in place, but the codebase still leaks old names across API payloads, UI state, integration services, and link models. This adds cognitive overhead and makes future changes more error-prone.

#### Task 1.1: Remove remaining `kanbanger*` naming above the schema boundary

Primary areas:

- `/Volumes/dev/bob/packages/api/src/router/repository.ts`
- `/Volumes/dev/bob/packages/api/src/router/pullRequest.ts`
- `/Volumes/dev/bob/packages/api/src/router/git.ts`
- `/Volumes/dev/bob/packages/mcp-server/src/tools/pr.ts`
- `/Volumes/dev/bob/apps/web/src/app/(dashboard)/page.tsx`
- `/Volumes/dev/bob/apps/web/src/app/api/cron/awaiting-input-expiry/route.ts`
- `/Volumes/dev/bob/apps/web/src/app/cesp-notifications-provider.tsx`
- `/Volumes/dev/bob/apps/mobile/src/providers/cesp-notifications-provider.tsx`

Deliverables:

- rename remaining payload fields to planning/work-item terminology
- keep compatibility aliases only where an external contract still truly needs them
- remove internal references to `kanbangerTaskId`, `kanbangerIssueId`, `kanbangerProjectId`, and similar fields

Verification:

```bash
rg -n "kanbanger(Task|Issue|Project|Workspace)|kanbanger[A-Z]" /Volumes/dev/bob/apps /Volumes/dev/bob/packages
pnpm -C /Volumes/dev/bob --filter @bob/api typecheck
pnpm -C /Volumes/dev/bob --filter @bob/web typecheck
pnpm -C /Volumes/dev/bob --filter @bob/mobile typecheck
```

Expected state:

- remaining hits are either migration docs, SQL column names, or explicit compatibility shims

#### Task 1.2: Replace legacy link types and planning-file metadata names

Primary areas:

- `/Volumes/dev/bob/packages/db/src/schema.ts`
- `/Volumes/dev/bob/packages/api/src/router/link.ts`
- `/Volumes/dev/bob/packages/api/src/router/repository.ts`
- any planning file parsing/writing helpers

Deliverables:

- replace `kanbanger_task` link types with a Bob Builder term
- replace any remaining planning-file metadata keys that still encode the old naming

Verification:

```bash
rg -n "kanbanger_task|kanbanger_task_id" /Volumes/dev/bob
pnpm -C /Volumes/dev/bob --filter @bob/api test -- link repository
```

### Phase 2: Finish the task-scoped execution experience

**Why this matters:** The product architecture is correct, but the user-facing execution experience still carries old Bob dashboard assumptions. MVP needs a cleaner task workspace.

#### Task 2.1: Trim the old dashboard and make the task workspace the default execution surface

Primary areas:

- `/Volumes/dev/bob/apps/web/src/app/(dashboard)/page.tsx`
- `/Volumes/dev/bob/apps/web/src/app/(dashboard)/work-items/[workItemId]/workspace/page.tsx`
- `/Volumes/dev/bob/apps/web/src/components/dashboard`
- `/Volumes/dev/bob/apps/web/src/components/work-items`

Deliverables:

- reduce or remove the old Bob-wide dashboard as a primary surface
- make task-linked execution the canonical desktop/web execution entry point
- keep only the system-level controls that are still needed operationally

Verification:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/web typecheck
pnpm -C /Volumes/dev/bob --filter @bob/web test -- task-workspace planning-utils
```

#### Task 2.2: Finish task context, artifacts, and run history inside the workspace

Primary areas:

- `/Volumes/dev/bob/apps/web/src/app/(dashboard)/work-items/[workItemId]/workspace/**`
- `/Volumes/dev/bob/apps/web/src/lib/planning/task-workspace.ts`
- `/Volumes/dev/bob/packages/api/src/router/session.ts`
- `/Volumes/dev/bob/packages/api/src/router/workItems.ts`

Deliverables:

- richer task context in the execution workspace
- current artifacts and validation state surfaced in the workspace
- run history and handoff context presented cleanly

### Phase 3: Finish the execution service split

**Why this matters:** The target architecture includes a dedicated execution runtime. Some of the code has already moved, but the operational boundary still needs to be completed and simplified.

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

- old `kanbanger` route wrappers
- old env alias handling once planning names are canonical everywhere
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

1. Finish the remaining naming cleanup.
2. Collapse the old dashboard into the task-scoped workspace model.
3. Complete the execution-service operational split.
4. Finish issue/epic/task progression and UI copy convergence.
5. Bring mobile to MVP parity.
6. Remove compatibility shims and run full hardening.

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

## Immediate Next Batch Recommendation

If continuing right away, the next batch should be:

1. remove remaining `kanbanger*` payload names from repository/PR/task-control flows,
2. replace the `kanbanger_task` link type and planning metadata naming,
3. clean the old dashboard page so the task workspace becomes the obvious primary execution surface.

That is the shortest path from "architecturally merged" to "product-coherent."
