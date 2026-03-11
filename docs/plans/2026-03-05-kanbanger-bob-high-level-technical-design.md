# Kanbanger + Bob High-Level Technical Design

Date: 2026-03-05
Status: Draft architecture

## Architectural stance

Use a split integration model:

1. Kanbanger remains the system of record for issue lifecycle, review state, and merge completion.
2. Bob remains the runtime host for live agent sessions, worktree management, chat, and execution telemetry.
3. Bob-owned MCP tools are the primary write path from agent sessions into Kanbanger.
4. A small trusted server-to-server control plane handles session launch, resume, stop, and event intake between Kanbanger and Bob.

This avoids putting Kanbanger credentials inside every session while still letting the agent express intentional updates through tools.

## System ownership

| Concern | System of record | Notes |
|---|---|---|
| Issue status | Kanbanger | Includes `in_progress`, `blocked`, `in_review`, `done` |
| PR merge completion | Kanbanger/ForgeGraph | Canonical completion signal |
| Live transcript and tool activity | Bob | Not mirrored in full |
| Active session lifecycle | Bob | One active session per issue |
| Human-facing milestone updates | Kanbanger + Bob | Comments in Kanbanger, richer context in Bob |
| Blocking questions | Bob creates, Kanbanger surfaces | Response can come from either side |
| Repository/worktree execution | Bob | Project default repository chosen from Kanbanger config |

## Core entities

### Kanbanger entities

1. Issue: primary workflow object.
2. Agent task run: issue-level execution record for backend-managed work.
3. Agent session: integration-visible session metadata for the active backend link.
4. ForgeGraph review/build/deploy overlays: canonical source for review and merge decisions.
5. Issue artifacts: normalized artifact rows attached to issues and rolled up to parent issues at query time.
6. Notifications and list-view indicators: Kanbanger-native projection of attention states such as blocked, needs-input, and review-ready.

### Bob entities

1. `chat_conversations`: live session container with workflow state and linked Kanbanger task id.
2. `task_runs`: durable Bob-side execution record tied to a Kanbanger issue.
3. `session_events`: event stream for workflow state, prompts, and resolutions.
4. Repository/worktree/agent-instance records: local execution context.

## Control channels

### 1. Kanbanger -> Bob control API

Purpose:
- Start a session
- Resume a blocked/paused session
- Stop a session
- Query active session metadata for issue panel rendering if needed

Properties:
- signed server-to-server requests
- REST contract with internal tRPC hidden behind each app boundary
- workspace-trusted in v1
- idempotent by issue id and action
- synchronous request/response returning the latest session snapshot

### 2. Kanbanger -> Bob event webhooks

Purpose:
- assignment events
- comment events
- possibly merge/review notifications where direct control API is not appropriate

Properties:
- asynchronous
- retriable
- delivery logged

### 3. Bob -> Kanbanger MCP-backed tools

Purpose:
- link issue context
- publish progress
- post structured comments
- move issue state to `in_progress`, `blocked`, `in_review`
- attach artifacts
- mark Bob-side completion after merged PR signal

Properties:
- credentials live in Bob-owned integration layer
- agent sees safe, session-scoped tools
- policy enforcement stays centralized in Bob

## End-to-end lifecycle

### Flow A: assignment to Bob

1. Issue is assigned to the Bob assignee identity in Kanbanger.
2. Kanbanger decides whether to auto-start or wait for manual start based on workspace policy.
3. Kanbanger calls Bob control API or emits an assignment event.
4. Bob creates or reuses the issue-linked `task_run`, creates the session, links the issue, and returns session metadata.
5. Kanbanger issue panel updates with `Open Bob`, status, and latest summary.

### Flow B: normal progress

1. Agent performs work in Bob.
2. Agent uses Bob MCP tools to publish typed milestones and artifacts.
3. Bob updates its local workflow state and posts structured updates into Kanbanger.
4. Kanbanger stores issue-visible projection updates locally and publishes realtime refresh events to the page.
5. The same projection powers issue detail, list indicators, notifications, and parent summaries.

### Flow C: awaiting input

1. Agent requests input in Bob.
2. Bob records `awaiting_input` in session state and posts a structured prompt comment to Kanbanger.
3. A human replies in Kanbanger or Bob.
4. Valid Kanbanger replies are injected into Bob as normal user messages with source metadata.
5. Bob resolves the prompt, records the resolution, and moves back to `working`.
6. If the prompt times out, Kanbanger receives a concise visible resolution entry noting the default action taken.

### Flow D: review ready

1. Agent links PR and verification artifacts.
2. Bob sets workflow state to `awaiting_review` and moves the issue to `in_review`.
3. Kanbanger panel highlights review readiness and linked artifacts.

### Flow E: merged PR completion

1. ForgeGraph or repo integration observes the canonical merge signal.
2. Kanbanger moves the issue to `done`.
3. Kanbanger informs Bob or Bob polls/calls back for reconciliation.
4. Bob marks the linked run and session complete.

### Flow F: restart and supersede

1. A restarted issue always creates a fresh Bob run/session.
2. Bob builds a structured preamble from issue state, prior summaries, and current artifacts.
3. If repository/project context changes, the previous run is marked `superseded`.
4. The issue remains in its current active state while the new run takes over.

### Flow G: reassign away from Bob

1. If an issue is reassigned away from Bob while a Bob run is active, the run is stopped.
2. Kanbanger records the run as handed off.
3. Bob history and artifacts remain intact, but Bob is removed from the active control path.

## Trust and auth model

### V1

1. One Kanbanger workspace and one Bob deployment.
2. Workspace-level shared trust between backends.
3. Bob still enforces its own login for UI access.
4. `Open Bob` can land users in Bob as a separately authenticated user; no shared identity required in v1.
5. `Open Bob` should deep-link directly to the issue-linked chat session.

### Post-v1

1. Signed deep links with richer user context.
2. Shared identity/SSO mapping.
3. Multi-workspace and multi-deployment routing.

## Synchronization model

1. Kanbanger is authoritative for issue state and merge completion.
2. Bob is authoritative for live workflow state during execution.
3. Bob emits milestone summaries, not full transcript payloads.
4. Kanbanger is authoritative for issue-visible artifact records and parent roll-ups.
5. Both systems must attach stable correlation keys:
   - Kanbanger issue id
   - issue identifier
   - Bob session id
   - Bob task run id
   - optional PR id / ForgeGraph run id

## Failure and idempotency expectations

1. Session start is idempotent by active issue id.
2. Duplicate assignment events should not create duplicate Bob sessions.
3. Duplicate milestone comments should be deduped where practical, or at least made harmless.
4. Merge completion should be safe to replay.
5. Control API failures should surface cleanly in the Kanbanger panel rather than silently failing.
6. Webhook and control requests need delivery logging and correlation ids across both systems.
7. Bob to Kanbanger writes should use a shared write service with idempotency enforced in both systems.
8. Repeated startup failure should escalate from panel-only error to stronger timeline visibility after repeated consecutive failures.
9. For prompt resolution, the first valid reply wins and later replies are recorded as late context only.

## Why this architecture

This architecture matches the product requirement that Kanbanger stay primary while Bob remains the execution environment. It preserves the existing strengths of both apps:

1. Kanbanger already owns issue, comment, notification, and ForgeGraph state.
2. Bob already owns chat sessions, workflow states, agent tools, worktrees, and runtime control.
3. MCP remains the agent-facing abstraction.
4. Server-to-server control APIs keep lifecycle orchestration explicit and auditable.
