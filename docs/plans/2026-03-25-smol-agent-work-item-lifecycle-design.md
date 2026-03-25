# Smol-Agent Work Item Lifecycle Design

This design explores using `../smol-agent` as the standard agent runtime for the full Bob `work_item` lifecycle while keeping Bob as the control plane and system of record.

## Goal

Use `smol-agent` in Bob as a drop-in runtime for:

- idea expansion
- BRD generation
- epic and task breakdown
- task execution in coding environments
- PR creation and review support
- release management and ship flows

The target is not to move Bob lifecycle semantics into `smol-agent`. The target is to let Bob launch, constrain, observe, and persist lifecycle work powered by `smol-agent`.

## Core Decision

Bob remains authoritative for:

- `work_items`, requirements, dependencies, and workflow state
- task runs, sessions, worktrees, artifacts, and PR records
- human approvals, review gates, and release gates
- UI state and audit history

`smol-agent` becomes the standard execution kernel for Bob-managed runs.

That means:

- Bob decides when a run exists
- Bob decides what a run is allowed to do
- Bob decides how run outputs become first-class Bob objects
- `smol-agent` decides how to accomplish the assigned work within that run

## Why This Fits The Current Codebase

Bob already has product and execution concepts that align with this split:

- `work_items`, tasks, and planning flows
- task runs, active sessions, worktrees, and artifacts
- UI for execution workspaces, PRs, and lifecycle states
- Bob-specific MCP tools for task linking, task status, PR actions, workflow status, and human input

`smol-agent` already has reusable runtime capabilities that Bob can host:

- planning and architect-style prompting
- file, shell, git, and web tools
- session persistence and runtime metadata
- skills support
- read-only sub-agent delegation
- cross-agent communication and registry-based discovery
- a host-shaped runtime boundary in `src/runtime/contracts.js`

This makes the integration primarily an adapter problem, not a product-model rewrite.

## Architecture

The architecture should be a control-plane/runtime split.

Bob owns the lifecycle graph and state model. `smol-agent` runs inside Bob-owned sessions and task runs. Bob injects runtime context, tool policy, working directory, and lifecycle-specific prompts into each run. Bob then captures events, messages, artifacts, and status changes back into its own persistence layer.

The key boundary is:

- Bob is the source of truth for lifecycle state
- `smol-agent` is the worker runtime
- Bob-specific lifecycle semantics are expressed through prompts, skills, MCP tools, and run profiles

`smol-agent` should not become directly responsible for storing canonical Bob lifecycle state. Local `.smol-agent/state` files can exist as runtime cache or recovery data, but Bob should remain authoritative for sessions, task history, and artifacts shown in the UI.

## Bob Host Adapter

Bob should add a `smol-agent` host adapter that does four jobs:

1. Launch and resume `smol-agent` runs from Bob task/session state
2. Inject Bob context, skills, environment, and tool policy into the runtime
3. Translate runtime events into Bob session events and artifacts
4. Persist enough state to resume or inspect work from Bob UI and automation flows

The adapter should conceptually provide:

- Bob-backed session store
- Bob-backed memory or notes store where useful
- Bob-backed event sink
- Bob tool provider, likely through the existing Bob MCP surface
- stage-specific run configuration

This mirrors the host-oriented runtime boundary already present in `smol-agent` and lets Bob treat the runtime as a pluggable kernel.

## Run Profiles

Bob should not have one generic agent launch path. It should define run profiles by lifecycle stage and role.

Suggested initial profiles:

- `shape-agent`
- `planning-agent`
- `task-executor`
- `task-reviewer`
- `feature-reviewer`
- `release-manager`

Each profile should define:

- system prompt
- enabled skills
- allowed tools
- allowed network policy
- working directory rules
- linked Bob objects such as `workItemId`, `taskRunId`, `sessionId`, `prId`
- expected outputs
- completion contract

This keeps the runtime generic while making Bob lifecycle behavior explicit and testable.

## Lifecycle Mapping

### Shape

Purpose:

- turn a rough idea into a stable parent issue or epic
- ask clarifying questions one at a time
- generate a concise problem statement, scope, constraints, risks, and success signals
- attach a BRD artifact when the work is large enough to need one

Bob outputs:

- parent `work_item`
- description updates
- BRD artifact
- initial requirement categories

Runtime profile:

- `shape-agent`
- Bob workflow skill
- Bob work-item shaping skill
- work item mutation tools
- artifact creation tools
- optional web research policy

### Plan

Purpose:

- read the parent issue or epic plus BRD
- normalize scope into requirements
- create child tasks with dependencies and ownership links

Bob outputs:

- requirement rows on the parent
- child tasks
- dependency edges
- task-to-requirement ownership links

Runtime profile:

- `planning-agent`
- Bob workflow skill
- Bob work-item breakdown skill
- planning mutation tools
- requirement linking tools

### Execute

Purpose:

- perform one task in a coding environment
- edit code, run commands, run tests, and create a task-level PR or equivalent review object

Bob outputs:

- task run
- linked session
- worktree
- changed files and session events
- verification artifacts
- task PR record

Runtime profile:

- `task-executor`
- file, git, shell, and test tools
- Bob task/session/PR tools
- worktree-scoped permissions

### Review

Purpose:

- review a task PR, feature branch, or combined changeset against parent scope and requirements

Bob outputs:

- review artifact
- requirement coverage summary
- review decision or requested changes

Runtime profile:

- `task-reviewer` or `feature-reviewer`
- mostly read-only tools
- diff and artifact inspection tools
- explicit review submission tool

### Ship

Purpose:

- handle merge, release-note generation, deploy triggering, and release-state updates after approvals are satisfied

Bob outputs:

- merge record
- release artifact
- deploy trigger record
- final lifecycle transition

Runtime profile:

- `release-manager`
- narrowest mutation authority
- explicit merge and release tools
- approval-gated actions

## Multi-Agent Options

There are two viable orchestration models.

### Option A: Bob-Orchestrated Multi-Run Workflow

Bob explicitly creates parent and child runs as first-class Bob objects.

Example:

- shape run creates an epic
- planning run creates five child tasks
- Bob dispatches three task-executor runs in parallel
- Bob launches a feature-review run when all required task runs pass
- Bob launches a release-manager run after review and approvals

Advantages:

- strongest observability
- clean mapping to Bob task runs and UI
- easier retries and replacement of failed runs
- straightforward audit trail
- aligns with current Bob data model

Disadvantages:

- more orchestration logic in Bob
- less freedom for the runtime to dynamically restructure work

### Option B: Top-Level Smol-Agent Run With Internal Delegation

Bob launches one top-level lifecycle run and the runtime uses native delegation or cross-agent workflows internally.

Advantages:

- more natural use of `smol-agent` multi-agent capabilities
- less explicit orchestration code in Bob
- potentially more flexible decomposition at runtime

Disadvantages:

- weaker first-class visibility unless Bob mirrors internal children
- harder mapping from internal delegation to Bob task runs and artifacts
- higher risk that important lifecycle work becomes trapped in chat logs or private runtime state
- current `delegate` implementation is read-only research, not full execution fan-out

## Recommendation

Start with Option A.

Use Bob-orchestrated runs as the lifecycle backbone and allow `smol-agent` internal delegation only as an execution detail inside a run. That gives Bob strong observability and keeps the integration close to a drop-in runtime model.

Then add a hybrid path later:

- Bob remains the owner of parent and child lifecycle runs
- selected internal delegated work from `smol-agent` can be imported or mirrored into Bob as sub-runs, artifacts, or trace events

This keeps the door open for deeper native multi-agent behavior without blocking the first integration.

## Data And Persistence Expectations

Canonical Bob state should include:

- run profile and runtime kind
- lifecycle stage
- linked `work_item`, parent run, `taskRun`, `session`, `worktree`, and `pr`
- status and phase transitions
- summarized agent outputs
- artifacts created by the run
- review and verification outcomes

`smol-agent` local persistence can still be used for:

- crash recovery
- transcript snapshots
- local memory or notes
- runtime debugging

But Bob should own the records used by product UI, automation, and lifecycle decisions.

## Tool Policy Strategy

Tool policy must be stage-specific rather than global.

Examples:

- `shape-agent`: workflow, artifact, work-item edit, optional web
- `planning-agent`: planning mutations, requirements, dependencies, no broad code-edit tools
- `task-executor`: file, shell, git, tests, PR, task status
- `task-reviewer`: read-only code and diff access, review output tools, no arbitrary writes
- `release-manager`: merge, release-note, deploy, and status tools only after approval checks

Bob should be the authority that composes and enforces these tool grants.

## Output Contract

Lifecycle outputs must become first-class Bob objects, not just messages in a transcript.

Examples:

- BRD becomes a documentation artifact
- requirement extraction becomes requirement rows
- breakdown becomes child tasks and dependency links
- code execution becomes task runs, validation artifacts, and PR records
- review becomes a review artifact and decision
- ship becomes merge and release records

The transcript remains useful, but it is not the source of truth for lifecycle progress.

## Phased Implementation

### Phase 1: Runtime Adoption

- add Bob `smol-agent` host adapter
- add Bob run profiles for shape, plan, execute, review, and ship
- launch `smol-agent` for task execution first
- persist run/session state in Bob
- connect Bob MCP tools into runtime launch profiles

### Phase 2: Planning And Shaping

- wire `shape-agent` to issue and epic creation flows
- wire `planning-agent` to requirement extraction and task breakdown
- store BRDs and planning outputs as Bob artifacts and requirement records

### Phase 3: Review And Ship

- add reviewer and release-manager profiles
- produce review artifacts and release artifacts from runtime runs
- enforce approval-gated mutation paths for merge and deploy actions

### Phase 4: Hybrid Multi-Agent Visibility

- allow selected internal `smol-agent` delegation events to surface as Bob sub-runs or trace nodes
- decide whether Bob should import internal child activity as first-class lifecycle records

## Open Questions

- should Bob session state fully replace `smol-agent` session persistence, or should the runtime keep dual persistence for recovery?
- where should long-running orchestration live: `apps/execution`, gateway-managed runtime services, or a dedicated internal control API?
- how much of `smol-agent` cross-agent messaging should be visible in Bob UI?
- should task-level PR creation remain Bob-native via tools, or should Bob also ingest git-derived PR state passively?
- what approval model is required before `release-manager` can merge or deploy?

## Recommended Next Step

Write an implementation plan for Phase 1 that:

- defines the Bob `smol-agent` host adapter boundary
- chooses the first lifecycle entry point, likely task execution
- specifies run profile schemas
- maps runtime events into Bob session events and artifacts
- defines the minimum persistence additions required to support launch, resume, inspect, and retry
