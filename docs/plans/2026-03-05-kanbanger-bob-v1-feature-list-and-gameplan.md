# Kanbanger + Bob V1 Feature List And Game Plan

Date: 2026-03-05
Status: Draft v1 plan

## V1 feature list

### Kanbanger product surface

1. Issue detail page gets a minimal Bob panel.
2. The panel shows session status, workflow status, latest summary, repository context, PR/build/test links, and last update time.
3. The panel provides `Start`, `Resume`, `Stop`, and `Open Bob` actions.
4. Timeline shows structured Bob milestone comments.
5. Timeline shows structured Bob input prompts with options, default action, timeout, and deep link.
6. Humans can answer Bob from Kanbanger comments, subject to reply/mention gating.
7. The panel shows current/latest run only, plus a compact run history section.
8. Parent issues show aggregated child artifacts grouped by child issue.
9. The panel remains visible for active Bob work and collapses for historical Bob work, still offering `Restart with Bob`.
10. The sidebar shows the latest prompt summary for blocked or needs-input issues, but full reply interaction stays in comments or Bob.

### Bob product surface

1. Bob chat/session header shows linked Kanbanger issue context as first-class metadata.
2. Bob chat continues to render workflow states such as `working`, `awaiting_input`, `blocked`, `awaiting_review`, and `completed`.
3. Bob can deep-link into an issue-linked session from Kanbanger.
4. Bob can distinguish between ordinary chat and issue-managed work.

### Integration control plane

1. Kanbanger can start, resume, and stop Bob sessions through a trusted server-to-server control API.
2. Bob consumes assignment and comment events from Kanbanger.
3. Bob posts issue updates back through Bob-owned MCP tools backed by Kanbanger APIs.
4. Both sides enforce one active session per issue.
5. The integration boundary is signed REST, while each app keeps using internal tRPC behind that boundary.

### Workflow automation

1. Bob can move issues to `in_progress`, `blocked`, and `in_review`.
2. Bob can publish milestone summaries and attach artifacts.
3. Bob can request human input and set timeout/default behavior.
4. Kanbanger/ForgeGraph merge state moves the issue to `done` and closes the Bob loop.
5. `Stop` from Kanbanger stops the Bob session and blocks the issue with a human-readable reason.
6. Substantive issue edits are forwarded into the active Bob run as structured context updates.
7. Repository/project context changes supersede the current run and start a new one.
8. Reassigning away from Bob stops the active Bob run and marks it handed off.
9. Prompt races resolve with first valid reply winning.

### Mobile

1. Mobile shows Bob state, milestone comments, prompts, and links.
2. Mobile does not need start/stop/session control in v1.

### Cross-view visibility

1. List and board views show lightweight indicators for:
   - active Bob run
   - blocked or needs-input
   - in-review
   - PR attached
   - current verification state
2. Clicking those indicators opens issue detail with the Bob/artifact area expanded.
3. Blocked and needs-input issues get elevated in relevant views without fully rewriting board ordering.

### Notifications

1. Kanbanger sends notifications for:
   - needs input
   - review ready
   - repeated startup failure
2. Routine progress updates remain panel and timeline only.

## V1 exclusions

1. Full transcript mirroring.
2. Shared identity or SSO between the two apps.
3. Multi-workspace routing UI.
4. Multiple public Bob assignees.
5. Advanced permissions beyond current workspace trust.
6. Mobile control actions.

## Delivery game plan

### Phase 0: Align existing integration primitives

Bob:
- Audit current Kanbanger linkage in `packages/mcp-server/src/tools/task.ts`.
- Audit current workflow mirroring in `packages/api/src/services/sessions/workflowStatusService.ts`.
- Audit current event intake in `apps/nextjs/src/app/api/webhooks/kanbanger/route.ts`.

Kanbanger:
- Audit issue detail rendering in `apps/web/src/components/tasks/task-detail.tsx`.
- Audit current agent execution tables and router flows in `packages/api/src/routers/agent.ts`.
- Audit outbound webhook and realtime publishing in `packages/api/src/services/outbound-webhook.ts` and `packages/realtime/src/sse-server.ts`.

### Phase 1: Workspace integration config and canonical data model

Kanbanger:
- Add or extend workspace integration config for Bob deployment URL and shared secret.
- Add project-level default repository mapping and launch policy if missing.
- Add workspace default and project override for awaiting-input timeout.
- Add generic `execution_backend` support while only enabling `bob` in v1.
- Define the server-side Bob control client.

Bob:
- Define trusted Kanbanger workspace configuration and request verification.
- Normalize issue-linked session lookup by issue id, issue identifier, and task run.

### Phase 2: Start/resume/stop control path

Kanbanger:
- Wire issue panel actions to the Bob control client.
- Surface control failures inline in the panel.

Bob:
- Add signed control endpoints for session start, resume, stop, and session lookup.
- Reuse existing `taskExecutor` and session bootstrap flows where possible.

### Phase 3: Issue panel and milestone visibility

Kanbanger:
- Build the minimal Bob panel on the issue page.
- Add issue query projections for active Bob run, workflow status, last summary, run history, and artifacts.
- Publish realtime updates so the panel refreshes without reload.
- Add normalized issue artifact storage plus parent roll-up query support.

Bob:
- Push session state changes and milestone summaries in a structured way.
- Expose stable deep links for issue-linked sessions.

### Phase 4: Blocking questions and bidirectional reply ingestion

Bob:
- Upgrade workflow status/comment posting to emit structured prompt comments.
- Track enough prompt metadata to decide which Kanbanger comments count as agent input.

Kanbanger:
- Render prompt comments clearly.
- Ensure replies or Bob mentions can be recognized and routed back.

### Phase 5: Review, artifacts, and completion

Bob:
- Add first-class MCP helpers for milestone updates, review-ready state, and artifact linking.
- Publish review links and verification summaries.

Kanbanger:
- Consume canonical ForgeGraph/merge signals.
- Move issue to `done` from merged PR state and complete the linked Bob run.
- Surface current run artifacts and grouped child artifact roll-ups.

### Phase 6: Mobile read-only and operational hardening

Kanbanger:
- Expose Bob data in mobile projections.
- Improve notifications for blocked/needs-input states.

Both:
- Add idempotency, retries, and delivery logs for the cross-system bridge.
- Add dashboards or admin views for integration health later if needed.

## Recommended implementation order

1. Kanbanger workspace config plus Bob control client.
2. Bob signed control endpoints plus session lookup.
3. Kanbanger execution-backend schema updates plus normalized issue artifacts.
4. Kanbanger issue panel.
5. Structured Bob milestone comments.
6. Structured prompt comments and reply ingestion.
7. Review/completion wiring to ForgeGraph merge state.
8. Mobile read-only follow-up.
