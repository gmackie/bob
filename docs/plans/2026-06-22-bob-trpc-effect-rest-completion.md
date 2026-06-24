# Bob tRPC to Effect-RPC and REST Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Finish the Bob migration by moving all Bob-owned first-party consumers from tRPC to `@gmacko/bob-client` Effect-RPC while preserving `/api/v1/**` REST/OpenAPI as the stable external API.

**Architecture:** Effect-RPC is the first-party application transport for Bob web, mobile, CLI, and internal remote clients. REST remains the external/public API surface and should dispatch through the same domain handlers or the same Effect-RPC handler layer where the runtime supports it. tRPC stays only as a temporary compatibility layer until all Bob-owned production consumers are gone.

**Tech Stack:** Effect-RPC, Effect Schema, React Query, Next.js/Vite Bob web, React Native/Expo mobile, Drizzle/Postgres/PGlite, existing `/api/v1/**` REST routes and OpenAPI generation.

## Current State

This plan continues from the live tree on June 22, 2026.

Already in place:

- `apps/bob/src/server/rpc.ts` mounts Bob Effect-RPC at `/api/rpc`.
- `packages/bob/src/contracts/**` and `packages/core/src/contracts/groups/**` contain most Bob/Core Effect contracts.
- `packages/bob-client` exports `createBobRpcClient()` and grouped clients for `workItems`, `planning`, `external`, `agent`, `projects`, `settings`, `secrets`, and `auth`.
- Bob web has `BobRpcProvider` nested inside the temporary `TRPCReactProvider`.
- Guardrails exist in `packages/bob-client/src/__tests__/migration-guardrails.test.ts`.
- Migrated slices include notifications, some planning/dashboard pages, work-item read-only panels, settings cookie/api-key/git/webhook panels, PR list/detail/reviews, live build status, and work pipeline.
- `pnpm --filter @gmacko/bob-client test` and `pnpm --filter @gmacko/bob-client typecheck` are the primary package-level checks for the client.

Still remaining:

- Many Bob web components/hooks still import `~/trpc/react`.
- Server helpers still import `createTRPCContext` or call tRPC callers.
- `/api/trpc` still exists and must remain until all Bob-owned production consumers are gone.
- Some UI consumers need missing or incomplete Effect contract/client coverage before they can be migrated safely.
- REST `/api/v1/**` must remain stable for external access.
- No Convex migration is part of this plan.

## Non-Negotiable Boundaries

- Do not migrate storage. Drizzle/Postgres/PGlite remains canonical.
- Do not remove REST. `/api/v1/**` is the external/public API boundary.
- Do not remove `/api/trpc` until the final retirement batch proves no Bob-owned production consumers remain.
- Keep `TRPCReactProvider` until every web consumer is migrated.
- Keep `@trpc/server` inside `@bob/api` until router facades, REST generation, and legacy tests no longer need it.
- Use TDD/guardrail red-green for each slice: add the file to the migration guardrail, verify it fails, migrate, verify it passes.

## Batch 1: Contract and Client Parity

**Goal:** Close the known Effect-RPC coverage gaps before migrating the remaining UI and server consumers.

### Task 1.1: Add `agent.run.listAll` Contract Coverage

**Files:**

- Modify: `packages/core/src/contracts/groups/agent.ts`
- Modify: `packages/core/src/contracts/stubs/agent.ts`
- Modify: `packages/bob-client/src/agent.ts`
- Test: `packages/core/src/contracts/__tests__/agent-run-capture.test.ts`
- Test: `packages/bob-client/src/__tests__/shape.test.ts`

**Steps:**

1. Add a failing core contract test that expects `AgentRpc.requests.has("agent.run.listAll")`.
2. Run:

   ```bash
   pnpm --filter @gmacko/core-contracts test -- agent-run-capture
   ```

   Expected: fails because `agent.run.listAll` is missing.

3. Add `AgentRunListAllRpc = Rpc.make("agent.run.listAll", { payload: Schema.Struct({ limit: Schema.optional(Schema.Number) }), success: Schema.Array(AgentRunSchema) })`.
4. Add the RPC to `AgentRpc`.
5. Add a stub handler returning `[]`.
6. Add `agent.run.listAll` and top-level `agent.listAllRuns` client methods in `packages/bob-client/src/agent.ts`.
7. Add shape assertions for both method names.
8. Verify:

   ```bash
   pnpm --filter @gmacko/core-contracts test -- agent-run-capture
   pnpm --filter @gmacko/bob-client test
   pnpm --filter @gmacko/bob-client typecheck
   ```

### Task 1.2: Fill Project Client Surface

**Files:**

- Modify: `packages/bob-client/src/projects.ts`
- Test: `packages/bob-client/src/__tests__/shape.test.ts`

**Known methods already in contracts but not fully explicit in the facade:**

- `projects.discovery`
- `projects.updateAutomationSettings`
- `projects.dismissDir`
- `projects.featureBranch.*`
- `projects.workspace.setDefaultAgent` if contract exists; if it does not, add it first.

**Steps:**

1. Add failing shape assertions for each needed method.
2. Run `pnpm --filter @gmacko/bob-client test -- src/__tests__/shape.test.ts`.
3. Add explicit methods to `ProjectsClient`.
4. Verify:

   ```bash
   pnpm --filter @gmacko/bob-client test -- src/__tests__/shape.test.ts
   pnpm --filter @gmacko/bob-client typecheck
   ```

### Task 1.3: Fill Agent Client Surface

**Files:**

- Modify: `packages/bob-client/src/agent.ts`
- Test: `packages/bob-client/src/__tests__/shape.test.ts`

**Methods needed by remaining web surfaces:**

- `agent.capture.listTargets`
- `agent.capture.capture`
- `agent.terminal.*`
- `agent.filesystem.*`
- `agent.event.*`
- `agent.instance.*`
- `agent.session.*`
- `agent.chat.*`

**Steps:**

1. Add shape assertions for the client method groups.
2. Run the shape test and verify red.
3. Add explicit method groups to `AgentClient`.
4. Keep method names aligned with contract tags, for example:

   ```ts
   capture: {
     listTargets: (input) => invoke("agent.capture.listTargets", input),
     capture: (input) => invoke("agent.capture.capture", input),
   }
   ```

5. Verify:

   ```bash
   pnpm --filter @gmacko/bob-client test
   pnpm --filter @gmacko/bob-client typecheck
   ```

### Task 1.4: Decide and Implement Integrations Contract

**Files:**

- Inspect: `packages/bob/src/api/src/router/integration.ts`
- Create or modify: `packages/bob/src/contracts/groups/settings.ts` or another appropriate Bob group
- Modify: `packages/bob-client/src/settings.ts` or create `packages/bob-client/src/integrations.ts`
- Modify: `packages/bob-client/src/index.ts`
- Test: contract and client shape tests

**Procedures to cover:**

- `integration.list`
- `integration.get`
- `integration.save`
- `integration.fetchLinearTeams`
- `integration.setupLinear`
- `integration.delete`

**Steps:**

1. Write failing contract tests asserting the tags exist in the chosen group.
2. Add Effect schemas that match the existing Zod inputs/outputs.
3. Add stub handlers.
4. Wire handlers into `apps/bob/src/server/rpc.ts` or the shared RPC handler module if already extracted.
5. Add client facade methods.
6. Verify:

   ```bash
   pnpm --filter @gmacko/bob-contracts test
   pnpm --filter @gmacko/bob-client test
   pnpm --filter @gmacko/bob-client typecheck
   ```

### Task 1.5: Resolve Settings Preferences Shape Mismatch

**Files:**

- Inspect: `apps/bob/src/app/(dashboard)/settings/_components/preferences.tsx`
- Inspect: `packages/core/src/contracts/groups/settings.ts`
- Modify: `packages/core/src/contracts/schemas/settings.ts` or equivalent schema file
- Modify: settings handlers
- Test: settings contract tests and migrated component guardrail

**Known mismatch:**

The UI has used fields such as `emailNotifications` and `pushNotifications`, while the Effect settings contract currently appears narrower, with fields like `enableNotifications`.

**Steps:**

1. Decide the canonical preferences shape from the DB/domain handler.
2. Add a failing contract test for the actual UI-required shape.
3. Update schemas and handlers.
4. Update `@gmacko/bob-client` types/facade if needed.
5. Migrate `preferences.tsx` in Batch 3 after this is green.

### Task 1.6: REST/OpenAPI Boundary Audit

**Files:**

- Inspect: `apps/bob/src/app/api/v1/**`
- Inspect: `apps/bob/src/app/api/openapi/route.ts`
- Inspect: `packages/bob-client/src/schema.d.ts`
- Inspect: `docs/plans/2026-06-21-bob-effect-rpc-openapi.md`

**Steps:**

1. Inventory external REST routes and group them:
   - public/external stable routes under `/api/v1/**`
   - device routes
   - work-item public API routes
   - run/artifact routes
   - internal-only routes that should not be documented externally
2. Add a test or script that asserts `/api/v1/**` route files do not import `~/trpc/react` or direct browser tRPC clients.
3. Document that REST remains external, Effect-RPC remains first-party.
4. Do not delete any REST route in this batch.

## Batch 2: Migrate Remaining Read-Only Web Slices

**Goal:** Remove tRPC from read-only and polling-heavy web components where contracts already exist.

### Task 2.1: Dashboard Work Lanes

**Files:**

- Modify: `apps/bob/src/components/dashboard/work-lane-table.tsx`
- Modify: `packages/bob-client/src/__tests__/migration-guardrails.test.ts`

**Steps:**

1. Add `work-lane-table.tsx` to migrated guardrail.
2. Run:

   ```bash
   pnpm --filter @gmacko/bob-client exec vitest run src/__tests__/migration-guardrails.test.ts
   ```

   Expected: fails on `work-lane-table.tsx`.

3. Replace `useTRPC()` with `useBobRpcClient()`.
4. Replace `trpc.workItem.list.queryOptions(...)` with:

   ```ts
   const input = { workspaceId: workspaceId ?? "", limit: 100 };
   const { data: workItems, isLoading } = useQuery({
     queryKey: ["rpc", "workItem.list", input],
     queryFn: () => rpc.workItems.list(input),
     enabled: Boolean(workspaceId),
     refetchInterval: 10_000,
   });
   ```

5. Verify guardrail and focused web type scan.

### Task 2.2: Dashboard Agent Run Read Models

**Files:**

- Modify: `apps/bob/src/components/dashboard/recent-runs.tsx`
- Modify: `apps/bob/src/components/dashboard/running-now-rail.tsx`
- Modify: `apps/bob/src/components/dashboard/runner-queue.tsx`
- Modify: `apps/bob/src/components/dashboard/active-dispatches.tsx`
- Modify: `apps/bob/src/components/dashboard/attention-panel.tsx`
- Modify: `packages/bob-client/src/__tests__/migration-guardrails.test.ts`

**Dependencies:**

- Batch 1 Task 1.1 must be complete for `agent.run.listAll`.
- `agent.run.list` already exists for workspace-scoped reads.
- `planning.dispatch.*` methods already exist for dispatch surfaces; confirm client facade methods before editing.

**Steps for each file:**

1. Add file to guardrail.
2. Run guardrail and verify red.
3. Replace `trpc.agentRun.list` with `rpc.agent.run.list`.
4. Replace `trpc.agentRun.listAll` with `rpc.agent.run.listAll`.
5. Replace any `trpc.pullRequest.list` with `rpc.projects.pullRequest.list`.
6. Preserve polling intervals and enabled conditions.
7. Verify focused type scan:

   ```bash
   pnpm --filter @bob/blder exec tsc --noEmit --pretty false 2>&1 | rg "recent-runs|running-now-rail|runner-queue|active-dispatches|attention-panel"
   ```

### Task 2.3: Project and Discovery Read Slices

**Files:**

- Modify: `apps/bob/src/app/(dashboard)/planning/projects/page.tsx`
- Modify: `apps/bob/src/app/(dashboard)/discovery/page.tsx`
- Modify: `apps/bob/src/components/dashboard/project-progress.tsx`
- Modify: `apps/bob/src/components/projects/create-project-dialog.tsx` for read-only ForgeGraph app list first
- Modify: `apps/bob/src/components/projects/import-github-dialog.tsx` for read-only provider data first

**Dependencies:**

- Batch 1 Task 1.2 for explicit project client methods.

**Steps:**

1. Migrate read queries first.
2. Leave mutations in place only if no Effect contract/client method exists; otherwise migrate them in the same file and add invalidation.
3. Keep query keys in this format:

   ```ts
   ["rpc", "projects.discovery", input]
   ["rpc", "projects.list", input]
   ["rpc", "external.forgegraph.listUnlinkedApps", input]
   ```

4. Add all migrated files to guardrail.
5. Verify:

   ```bash
   pnpm --filter @gmacko/bob-client test
   pnpm --filter @gmacko/bob-client typecheck
   ```

### Task 2.4: Workspace, Nodes, and Settings Read Slices

**Files:**

- Modify: `apps/bob/src/app/(dashboard)/nodes/page.tsx`
- Modify: `apps/bob/src/app/(dashboard)/nodes/[machineId]/page.tsx`
- Modify: `apps/bob/src/app/(dashboard)/settings/_components/workspace-agents.tsx`
- Modify: `apps/bob/src/components/layout/sidebar-nav.tsx`
- Modify: `apps/bob/src/components/layout/shell-settings-menu.tsx`

**Dependencies:**

- Explicit `agent.instance.*`, `projects.workspace.*`, and `settings.*` facade methods.

**Steps:**

1. Add guardrails per file.
2. Migrate read queries to `rpc.agent.instance.*`, `rpc.projects.workspace.*`, or `rpc.settings.*`.
3. Preserve loading/empty/error states.
4. Verify focused type scans and guardrail.

## Batch 3: Migrate Web Mutations, Sessions, Realtime Pollers, and Workspace Tools

**Goal:** Remove tRPC from mutation-heavy Bob web surfaces while preserving cache invalidation and workflow behavior.

### Task 3.1: Work Item Interactive Components

**Files:**

- Modify: `apps/bob/src/components/work-items/create-work-item-dialog.tsx`
- Modify: `apps/bob/src/components/work-items/work-item-detail-interactive.tsx`
- Modify: `apps/bob/src/components/work-items/workspace-controls.tsx`
- Modify: `apps/bob/src/components/work-items/requirements-checklist.tsx`
- Modify: `apps/bob/src/components/work-items/add-comment-form.tsx`
- Modify: `apps/bob/src/components/work-items/promote-to-task-button.tsx`

**Contracts/client methods:**

- `workItem.list`
- `workItem.get`
- `workItem.update`
- `workItem.promoteToTask`
- `workItem.comment.*`
- `workItem.requirement.*`
- `workItem.link.*`
- `workItem.taskRun.*`
- `projects.repository.*` where workspace controls touch repositories/worktrees.

**Steps:**

1. For each file, add it to guardrail and verify red.
2. Replace queries/mutations with direct React Query calls.
3. Use stable query key families:

   ```ts
   ["rpc", "workItem.get", { workItemId }]
   ["rpc", "workItem.comment.list", { workItemId }]
   ["rpc", "workItem.requirement.list", { workItemId }]
   ["rpc", "projects.repository.getWorktrees", input]
   ```

4. On mutation success, invalidate exact key families instead of broad global invalidation.
5. Verify behavior by typecheck and, when local app is runnable, browser smoke for create/comment/promote/update.

### Task 3.2: Planning Session and Draft Components

**Files:**

- Modify: `apps/bob/src/components/planning/start-planning-button.tsx`
- Modify: `apps/bob/src/components/planning/new-idea-button.tsx`
- Modify: `apps/bob/src/components/planning/draft-panel.tsx`
- Modify: `apps/bob/src/components/planning/kanban-board.tsx`
- Modify: `apps/bob/src/components/planning/task-tree-editor.tsx`
- Modify: `apps/bob/src/app/(dashboard)/work-items/[workItemId]/plan/[sessionId]/planning-session-client.tsx`

**Contracts/client methods:**

- `planning.session.*`
- `planning.task.*`
- `planning.dispatch.*`
- `planning.listTasks`
- `planning.updateTask`
- `planning.addComment`

**Steps:**

1. Confirm each tRPC procedure has a matching `planning.*` Effect tag.
2. Add any missing client facade methods before touching UI.
3. Add guardrail red per file.
4. Migrate queries and mutations.
5. Preserve polling, draft/session behavior, optimistic local state, and invalidation.
6. Verify:

   ```bash
   rg "useTRPC|~/trpc/react" apps/bob/src/components/planning 'apps/bob/src/app/(dashboard)/work-items/[workItemId]/plan/[sessionId]/planning-session-client.tsx'
   pnpm --filter @gmacko/bob-client test
   ```

### Task 3.3: Session, Event, and Chat Hooks

**Files:**

- Modify: `apps/bob/src/hooks/use-live-activity.ts`
- Modify: `apps/bob/src/hooks/use-file-change-events.ts`
- Modify: `apps/bob/src/hooks/use-workspace-events.ts`
- Modify: `apps/bob/src/hooks/use-session-events.ts`
- Modify: `apps/bob/src/hooks/use-chat-session.ts`
- Modify: `apps/bob/src/components/chat/chat-panel-provider.tsx`
- Modify: `apps/bob/src/components/workflow/session-history.tsx`
- Modify: `apps/bob/src/components/workflow/bob-thinking.tsx`

**Contracts/client methods:**

- `agent.event.*`
- `agent.session.*`
- `agent.chat.*`

**Steps:**

1. Add explicit facade methods if Batch 1 did not already.
2. Migrate polling hooks first; preserve `refetchInterval`.
3. Migrate chat/session mutations second; preserve streaming behavior separately. If a streaming tRPC call has no equivalent in `agent.sendTurn`, stop and add the missing Effect stream contract before UI migration.
4. Verify focused scans:

   ```bash
   rg "useTRPC|~/trpc/react" apps/bob/src/hooks apps/bob/src/components/chat apps/bob/src/components/workflow
   ```

### Task 3.4: Workspace Tools

**Files:**

- Modify: `apps/bob/src/components/capture/floating-capture.tsx`
- Modify: `apps/bob/src/components/workspace/capture-panel.tsx`
- Modify: `apps/bob/src/components/workspace/changeset-actions.tsx`
- Modify: `apps/bob/src/components/workspace/revision-graph.tsx`
- Modify: `apps/bob/src/components/workspace/file-tree.tsx`
- Modify: `apps/bob/src/components/pull-requests/feature-branch-view.tsx`

**Contracts/client methods:**

- `agent.capture.*`
- `agent.filesystem.*`
- `projects.git.*`
- `projects.featureBranch.*`
- `external.forgegraph.*`

**Steps:**

1. Migrate file-tree read operations before write/delete/move operations.
2. For filesystem mutations, preserve confirmation flows and invalidate file listing keys.
3. For feature branches, migrate `projects.featureBranch.*` and PR linkage calls together.
4. Verify guardrail and focused type scans.

### Task 3.5: Preferences, Integrations, and Automation Settings

**Files:**

- Modify: `apps/bob/src/app/(dashboard)/settings/_components/preferences.tsx`
- Modify: `apps/bob/src/app/(dashboard)/settings/_components/integrations.tsx`
- Modify: `apps/bob/src/components/projects/automation-settings.tsx`

**Dependencies:**

- Batch 1 Tasks 1.4 and 1.5.

**Steps:**

1. Add files to guardrail and verify red.
2. Migrate preferences to `rpc.settings.getPreferences/updatePreferences`.
3. Migrate integrations to the selected `rpc.settings.integration.*` or `rpc.integrations.*` group.
4. Migrate automation settings to `rpc.projects.updateAutomationSettings`.
5. Verify behavior in browser if app can run locally.

## Batch 4: Mobile, CLI, Server-Local Consumers, and REST External Access

**Goal:** Remove tRPC from non-web production consumers and make the REST/external boundary explicit.

### Task 4.1: Mobile Bob-Owned Calls

**Files:**

- Modify: `apps/mobile-bob/src/hooks/use-push-notifications.ts`
- Modify: `apps/mobile-bob/src/features/chat/slash-commands.ts`
- Modify: `apps/mobile-bob/src/utils/api.tsx`
- Possibly create: `apps/mobile-bob/src/utils/bob-rpc.ts`

**Rules:**

- Replace Bob-owned `/api/trpc` calls with `@gmacko/bob-client`.
- Leave OODA-specific chat/search/vault tRPC calls alone until OODA contracts exist.
- Mobile client factory must work with React Native `fetch`.

**Steps:**

1. Add or update guardrail allowlist so Bob-owned `/api/trpc` fetches fail outside OODA-specific files.
2. Verify red for Bob-owned mobile files.
3. Create `createMobileBobRpcClient({ baseURL, headers })`.
4. Replace push token registration with `rpc.workItems.notification.registerPushToken`.
5. Replace slash-command Bob-owned procedures only where matching contracts exist.
6. Verify:

   ```bash
   rg "/api/trpc|@trpc" apps/mobile-bob/src
   pnpm --filter @gmacko/mobile-bob typecheck
   ```

### Task 4.2: CLI Consumers

**Files:**

- Modify: `packages/bob/src/cookies/src/cli.ts`

**Steps:**

1. Confirm whether the CLI is remote or local.
2. If remote, use `@gmacko/bob-client` with API-key/session headers.
3. If local-only, call handler/domain functions directly.
4. Preserve command output and error codes.
5. Verify targeted package tests or CLI smoke command.

### Task 4.3: Server-Local Helpers

**Files:**

- Modify: `apps/bob/src/lib/rest/api-helpers.ts`
- Modify: `apps/bob/src/lib/planning/server.ts`
- Modify: `apps/bob/src/server/planning/sync-repos.ts`
- Inspect: `apps/bob/src/lib/edge-router.ts`

**Rules:**

- Server-local callers should prefer handler/domain factories, not remote RPC over HTTP.
- Remote server-to-server calls can use `@gmacko/bob-client`.
- Public REST route behavior must remain stable.

**Steps:**

1. For each helper, classify it as local, remote, or external REST.
2. Replace `createTRPCContext` and `appRouter.createCaller` with direct handler/domain calls where local.
3. Replace `/api/trpc` URL construction in `sync-repos.ts` with `@gmacko/bob-client` or direct domain call depending on runtime.
4. Add regression tests for any REST route touched.
5. Verify:

   ```bash
   pnpm --filter @bob/api test
   pnpm --filter @gmacko/bob-web typecheck
   ```

### Task 4.4: REST API Hardening for External Access

**Files:**

- Modify or inspect: `apps/bob/src/app/api/v1/**`
- Modify or inspect: `apps/bob/src/app/api/openapi/route.ts`
- Modify or inspect: `packages/bob/src/api/src/rest/**`
- Modify: docs if needed

**Target state:**

- `/api/v1/**` remains the external access path.
- `/api/rpc` remains first-party Effect-RPC.
- `/api/trpc` is legacy internal compatibility only until Batch 5.

**Steps:**

1. Ensure every documented external route has a stable OpenAPI operation.
2. Add or update tests for:
   - API-key auth
   - session auth where applicable
   - validation errors
   - one read route
   - one write route
3. If REST bridge is used, ensure it runs in the intended Node runtime; do not mount a bridge that returns 501 in production.
4. Verify:

   ```bash
   pnpm --filter @bob/api test -- publicApi
   pnpm --filter @bob/api test -- rest
   ```

## Batch 5: Retire Bob tRPC

**Goal:** Remove Bob tRPC web route/provider/client dependencies after proving no Bob-owned production consumers remain.

### Task 5.1: Final Consumer Inventory

Run:

```bash
rg "useTRPC|~/trpc/react|/api/trpc|createTRPCClient|createTRPCContext" apps/bob packages/bob packages/bob-client
```

Allowed remaining references before deletion:

- tests that explicitly verify legacy removal
- docs/plans history
- OODA-specific mobile code outside the Bob web/package boundary
- `@trpc/server` inside `@bob/api` only if OpenAPI/REST compatibility still needs it

No production Bob web/mobile/CLI consumer may remain.

### Task 5.2: Remove Web tRPC Provider and Route

**Files:**

- Modify: `apps/bob/src/app/layout.tsx`
- Delete: `apps/bob/src/trpc/react.tsx`
- Delete: `apps/bob/src/trpc/server.tsx`
- Delete: `apps/bob/src/app/api/trpc/[trpc]/route.ts`

**Steps:**

1. Remove `TRPCReactProvider` from layout.
2. Make `BobRpcProvider` the only Bob RPC provider.
3. Delete the web tRPC client/server helper files.
4. Delete the `/api/trpc` route.
5. Verify:

   ```bash
   rg "~/trpc/react|TRPCReactProvider|/api/trpc" apps/bob/src
   pnpm --filter @gmacko/bob-web typecheck
   ```

### Task 5.3: Remove Bob-Only tRPC Dependencies

**Files:**

- Modify: `apps/bob/package.json`
- Modify: relevant lockfile
- Possibly modify: `packages/bob/src/api/package.json`

**Rules:**

- Remove Bob web `@trpc/client` and `@trpc/tanstack-react-query`.
- Keep `@trpc/server` in `@bob/api` until router facades and OpenAPI generation no longer require it.
- Do not remove tRPC dependencies used by OODA or unrelated packages.

**Verify:**

```bash
pnpm install --lockfile-only
pnpm --filter @gmacko/bob-web typecheck
pnpm --filter @bob/api test
pnpm typecheck
```

### Task 5.4: Strengthen Guardrails

**Files:**

- Modify: `packages/bob-client/src/__tests__/migration-guardrails.test.ts`
- Optionally create: `apps/bob/src/__tests__/no-trpc-regression.test.ts`

**Guardrails:**

- Fail any new `~/trpc/react` import in `apps/bob/src`.
- Fail any new `/api/trpc` fetch in Bob-owned production code.
- Fail if `@gmacko/bob-client` imports server-only packages.
- Fail if `apps/bob/src/app/layout.tsx` imports `TRPCReactProvider`.

**Verify:**

```bash
pnpm --filter @gmacko/bob-client test
```

### Task 5.5: Final Verification

Run:

```bash
pnpm --filter @gmacko/bob-client test
pnpm --filter @gmacko/bob-client typecheck
pnpm --filter @gmacko/bob-web typecheck
pnpm --filter @gmacko/mobile-bob typecheck
pnpm --filter @bob/api test
pnpm typecheck
rg "useTRPC|~/trpc/react|/api/trpc|createTRPCClient|createTRPCContext" apps/bob packages/bob packages/bob-client
```

Expected:

- All tests/typechecks pass or only documented unrelated pre-existing failures remain.
- `rg` has no Bob-owned production tRPC consumers.
- REST `/api/v1/**` still exists and tests pass.
- `/api/rpc` remains mounted for first-party Effect-RPC clients.

## Execution Order Summary

1. **Batch 1:** Fill missing contracts/client methods and audit REST boundary.
2. **Batch 2:** Migrate remaining read-only web slices.
3. **Batch 3:** Migrate mutation-heavy web slices, sessions, realtime polling, workspace tools.
4. **Batch 4:** Migrate mobile/CLI/server-local consumers and harden REST external access.
5. **Batch 5:** Remove tRPC provider/route/dependencies and lock guardrails.

## Completion Definition

The migration is done when:

- `@gmacko/bob-client` is the canonical first-party Bob client for web/mobile/CLI remote calls.
- Bob web has no production `~/trpc/react` imports.
- Bob-owned mobile/CLI code has no `/api/trpc` direct fetches.
- Server-local code no longer uses tRPC callers where direct handlers/domain functions are available.
- `/api/v1/**` remains stable and tested as the external REST API.
- `/api/trpc` is deleted from Bob web.
- Bob web no longer depends on `@trpc/client` or `@trpc/tanstack-react-query`.
- No storage migration has occurred.

