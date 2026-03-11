# Bob Builder Monorepo Merge Design

Date: 2026-03-11

## Goal

Merge the current Bob and Kanbanger codebases into a single Bob-branded monorepo with:

- one shared Next.js web app
- one shared mobile app
- one shared database
- one shared auth and permission model
- one shared product-facing API surface
- Bob execution deeply integrated as part of the product, not as a separate app

This migration is intended to produce the MVP architecture for launch, not a temporary coexistence setup. We do not need to preserve `linear-clone` git history. We should optimize for the cleanest merged architecture and product language.

## Product Principles

1. Bob Builder is a single product, not two products stitched together.
2. Planning and execution are both first-class, but planning/navigation is primary.
3. Kanbanger's workspace, membership, project, notification, and mobile information architecture become the canonical product model.
4. Bob's chat, task execution, CLI, file browser, validation, and worktree capabilities become the canonical execution workspace.
5. Web and mobile both participate in the same work model.
6. Desktop/Electron product surfaces are not part of MVP and should be removed unless some internal runtime utility must survive.

## Target Monorepo Shape

### Apps

- `apps/web`
  - canonical Next.js web app
  - built from Bob's current `apps/nextjs` plus Kanbanger's product/planning surfaces
- `apps/mobile`
  - canonical mobile app
  - built from Kanbanger's current `apps/mobile` plus Bob task execution/chat surfaces
- `apps/execution`
  - long-running task orchestration service
  - owns agent session lifecycle, worktree orchestration, task execution state machines, and internal execution workflows
- `apps/mcp`
  - if still needed, becomes an internal service app rather than a separate product boundary
- optional additional service apps only where runtime boundaries are operationally useful

### Packages

- `packages/api`
  - one product-facing tRPC router
- `packages/db`
  - merged schema and migrations
- `packages/auth`
  - canonical auth/session/workspace context
- `packages/realtime`
  - user-facing realtime model
- `packages/work-items`
  - work item domain logic
- `packages/agents`
  - reusable agent abstractions and session helpers
- `packages/execution`
  - reusable execution libraries used by `apps/execution`
- additional shared infra packages only where there is clear cross-app reuse

### Explicit non-goals

- preserving existing Bob or Kanbanger route/package names
- preserving `linear-clone` git history
- keeping Bob desktop/Electron as a first-class client
- maintaining long-lived dual-app compatibility

## Canonical Product Model

### Identity and permissions

Kanbanger's user, workspace, project membership, and authorization model becomes canonical across the merged product.

Implications:

- Bob session access is governed by workspace/project/task permissions
- web and mobile use the same identity and permission model
- one auth/session stack is used across planning and execution

### Work model

The merged product should move to a typed `work_items` model rather than forcing all planning and execution through one overloaded `issues` concept.

Recommended `work_items.kind` values for MVP:

- `issue`
- `epic`
- `task`

Semantics:

- `issue`
  - intake layer for ideas, bugs, observations, spikes, and loosely scoped problem reports
- `epic`
  - optional planning/decomposition container
- `task`
  - scoped executable unit of work
  - only `task` rows are executable by Bob in MVP

### Parent relationships

Every `task` should have a parent, but that parent can be:

- an `issue`
- an `epic`
- another planning node if the model later expands

This supports:

- `issue -> task`
- `issue -> epic -> task`
- one issue spawning multiple tasks
- manual issue-to-task promotion in MVP

Issue-to-task conversion should be manual in v1, but the model should leave room for future automation.

## Execution Model

Bob execution remains a distinct domain inside the merged product.

Keep dedicated execution entities for:

- sessions
- task runs
- transcripts/messages
- worktrees/repository bindings
- validation runs
- execution events

But make them link directly to canonical `work_items.id` for `task` rows.

Guiding rules:

1. Managed Bob execution sessions are always task-scoped.
2. A session can show parent issue/epic context, but its executable binding is to one task.
3. If a task is superseded or decomposed, a new run/session attaches to the successor task rather than stretching one run across multiple executable tasks.
4. General-purpose non-task chat can still exist, but managed work execution is task-bound.

## Artifact Model

The merged product should have one normalized artifact system shared by planning and execution.

Recommended table shape:

- `artifacts`
  - `id`
  - `work_item_id`
  - optional `task_run_id`
  - `category`
  - `title`
  - `url`
  - metadata fields
  - provenance fields
  - `is_current`
  - timestamps

Recommended artifact categories:

- `pr`
- `verification`
- `build`
- `test_report`
- `doc`
- `deliverable`
- `link`

Rules:

1. Artifacts are immutable history rows.
2. Only one current artifact per work item and role/category when applicable.
3. Planning and execution both read the same artifact model.
4. Parent roll-ups should be derived from child work items rather than duplicating artifact blobs.

## Comments, Notifications, and Realtime

Kanbanger's comments, notification, and inbox model becomes canonical.

### Comments

- one comment system across planning and execution
- task pages and execution routes should both surface the same canonical discussion state
- execution-specific prompting/reply metadata can exist, but should remain an extension of the shared comment model

### Notifications

- one inbox/notification system
- Bob execution events become first-class notification types
- no separate Bob notification center

### Realtime

- one user-facing realtime/event model for work item changes, comments, notifications, and execution status
- Bob's low-level internal stream remains internal unless the UI needs a translated high-level event

## Web UX Target

The web product should use Bob's Next.js app as the technical base, but not as the product information architecture.

### Primary UX model

- workspace/project/work item navigation comes from Kanbanger
- task detail pages are the canonical planning and review surface
- Bob execution becomes a dedicated task-scoped workspace route

### Execution workspace

The execution workspace should be focused and task-scoped. It should not preserve Bob's current broader project-management surfaces.

Expected contents:

- chat
- session status
- CLI/terminal
- file browser
- task artifacts
- validation history
- task context and parent links

Expected exclusions:

- standalone Bob project-management surfaces
- duplicate planning navigation already covered elsewhere in the product

### Routing direction

The final web app should live under `apps/web`, and route/package renames should happen during the migration rather than afterward.

## Mobile UX Target

The mobile product should use Kanbanger's current mobile app as the base shell.

Reasoning:

- its workspace/project/task navigation already matches the canonical product model
- it is a better starting point for planning/inbox/mobile workflows

Add to it:

- Bob task execution/chat views
- agent interaction for active task sessions
- execution status and artifacts on task detail screens

Mobile and web should expose the same work model and permissions, even if the execution UI is more compact on mobile.

## API and Service Topology

The merged product should converge on one product-facing tRPC router.

### Public app API

- one tRPC router used by web and mobile
- one app context tied to canonical auth/workspace membership

### Internal execution services

Bob's execution engine should remain operationally separate from the Next.js server.

Recommended boundary:

- `apps/execution` runs long-lived orchestration and task execution flows
- shared logic lives in `packages/execution` and `packages/agents`
- `packages/api` calls into service-layer abstractions rather than embedding all long-running execution directly in the web process

This keeps the product API unified without collapsing all execution runtime concerns into the web server.

## Database Direction

The migration should do meaningful schema cleanup now, because this is the right time to align the MVP data model with the launch product.

### Keep and reuse

- workspace and membership foundations
- projects
- comments
- notifications
- Bob execution tables and relationships where they represent true execution state

### Consolidate or replace

- replace the temporary cross-app integration projection layer with direct first-party relationships
- move toward `work_items` as the canonical planning/execution anchor
- unify artifacts into one shared artifact model
- remove app-to-app synchronization tables or fields that only existed because the systems were separate

### Rename aggressively where justified

Because branding and product identity matter for MVP:

- route names can change
- package names can change
- domain naming can change where it improves product clarity

But aggressive renaming should still be disciplined:

- rename the concepts that are central to the merged product
- avoid churn that does not materially improve the model

## Migration Strategy

Use a staged hard cutover, not a long dual-write period.

### Phase 1: Define target architecture

1. Freeze the target monorepo layout.
2. Define the merged package/app naming scheme.
3. Define the target merged schema centered on `work_items`.
4. Identify which existing Bob and Kanbanger modules survive, move, merge, or delete.

### Phase 2: Copy and restructure code

1. Copy Kanbanger code into Bob monorepo.
2. Restructure immediately toward `apps/web`, `apps/mobile`, and service apps.
3. Rename packages/routes/domains toward Bob Builder language during this phase.
4. Remove obsolete Bob desktop/Electron product surfaces.

### Phase 3: Merge shared foundations

1. Unify workspace/package manager configuration.
2. Consolidate env handling.
3. Standardize on one auth/session model.
4. Consolidate onto one product-facing API package.
5. Consolidate realtime and notifications.

### Phase 4: Merge schema and domain logic

1. Implement the target merged schema.
2. Migrate planning data toward `work_items`.
3. Reattach Bob execution entities directly to `task` work items.
4. Replace temporary integration glue with first-party relationships.
5. Consolidate artifacts/comments/notifications.

### Phase 5: Merge product surfaces

1. Build the shared planning shell in `apps/web`.
2. Bring over Bob execution workspace as dedicated task routes.
3. Merge mobile around Kanbanger's shell and add Bob execution surfaces.
4. Remove duplicate legacy screens as soon as replacement paths are live.

### Phase 6: Cut over and delete compatibility

1. Run the database cutover to the merged schema.
2. Move all app code to the merged schema and APIs.
3. Delete compatibility adapters quickly.
4. End with one code path per concern.

## What gets simpler after the merge

The following integration-era concepts should largely disappear or shrink:

1. Server-to-server Bob/Kanbanger control APIs as a primary architectural boundary.
2. External session projection layers that only exist to mirror state across apps.
3. Separate comment/reply synchronization flows between products.
4. Separate issue panel versus Bob session truth models designed around app boundaries.

They may still survive as internal service boundaries, but they should no longer shape the product architecture.

## Risks and constraints

### Main risks

1. Doing both structure merge and naming rebrand at once creates churn.
2. A typed `work_items` migration can touch a large amount of code.
3. Moving to one web shell and one mobile shell can expose hidden assumptions in both apps.
4. Removing desktop surfaces may reveal execution dependencies currently coupled to old frontend code.

### Risk controls

1. Define the target architecture and schema before moving large code volumes.
2. Keep execution runtime boundaries explicit even while consolidating product-facing APIs.
3. Treat compatibility adapters as strictly temporary.
4. Continuously verify web, mobile, DB migrations, and execution-service behavior at each phase.

## Success criteria

The merge is successful when:

1. There is one Bob-branded monorepo.
2. There is one shared database schema and one auth model.
3. There is one `apps/web` and one `apps/mobile`.
4. Planning, intake, comments, notifications, and execution all operate on one canonical work model.
5. Bob execution is task-scoped and deeply integrated, but still runs through dedicated internal services.
6. The old cross-app synchronization architecture is no longer needed for core product behavior.

## Recommended next step

Write a detailed implementation plan for the migration with:

- target directory moves and deletions
- package rename map
- target schema proposal
- cutover sequence
- verification checkpoints for web, mobile, execution, and database migration
- explicit cleanup list for legacy Bob and Kanbanger surfaces
