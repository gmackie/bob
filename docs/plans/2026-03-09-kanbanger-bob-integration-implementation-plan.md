# Kanbanger + Bob Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the v1 Kanbanger-primary, Bob-execution integration so issues can launch, monitor, guide, and complete Bob-managed work with normalized artifacts, structured prompts, and canonical merge-driven completion.

**Architecture:** Keep the cross-app boundary as a small signed REST integration surface. Kanbanger remains the system of record for issue status, artifacts, and user-facing execution summaries; Bob remains the runtime authority for sessions, workflow state, transcript, and agent tool execution. Reuse existing Kanbanger `agent_sessions` and `agent_task_runs` with a generic `execution_backend` model, and reuse Bob `chat_conversations`, `task_runs`, and MCP/task workflow services rather than inventing a second runtime stack.

**Tech Stack:** Next.js App Router, tRPC, Drizzle ORM, PostgreSQL/Neon, Playwright, existing Bob MCP server, Kanbanger realtime SSE, signed REST endpoints, existing webhook delivery services.

## Before starting

1. Read:
   - `docs/plans/2026-03-05-kanbanger-bob-business-requirements.md`
   - `docs/plans/2026-03-05-kanbanger-bob-high-level-technical-design.md`
   - `docs/plans/2026-03-05-bob-integration-low-level-design.md`
   - `../linear-clone/docs/plans/2026-03-05-kanbanger-integration-low-level-design.md`
2. Verify both repos install and typecheck before changes:

```bash
pnpm -C /Volumes/dev/bob typecheck
pnpm -C /Volumes/dev/linear-clone typecheck
```

Expected: both commands PASS or expose only known pre-existing failures that are documented before work continues.

## Task 1: Add Kanbanger schema for execution backends, artifacts, and richer run/session state

**Files:**
- Modify: `../linear-clone/packages/db/src/schema.ts`
- Create: `../linear-clone/packages/db/drizzle/00xx_bob_execution_backend_and_issue_artifacts.sql`
- Test: `../linear-clone/packages/api/tests/validators.test.ts`

**Step 1: Write the failing schema-level validation tests**

Add tests that assert new enums/schemas accept:
- `execution_backend = "bob"`
- `agent_task_run_status = "superseded" | "failed_to_start"`
- `issue_artifacts` inserts with typed categories and URL metadata only

Use or extend `../linear-clone/packages/api/tests/validators.test.ts` with explicit zod/schema expectations for the new values.

**Step 2: Run the test to verify it fails**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api test -- validators
```

Expected: FAIL because the new schema values and table do not exist yet.

**Step 3: Write the minimal schema implementation**

In `../linear-clone/packages/db/src/schema.ts`:
- extend `integrationTypeEnum` with `"bob"`
- add `executionBackend` columns to `agentSessions` and `agentTaskRuns`
- extend `agentTaskRunStatusEnum` with `superseded` and `failed_to_start`
- add nullable columns to `agentSessions`:
  - `externalSessionId`
  - `externalSessionUrl`
  - `workflowStatus`
  - `lastSyncedAt`
- add nullable columns to `agentTaskRuns`:
  - `externalSessionId`
  - `externalSessionUrl`
  - `latestSummary`
  - `lastPromptCommentId`
  - `reviewUrl`
  - `artifactRefs`
  - `completionSource`
  - `supersededAt`
  - `supersededReason`
- add normalized `issueArtifacts` table with:
  - `issueId`
  - `agentTaskRunId`
  - `executionBackend`
  - `producerType`
  - `producerId`
  - `artifactType`
  - `artifactRole`
  - `url`
  - `title`
  - `summary`
  - `metadata`
  - `isCurrent`
  - timestamps
- add supporting indexes on issue id, run id, current flag, type, role

Keep artifacts append-only. Do not add file/blob storage columns.

**Step 4: Add the Drizzle migration**

Create a migration in `../linear-clone/packages/db/drizzle/` that:
- alters enums
- adds new columns
- creates `issue_artifacts`
- adds indexes

**Step 5: Run the test to verify it passes**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api test -- validators
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/db typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git -C /Volumes/dev/linear-clone add packages/db/src/schema.ts packages/db/drizzle
git -C /Volumes/dev/linear-clone commit -m "feat(db): add execution backends and issue artifacts"
```

## Task 2: Add Kanbanger Bob workspace integration settings and project overrides

**Files:**
- Modify: `../linear-clone/packages/db/src/schema.ts`
- Modify: `../linear-clone/packages/api/src/routers/integration.ts`
- Modify: `../linear-clone/packages/api/src/routers/project.ts`
- Modify: `../linear-clone/apps/web/src/app/dashboard/settings/page.tsx`
- Test: `../linear-clone/packages/api/tests/validators.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- creating/updating a `bob` integration config
- project override payloads for:
  - default repository mapping
  - launch policy
  - default awaiting-input timeout

**Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api test -- validators
```

Expected: FAIL because the new settings shape is not yet supported.

**Step 3: Implement the settings shape**

In `../linear-clone/packages/api/src/routers/integration.ts`:
- add validation for `type = "bob"`
- support settings:
  - `baseUrl`
  - `sharedSecret`
  - `launchPolicy`
  - `defaultAwaitingInputTimeoutMinutes`
  - `commentMirroring`

In `../linear-clone/packages/api/src/routers/project.ts`:
- add project-level override fields and validation
- keep overrides optional so workspace defaults remain authoritative

In `../linear-clone/apps/web/src/app/dashboard/settings/page.tsx`:
- add a Bob integration settings form under workspace integrations
- expose project-level override controls in project settings UI or wire the API if the UI surface already exists elsewhere

**Step 4: Run tests and typecheck**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api test -- validators
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api typecheck
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/web typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/linear-clone add packages/api/src/routers/integration.ts packages/api/src/routers/project.ts apps/web/src/app/dashboard/settings/page.tsx packages/db/src/schema.ts
git -C /Volumes/dev/linear-clone commit -m "feat(integration): add Bob workspace and project settings"
```

## Task 3: Build Kanbanger’s Bob control client and signed REST contract

**Files:**
- Create: `../linear-clone/packages/api/src/services/bob-control-client.ts`
- Modify: `../linear-clone/packages/api/src/services/outbound-webhook.ts`
- Test: `../linear-clone/packages/api/tests/bob-control-client.test.ts`
- Create: `packages/api/src/services/integrations/kanbangerVerifier.ts`
- Create: `packages/api/src/services/integrations/kanbangerConfig.ts`
- Test: `packages/api/src/router/__tests__/kanbanger-control-auth.test.ts`

**Step 1: Write failing tests for request signing and verification**

Create:
- `../linear-clone/packages/api/tests/bob-control-client.test.ts`
- `packages/api/src/router/__tests__/kanbanger-control-auth.test.ts`

Cover:
- HMAC signature generation and verification
- timestamp header validation
- idempotency key presence
- rejection of stale or tampered requests

**Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api test -- bob-control-client
pnpm -C /Volumes/dev/bob --filter @bob/api test -- kanbanger-control-auth
```

Expected: FAIL because the services do not exist.

**Step 3: Implement the Bob-side verifier/config services**

Create:
- `packages/api/src/services/integrations/kanbangerConfig.ts`
- `packages/api/src/services/integrations/kanbangerVerifier.ts`

Responsibilities:
- load trusted Kanbanger config
- verify HMAC signature, timestamp skew, and idempotency headers
- expose helpers reused by all Bob control routes

**Step 4: Implement the Kanbanger control client**

Create `../linear-clone/packages/api/src/services/bob-control-client.ts` with helpers:
- `startIssueSession`
- `resumeIssueSession`
- `stopIssueSession`
- `getIssueSession`

Each method should:
- build signed REST request
- include idempotency key
- parse normalized Bob response
- throw typed errors for UI-safe handling

**Step 5: Run the tests to verify they pass**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api test -- bob-control-client
pnpm -C /Volumes/dev/bob --filter @bob/api test -- kanbanger-control-auth
```

Expected: PASS.

**Step 6: Commit**

```bash
git -C /Volumes/dev/linear-clone add packages/api/src/services/bob-control-client.ts packages/api/tests/bob-control-client.test.ts
git -C /Volumes/dev/linear-clone commit -m "feat(api): add Bob control client"

git -C /Volumes/dev/bob add packages/api/src/services/integrations packages/api/src/router/__tests__/kanbanger-control-auth.test.ts
git -C /Volumes/dev/bob commit -m "feat(api): add Kanbanger control request verification"
```

## Task 4: Add Bob signed REST control endpoints for start, resume, stop, and snapshot

**Files:**
- Create: `apps/nextjs/src/app/api/integrations/kanbanger/issues/start/route.ts`
- Create: `apps/nextjs/src/app/api/integrations/kanbanger/issues/resume/route.ts`
- Create: `apps/nextjs/src/app/api/integrations/kanbanger/issues/stop/route.ts`
- Create: `apps/nextjs/src/app/api/integrations/kanbanger/issues/session/route.ts`
- Modify: `apps/nextjs/src/lib/tasks/taskExecutor.ts`
- Test: `apps/nextjs/src/app/api/integrations/kanbanger/issues/__tests__/routes.test.ts`

**Step 1: Write failing route tests**

Create route tests covering:
- valid signed start request creates or returns latest session snapshot
- duplicate start request is idempotent
- stop request returns blocked outcome contract
- session snapshot route returns normalized linked-session payload

**Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/nextjs test -- kanbanger/issues
```

Expected: FAIL because the routes do not exist.

**Step 3: Implement the routes**

Each route should:
- verify signature and timestamp
- require idempotency key for mutating routes
- call shared execution helpers
- return normalized JSON:
  - `issueId`
  - `sessionId`
  - `taskRunId`
  - `sessionUrl`
  - `workflowStatus`
  - `sessionStatus`
  - `latestSummary`
  - repo/worktree metadata

In `apps/nextjs/src/lib/tasks/taskExecutor.ts`:
- add helpers to create fresh runs
- add helper to supersede active run when repository/project context changes
- return snapshot-friendly data shape

**Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/nextjs test -- kanbanger/issues
pnpm -C /Volumes/dev/bob --filter @bob/nextjs typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/bob add apps/nextjs/src/app/api/integrations apps/nextjs/src/lib/tasks/taskExecutor.ts
git -C /Volumes/dev/bob commit -m "feat(nextjs): add Kanbanger integration control routes"
```

## Task 5: Introduce a shared Bob -> Kanbanger write service with idempotency

**Files:**
- Create: `packages/api/src/services/integrations/kanbangerWriteService.ts`
- Modify: `packages/mcp-server/src/tools/task.ts`
- Modify: `packages/api/src/services/sessions/workflowStatusService.ts`
- Test: `packages/mcp-server/src/tools/__tests__/task.test.ts`
- Test: `packages/mcp-server/src/tools/__tests__/status.test.ts`

**Step 1: Write failing tests for typed milestone and artifact flows**

Extend task/status tool tests to cover:
- reporting progress through a shared write service
- review-ready state
- artifact linking
- completion not moving Kanbanger issue to `done` prematurely

**Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/mcp-server test -- task
pnpm -C /Volumes/dev/bob --filter @bob/mcp-server test -- status
```

Expected: FAIL because the shared write service and tool behavior do not exist yet.

**Step 3: Implement the write service**

Create `packages/api/src/services/integrations/kanbangerWriteService.ts` with methods:
- `reportMilestone`
- `requestInputPrompt`
- `recordPromptResolution`
- `setIssueStatus`
- `attachArtifact`
- `markRunReviewReady`
- `markRunCompletedAfterMerge`

Rules:
- all writes emit idempotency keys
- all writes target Kanbanger’s canonical models
- backend reconciliations and MCP-triggered updates both call this same service

**Step 4: Refactor MCP tools and workflow status service to use the shared service**

In `packages/mcp-server/src/tools/task.ts`:
- add or split tools:
  - `report_task_progress`
  - `request_task_input`
  - `link_task_artifact`
  - `set_task_review_ready`
  - `record_verification_result`
- keep backward-compatible wrappers only if necessary

In `packages/api/src/services/sessions/workflowStatusService.ts`:
- route Kanbanger writes through the shared service
- keep Bob as authority for transcript/workflow event history

**Step 5: Run tests to verify they pass**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/mcp-server test -- task
pnpm -C /Volumes/dev/bob --filter @bob/mcp-server test -- status
pnpm -C /Volumes/dev/bob --filter @bob/api typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git -C /Volumes/dev/bob add packages/api/src/services/integrations/kanbangerWriteService.ts packages/mcp-server/src/tools/task.ts packages/api/src/services/sessions/workflowStatusService.ts packages/mcp-server/src/tools/__tests__
git -C /Volumes/dev/bob commit -m "feat(mcp): route Kanbanger writes through shared service"
```

## Task 6: Add Kanbanger write endpoints/routers for Bob updates and artifact creation

**Files:**
- Modify: `../linear-clone/packages/api/src/routers/agent.ts`
- Modify: `../linear-clone/packages/api/src/routers/issue.ts`
- Create: `../linear-clone/packages/api/src/routers/issue-artifact.ts`
- Modify: `../linear-clone/packages/api/src/routers/index.ts`
- Test: `../linear-clone/packages/api/tests/bob-agent-updates.test.ts`

**Step 1: Write failing API tests**

Create `../linear-clone/packages/api/tests/bob-agent-updates.test.ts` covering:
- Bob status updates change issue/run projection and publish activity
- Bob prompt comment metadata is persisted
- artifact writes create `issue_artifacts` and mark current artifact per role
- repeated idempotency key does not duplicate state

**Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api test -- bob-agent-updates
```

Expected: FAIL because the routes do not exist yet.

**Step 3: Implement the router changes**

In `../linear-clone/packages/api/src/routers/agent.ts`:
- extend active run/session update flows for `executionBackend = "bob"`
- support `failed_to_start`, `superseded`, `handed_off`
- store `latestSummary`, prompt metadata, and external session ids/urls

Create `../linear-clone/packages/api/src/routers/issue-artifact.ts`:
- create human/system artifact rows
- list current issue artifacts
- list grouped child issue artifacts for parent issue views

In `../linear-clone/packages/api/src/routers/issue.ts`:
- expose current artifact summary and Bob run projection in issue detail queries

Register the new router in `../linear-clone/packages/api/src/routers/index.ts`.

**Step 4: Run tests and typecheck**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api test -- bob-agent-updates
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/linear-clone add packages/api/src/routers/agent.ts packages/api/src/routers/issue.ts packages/api/src/routers/issue-artifact.ts packages/api/src/routers/index.ts packages/api/tests/bob-agent-updates.test.ts
git -C /Volumes/dev/linear-clone commit -m "feat(api): add Bob run projection and issue artifacts"
```

## Task 7: Add Kanbanger issue detail Bob panel, run history, and parent artifact roll-up

**Files:**
- Modify: `../linear-clone/apps/web/src/components/tasks/task-detail.tsx`
- Create: `../linear-clone/apps/web/src/components/tasks/bob-panel.tsx`
- Create: `../linear-clone/apps/web/src/components/tasks/bob-run-history.tsx`
- Create: `../linear-clone/apps/web/src/components/tasks/issue-artifact-list.tsx`
- Test: `../linear-clone/apps/web/tests/e2e/agents.spec.ts`

**Step 1: Write the failing UI test**

Add or create E2E coverage that asserts:
- Bob panel appears in the right sidebar
- compact state shows status, latest summary, `Open Bob`, primary action, compact artifact/status strip
- collapsed historical Bob panel shows `Restart with Bob`
- run history renders summary rows

**Step 2: Run the test to verify it fails**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/web test:e2e --grep "Bob panel"
```

Expected: FAIL because the panel components do not exist.

**Step 3: Implement the UI**

Create:
- `bob-panel.tsx`
- `bob-run-history.tsx`
- `issue-artifact-list.tsx`

In `task-detail.tsx`:
- mount the Bob panel in the right sidebar
- show prompt summary for blocked/needs-input states
- keep full response interaction in comments or `Open Bob`
- separate direct parent artifacts from aggregated child artifacts
- expose `Continue in Bob` only for the latest resumable run
- keep timeline comment authorship simple as `Bob`

**Step 4: Run the tests to verify it passes**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/web test:e2e --grep "Bob panel"
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/web typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/linear-clone add apps/web/src/components/tasks
git -C /Volumes/dev/linear-clone commit -m "feat(web): add issue detail Bob panel and run history"
```

## Task 8: Add list/board indicators and attention ordering for Bob-managed issues

**Files:**
- Modify: `../linear-clone/packages/api/src/routers/issue.ts`
- Modify: relevant issue list/board UI under `../linear-clone/apps/web/src/app/dashboard/[workspaceSlug]/...`
- Test: `../linear-clone/apps/web/tests/e2e/agents.spec.ts`

**Step 1: Write the failing UI test**

Add a test that verifies list/board surfaces show indicators for:
- active Bob run
- blocked/needs-input
- in-review
- PR attached
- verification state

And verify clicking the indicator opens issue detail with Bob section expanded.

**Step 2: Run the test to verify it fails**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/web test:e2e --grep "Bob indicators"
```

Expected: FAIL.

**Step 3: Implement the projection and UI**

In `issue.ts`:
- add lightweight Bob projection fields to list queries
- order relevant views so blocked/needs-input Bob issues elevate without globally reordering all columns

In the web app:
- add compact indicators to cards/rows
- wire indicator clicks to expand or focus the Bob panel in issue detail

**Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/web test:e2e --grep "Bob indicators"
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/web typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/linear-clone add packages/api/src/routers/issue.ts apps/web/src/app/dashboard
git -C /Volumes/dev/linear-clone commit -m "feat(web): surface Bob status in issue lists and boards"
```

## Task 9: Add prompt comment targeting, reply ingestion, and race-safe resolution

**Files:**
- Modify: `../linear-clone/packages/api/src/routers/comment.ts`
- Modify: `apps/nextjs/src/app/api/webhooks/kanbanger/route.ts`
- Test: `../linear-clone/packages/api/tests/bob-comment-routing.test.ts`
- Test: `packages/api/src/services/sessions/__tests__/kanbangerWebhook.test.ts`

**Step 1: Write the failing tests**

Cover:
- only targeted/reply comments get routed to Bob
- review-thread comments can flow into `in_review` runs
- first valid reply wins
- late replies are recorded but do not reopen prompt

**Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api test -- bob-comment-routing
pnpm -C /Volumes/dev/bob --filter @bob/api test -- kanbangerWebhook
```

Expected: FAIL.

**Step 3: Implement the routing**

In `comment.ts`:
- include parent comment id / explicit Bob-target metadata in outbound payloads

In Bob webhook route:
- gate replies by active prompt/review context
- inject accepted replies into the active session as normal user messages with source metadata
- handle first-reply-wins semantics

**Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api test -- bob-comment-routing
pnpm -C /Volumes/dev/bob --filter @bob/api test -- kanbangerWebhook
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/linear-clone add packages/api/src/routers/comment.ts packages/api/tests/bob-comment-routing.test.ts
git -C /Volumes/dev/linear-clone commit -m "feat(comment): add Bob-targeted reply routing"

git -C /Volumes/dev/bob add apps/nextjs/src/app/api/webhooks/kanbanger/route.ts packages/api/src/services/sessions/__tests__/kanbangerWebhook.test.ts
git -C /Volumes/dev/bob commit -m "feat(webhooks): route targeted Kanbanger replies into Bob"
```

## Task 10: Add issue edit forwarding, rerun context, and supersede flow

**Files:**
- Modify: `../linear-clone/packages/api/src/routers/issue.ts`
- Modify: `apps/nextjs/src/lib/tasks/taskExecutor.ts`
- Test: `../linear-clone/packages/api/tests/bob-scope-update.test.ts`
- Test: `packages/api/src/router/__tests__/session.issue-rerun.test.ts`

**Step 1: Write the failing tests**

Cover:
- substantive issue edits during active Bob run create structured context updates
- repository/project remap supersedes old run and starts new run
- issue status remains active during supersede

**Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api test -- bob-scope-update
pnpm -C /Volumes/dev/bob --filter @bob/api test -- session.issue-rerun
```

Expected: FAIL.

**Step 3: Implement the behavior**

In `issue.ts`:
- detect substantive field changes:
  - title
  - description
  - acceptance criteria
  - priority
  - labels
  - dependencies
  - assignee
- when active Bob run exists, emit a structured context update event

In Bob:
- accept the update event
- inject a structured user-context update message into the session
- when repository/project context changes, supersede the active run and create a fresh one with inherited preamble

**Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api test -- bob-scope-update
pnpm -C /Volumes/dev/bob --filter @bob/api test -- session.issue-rerun
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/linear-clone add packages/api/src/routers/issue.ts packages/api/tests/bob-scope-update.test.ts
git -C /Volumes/dev/linear-clone commit -m "feat(issue): forward substantive issue changes to Bob"

git -C /Volumes/dev/bob add apps/nextjs/src/lib/tasks/taskExecutor.ts packages/api/src/router/__tests__/session.issue-rerun.test.ts
git -C /Volumes/dev/bob commit -m "feat(tasks): supersede and rerun Bob issue sessions"
```

## Task 11: Add notifications, repeated startup failure escalation, and handoff on reassignment

**Files:**
- Modify: `../linear-clone/packages/api/src/routers/notification.ts`
- Modify: `../linear-clone/packages/api/src/routers/agent.ts`
- Modify: `../linear-clone/packages/api/src/routers/issue.ts`
- Test: `../linear-clone/packages/api/tests/bob-notifications.test.ts`

**Step 1: Write the failing tests**

Cover:
- notifications on needs-input
- notifications on review-ready
- escalation after 2 consecutive `failed_to_start` attempts
- reassigning away from Bob stops active run and marks handoff

**Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api test -- bob-notifications
```

Expected: FAIL.

**Step 3: Implement the behavior**

In `agent.ts` and `issue.ts`:
- count consecutive startup failures in current run context
- write concise timeline entry on first `failed_to_start`
- escalate to stronger comment/notification after second consecutive failure
- on reassignment away from Bob:
  - stop active run
  - mark handed off
  - retain history and artifacts

In `notification.ts`:
- add notification creation paths for the agreed Bob state changes

**Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api test -- bob-notifications
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/api typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/linear-clone add packages/api/src/routers/notification.ts packages/api/src/routers/agent.ts packages/api/src/routers/issue.ts packages/api/tests/bob-notifications.test.ts
git -C /Volumes/dev/linear-clone commit -m "feat(agent): add Bob notifications and handoff behavior"
```

## Task 12: Add Bob chat issue-awareness and deep-link polish

**Files:**
- Modify: `apps/nextjs/src/app/chat/page.tsx`
- Modify: `apps/nextjs/src/app/chat/_components/session-header.tsx`
- Modify: `apps/nextjs/src/app/chat/_components/session-list.tsx`
- Test: `apps/nextjs/e2e/specs/session-header.spec.ts`

**Step 1: Write the failing UI test**

Add assertions for:
- `Open in Kanbanger`
- linked issue identifier
- issue-managed session distinction
- clear active persona/session metadata if available

**Step 2: Run the test to verify it fails**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/nextjs test:e2e --grep "linked issue"
```

Expected: FAIL.

**Step 3: Implement the UI**

In the chat surfaces:
- render linked issue metadata
- render deep link back to Kanbanger
- distinguish issue-managed sessions from generic chat sessions
- keep internal persona details visible in header/history, not in every timeline item

**Step 4: Run the test to verify it passes**

Run:

```bash
pnpm -C /Volumes/dev/bob --filter @bob/nextjs test:e2e --grep "linked issue"
pnpm -C /Volumes/dev/bob --filter @bob/nextjs typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/bob add apps/nextjs/src/app/chat apps/nextjs/e2e/specs/session-header.spec.ts
git -C /Volumes/dev/bob commit -m "feat(chat): add issue-aware session metadata"
```

## Task 13: Add end-to-end integration tests across both repos

**Files:**
- Create or extend: `../linear-clone/apps/web/tests/e2e/agents.spec.ts`
- Create or extend: `apps/nextjs/e2e/specs/workflow-transitions.spec.ts`
- Create: repo-local integration fixtures as needed

**Step 1: Write the end-to-end scenarios**

Add tests for:
1. Assign issue to Bob -> issue panel shows active session
2. Bob requests input -> Kanbanger shows prompt -> comment reply resolves it
3. Bob marks review-ready -> issue enters `in_review` with artifacts
4. Merge signal -> issue `done` and Bob session complete

**Step 2: Run tests to verify initial failures**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/web test:e2e --grep "Bob integration"
pnpm -C /Volumes/dev/bob --filter @bob/nextjs test:e2e --grep "Kanbanger integration"
```

Expected: FAIL until all prior tasks land.

**Step 3: Implement missing fixtures and mocks**

Add only the minimal fixtures needed for deterministic E2E coverage. Do not build new testing-only product APIs.

**Step 4: Run the full targeted suites**

Run:

```bash
pnpm -C /Volumes/dev/linear-clone --filter @linear-clone/web test:e2e --grep "Bob integration"
pnpm -C /Volumes/dev/bob --filter @bob/nextjs test:e2e --grep "Kanbanger integration"
pnpm -C /Volumes/dev/linear-clone typecheck
pnpm -C /Volumes/dev/bob typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Volumes/dev/linear-clone add apps/web/tests/e2e
git -C /Volumes/dev/linear-clone commit -m "test(web): cover Bob integration workflows"

git -C /Volumes/dev/bob add apps/nextjs/e2e
git -C /Volumes/dev/bob commit -m "test(nextjs): cover Kanbanger integration workflows"
```

## Final verification

Run:

```bash
pnpm -C /Volumes/dev/linear-clone typecheck
pnpm -C /Volumes/dev/linear-clone lint
pnpm -C /Volumes/dev/linear-clone build
pnpm -C /Volumes/dev/bob typecheck
pnpm -C /Volumes/dev/bob lint
pnpm -C /Volumes/dev/bob build
```

Expected: PASS in both repos.

## Notes

1. Keep commits small and repo-local even though the plan spans both codebases.
2. Prefer extending current issue/task/session logic instead of building parallel Bob-specific stacks.
3. Keep Kanbanger comments concise and structured; the Bob panel is the canonical latest-state view inside Kanbanger.
4. Do not expose raw Kanbanger credentials to session agents; all agent-facing writes should remain behind Bob-owned tools/services.
