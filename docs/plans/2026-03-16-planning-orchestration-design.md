# Planning + Multi-Agent Orchestration Design

> Designed 2026-03-16. Covers AI-assisted plan generation, multi-agent dispatch, and agent protocol standardization.

## Problem

Bob's backend can execute tasks with AI agents, but the front half is weak. Users manually create work items with no AI assistance, the agent type is hardcoded to OpenCode, and there's no way to dispatch multiple agents on related tasks or manage dependencies between them. The gap between "I have an idea" and "agents are working on it" requires too many manual steps.

## Design Decisions

- **Planning is an agent session.** A special Claude session that can read the codebase, ask questions, and create draft tasks interactively. Reuses existing session infrastructure.
- **Draft-then-commit.** Tasks are created in draft state during planning, reviewed as a batch, then committed to the board. Nothing is "real" until the user approves.
- **Auto-dispatch with approval.** Bob suggests agent assignments and shows a dispatch table. User reviews/edits, then kicks off the batch. Dependencies are respected automatically.
- **JSON-RPC stdio protocol bridge.** Adopt T3 Code's agent communication pattern (JSON-RPC over stdio) as Bob's standard. Agent-specific adapters translate between each CLI and Bob's common event model.

## Architecture

### 1. Planning Session Flow

User clicks "Plan with Bob" on the planning page. This creates a session with `sessionType: "planning"` using Claude as the agent (best for reasoning/decomposition).

The planning agent has tools that execution sessions don't:

| Tool | Purpose |
|------|---------|
| `read_codebase` | Explore files, search code, understand architecture |
| `list_existing_tasks` | See what's already planned or in-progress |
| `create_draft_task` | Add a task to the draft staging board |
| `update_draft_task` | Edit a draft's title, description, dependencies |
| `remove_draft_task` | Remove a draft |
| `set_dependency` | Link task A blocks task B |

The user describes their goal. The agent reads the codebase, asks clarifying questions, and progressively creates draft tasks. These appear in a draft panel alongside the chat. The user can steer ("split that into two", "that already exists") and the agent adjusts.

When the agent says "plan complete", the user sees a Plan Review screen with all drafts, descriptions, and a dependency graph.

### 2. Draft Commit + Dispatch Plan

From Plan Review, the user can edit any draft directly. Clicking "Commit Plan" batch-creates all tasks in the planning API with `status: "todo"`, preserving the dependency graph.

Immediately after commit, Bob presents the Dispatch Plan:

| Task | Agent | Branch | Blocked By |
|------|-------|--------|------------|
| ENG-41: Add OAuth routes | opencode | `bob/ENG-41/oauth-routes` | — |
| ENG-42: GitHub provider | claude | `bob/ENG-42/github-provider` | ENG-41 |
| ENG-43: Google provider | claude | `bob/ENG-43/google-provider` | ENG-41 |
| ENG-44: Auth middleware | opencode | `bob/ENG-44/auth-middleware` | ENG-42, ENG-43 |
| ENG-45: E2E tests | codex | `bob/ENG-45/auth-e2e` | ENG-44 |

Bob auto-suggests agent assignments using heuristics (Claude for design-heavy, OpenCode for implementation, Codex for tests). Users can change any assignment via dropdown.

The user sets concurrency (default: 2 parallel agents) and clicks "Dispatch". Bob starts unblocked tasks and queues the rest. As tasks complete, the next unblocked ones auto-start up to the concurrency limit.

### 3. Agent Protocol Bridge

Replace the current `AgentFactory` (tightly coupled to each CLI) with `AgentProcessManager` using JSON-RPC over stdio — the same pattern T3 Code uses.

Communication format:

```
Bob → Agent:  { method: "session.start", params: { workingDirectory, prompt, model } }
Agent → Bob:  { method: "events.output", params: { type: "text", content: "..." } }
Agent → Bob:  { method: "events.toolCall", params: { name: "edit_file", args: {...} } }
```

Each agent type gets a thin adapter in `apps/gateway/src/agents/adapters/` that handles CLI-specific differences. The adapters translate agent output into Bob's common `SessionEvent` model, which feeds into the existing `SessionActor` → WebSocket → UI pipeline.

Benefits:
- All existing chat UI, session management, event persistence works unchanged
- Adding a new agent means writing one adapter file
- Compatible with T3 Code's protocol if they later expose an API

### 4. Task Lifecycle

```
draft → todo → dispatched → running → review_ready → done
                    ↓
                 blocked → (user input) → running
```

New states:
- **`dispatched`** — Agent assigned, waiting for concurrency slot or dependency
- **`review_ready`** — Agent finished, PR created, awaiting human review

On agent completion, Bob automatically:
1. Marks task as `review_ready`
2. Creates PR if the agent didn't
3. Runs ForgeGraph gate progression (build → test → staging)
4. Unblocks dependent tasks when predecessors reach `done`
5. Notifies user via notification panel

User reviews from work item detail — sees PR diff, build status, can approve (→ `done`, triggers dependents) or request changes (→ `running` with feedback).

### 5. Execution Monitoring

The planning page kanban board shows live status on each in-progress card:
- Agent type icon
- Activity indicator (writing code, running tests, blocked, idle)
- Elapsed time
- Click to open chat panel (Cmd+J) with that task's session

## Data Model Changes

**New table: `plan_sessions`**
- `id`, `sessionId` (FK to chatConversations), `workspaceId`, `status` (drafting/committed/abandoned)
- Links a planning session to its draft tasks

**New fields on `task_runs`:**
- `dispatchedAgent` — which agent type was assigned
- `blockedByTaskIds` — array of task IDs this depends on
- `dispatchOrder` — position in the dispatch queue

**New status enum values:**
- `dispatched`, `review_ready`

## API Changes

**New `planSession` tRPC router:**
- `create` — start a planning session
- `commitPlan` — batch-create tasks from drafts
- `getDispatchPlan` — generate agent assignment suggestions
- `dispatch` — start executing the plan
- `updateAssignment` — change agent for a task

**Extended `planning` router:**
- `createDraftTask`, `updateDraftTask`, `removeDraftTask`, `setDependency`

## Implementation Phases

### Phase 1: Planning Sessions + Draft Tasks
The planning agent, draft CRUD tools, plan review UI, commit flow. Highest value — turns "describe a goal" into structured tasks.

### Phase 2: Dispatch Plan + Agent Selection
Dispatch table UI, agent assignment heuristics, concurrency control, dependency-aware scheduling. Turns committed plans into running agents.

### Phase 3: Protocol Bridge
JSON-RPC stdio adapters for Claude Code, Codex, OpenCode. Replace AgentFactory. Makes multi-agent real.

### Phase 4: Auto-Completion Lifecycle
PR auto-creation, ForgeGraph gate integration, auto-unblock of dependents, review_ready flow. Closes the loop from agent output to merged code.

## T3 Code Relationship

Bob adopts T3 Code's agent communication pattern (JSON-RPC over stdio) but does not embed or depend on T3 Code directly. The protocol bridge means:
- Bob's gateway can spawn agents the same way T3 Code does
- If T3 Code stabilizes and exposes an API, it could become an alternative frontend
- Both tools can evolve independently while speaking the same agent protocol

## Not In Scope

- Drag-and-drop task reordering in dispatch plan
- AI auto-review of agent PRs (human review required for v1)
- Cross-repository task dependencies
- Agent cost estimation / budget limits
- Continuous auto-dispatch mode (future evolution of Phase 2)
