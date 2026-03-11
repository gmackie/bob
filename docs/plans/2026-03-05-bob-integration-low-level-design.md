# Bob Low-Level Design For Kanbanger Integration V1

Date: 2026-03-05
Status: Draft implementation design

## Existing Bob surfaces to build on

1. `packages/mcp-server/src/tools/task.ts`
   - existing task tools: `link_task`, `post_task_comment`, `update_task_status`, `complete_task`
2. `packages/api/src/router/session.ts`
   - existing `bootstrapForChat`, `reportWorkflowStatus`, `resolveAwaitingInput`, `getWorkflowState`
3. `packages/api/src/services/sessions/workflowStatusService.ts`
   - already mirrors workflow state to Kanbanger comments/status
4. `apps/nextjs/src/app/api/webhooks/kanbanger/route.ts`
   - already handles assignment and comment events
5. `apps/nextjs/src/lib/tasks/taskExecutor.ts`
   - already creates `task_runs` and linked sessions
6. `apps/nextjs/src/app/chat/*`
   - current chat UI already understands workflow states and awaiting-input behavior
7. `packages/db/src/schema.ts`
   - existing `chat_conversations`, `task_runs`, `session_events`, `repositories`, and `worktrees`

## Design goals

1. Reuse current Bob session and workflow primitives rather than inventing a second execution model.
2. Centralize Kanbanger credentials and policy in Bob, never in the agent session directly.
3. Make issue-linked sessions first-class in Bob chat and API surfaces.
4. Limit v1 schema churn to fields that materially improve correlation or prompt tracking.

## Proposed Bob changes

### 1. Integration config service

Create a small Bob-side integration service for trusted Kanbanger configuration.

Likely files:
- `packages/api/src/services/integrations/kanbangerConfig.ts`
- `packages/api/src/services/integrations/kanbangerVerifier.ts`

Responsibilities:
- load base URL, shared secret, and API key material from env or config
- verify Kanbanger control requests
- normalize correlation ids and deep links

V1 recommendation:
- keep config env-backed because there is one workspace and one Bob deployment
- shape the service as if multi-workspace support will exist later

### 1.1 Control plane contract choice

Use REST for the cross-app boundary even though both apps already use tRPC internally.

Reason:
- explicit auth boundary
- cleaner deployment/versioning across repos
- easier request signing, idempotency, and observability
- each app can still use internal tRPC behind its adapter layer

### 2. Issue-linked session bootstrap

Extend the issue bootstrap path so a control-plane request from Kanbanger can deterministically:

1. find the mapped repository from the Kanbanger project
2. create or reuse a Bob `task_run`
3. create or reuse a `chat_conversation`
4. return stable metadata:
   - Bob session id
   - Bob task run id
   - deep link URL
   - workflow status
   - repository/worktree context

Likely files:
- `apps/nextjs/src/lib/tasks/taskExecutor.ts`
- `packages/api/src/router/session.ts`

### 3. Signed Kanbanger control endpoints

Add Bob endpoints for:

1. start issue session
2. resume issue session
3. stop issue session
4. fetch current issue-session snapshot

Likely files:
- `apps/nextjs/src/app/api/integrations/kanbanger/issues/start/route.ts`
- `apps/nextjs/src/app/api/integrations/kanbanger/issues/resume/route.ts`
- `apps/nextjs/src/app/api/integrations/kanbanger/issues/stop/route.ts`
- `apps/nextjs/src/app/api/integrations/kanbanger/issues/session/route.ts`

Request contract should include:
- workspace id
- issue id
- issue identifier
- project id
- project repository reference
- actor metadata
- idempotency key

Auth contract:
- HMAC signature
- timestamp header
- idempotency key header
- workspace-scoped shared secret

### 4. Evolve existing webhook intake

Refactor `apps/nextjs/src/app/api/webhooks/kanbanger/route.ts` into a general Kanbanger event intake layer.

Required behaviors:
- preserve assignment handling
- preserve comment handling
- add explicit gating so only relevant comments become agent input
- support prompt-thread correlation
- optionally accept review/merge reconciliation events later

Comment ingestion rule for v1:
- only ingest comments when the issue has an active Bob session and the comment replies to the latest Bob prompt thread or explicitly targets Bob
- when accepted, inject the reply into the live transcript as a normal user message with external-source metadata

### 5. Expand MCP tools instead of exposing raw Kanbanger access

Current tools are a good base but too coarse for the v1 UX.

Keep:
- `link_task`
- `post_task_comment`
- `update_task_status`
- `complete_task`

Add or split:
- `report_task_progress`
- `request_task_input`
- `link_task_artifact`
- `set_task_review_ready`
- `record_verification_result`

Likely file:
- `packages/mcp-server/src/tools/task.ts`

Rules:
- tools should produce concise, structured outputs
- Bob decides how those tool calls map to Kanbanger comments and status transitions
- `complete_task` should not move the issue to `done` directly in v1 unless the canonical merged signal has already been observed
- writes should go through one shared Bob-owned Kanbanger write service used by both MCP-triggered and backend-triggered updates
- artifact writes should target the canonical Kanbanger `issue_artifacts` model even when produced by Bob, verification, or humans

### 6. Upgrade workflow-to-Kanbanger publishing

`packages/api/src/services/sessions/workflowStatusService.ts` already mirrors status and questions. Extend it so it becomes the single formatter for:

1. milestone comments
2. blocked comments
3. awaiting-input comments
4. review-ready summaries
5. completion summaries after merge reconciliation

Format requirements:
- no full transcript dumps
- concise Markdown
- include deep link back to Bob
- include options/default/timeout for prompts

### 7. Bob chat UI integration

The chat page should become explicitly issue-aware.

Likely files:
- `apps/nextjs/src/app/chat/page.tsx`
- `apps/nextjs/src/app/chat/_components/session-header.tsx`
- `apps/nextjs/src/app/chat/_components/session-list.tsx`

Additions:
- linked Kanbanger issue badge and identifier
- `Open in Kanbanger` link
- clearer review/blocked metadata
- explicit distinction between general chat sessions and issue-run sessions

### 8. Minimal Bob schema additions

Existing Bob schema already stores most of what v1 needs:
- `chat_conversations.kanbangerTaskId`
- `chat_conversations.workflowStatus`
- `task_runs.kanbangerWorkspaceId`
- `task_runs.kanbangerIssueId`
- `task_runs.kanbangerIssueIdentifier`

Only add new columns if required by implementation pressure. Recommended nullable additions:

To `chat_conversations`:
- `kanbangerIssueIdentifier`
- `lastKanbangerPromptCommentId`
- `lastKanbangerPromptAt`

To `task_runs`:
- `lastMilestoneSummary`
- `reviewUrl`
- `mergeCompletedAt`
- `completionSource`
- `supersededAt`
- `supersededReason`

If prompt correlation can be done from `session_events` plus webhook metadata, defer these columns.

### 9. New run and supersede handling

Rules:
1. Restarting Bob work on an issue creates a new Bob session and task run.
2. The new run receives a structured preamble built from:
   - current issue data
   - prior run summaries
   - current issue artifact set
   - latest review/merge state
3. Repository/project context changes supersede the current run.
4. Superseded runs should be terminal and distinct from ordinary failure.

### 10. Reply race handling

For active prompts:
1. the first valid reply from either Kanbanger or Bob chat wins
2. later replies are recorded as late context only
3. the prompt is not reopened automatically

### 11. Scope update ingestion

Bob should accept structured context updates for substantive issue edits:
- title
- description
- acceptance criteria
- priority
- labels
- dependencies
- assignee changes

Implementation note:
- inject these into the active session as structured user-context update messages
- do not dump the full issue payload every time

## API contracts Bob should expose

### Control API: start

Input:
- workspace id
- project id
- issue id
- issue identifier
- default repository id or repo reference
- auto-start policy context

Output:
- session id
- task run id
- Bob URL
- workflow status
- current state summary

### Control API: resume

Input:
- issue id
- reason or actor

Output:
- session snapshot

### Control API: stop

Input:
- issue id
- actor
- optional reason

Output:
- final state summary

## Verification plan

1. Unit test new MCP tool behavior.
2. Unit test control endpoint signature validation and idempotency.
3. Integration test assignment -> Bob session bootstrap.
4. Integration test structured prompt comment -> Kanbanger reply -> Bob resolution.
5. Integration test review-ready -> merged PR reconciliation.
6. Chat UI e2e for issue-linked session rendering and deep links.
7. Integration test substantive issue edits -> structured context update injected into active Bob run.
8. Integration test repository/project remap -> superseded old run plus fresh run creation.

## Notes on implementation strategy

1. Keep existing `taskExecutor` as the bootstrap spine.
2. Keep Kanbanger writes flowing through Bob-owned abstractions.
3. Do not let the agent call arbitrary Kanbanger APIs directly.
4. Prefer extending current webhook and workflow services over adding a second parallel integration stack.
