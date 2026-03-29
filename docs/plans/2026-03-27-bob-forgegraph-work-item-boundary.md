# Bob + ForgeGraph Work Item Boundary

Date: 2026-03-27
Status: Proposed target architecture

## Goal

Define the short-term target boundary where `ForgeGraph` becomes the system of record for `work_items` and `Bob` becomes the planning and execution engine acting against that graph.

This replaces the current merged-monorepo assumption that Bob owns canonical `work_items`.

## Executive Summary

Short term, the platform should converge on:

1. `ForgeGraph` owns the canonical graph of work items and their lifecycle state.
2. `Bob` owns planning and execution runtimes, including decomposition, BRD generation, agent sessions, local workspaces, and execution telemetry.
3. `Bob` is allowed to mutate the ForgeGraph work graph directly as a trusted operator.
4. `ForgeGraph` owns policy, approvals, release state, CI/deploy/monitoring facts, and the authoritative audit trail.

This keeps one source of truth for work state while preserving Bob's strength as the autonomous system that turns work items into scoped tasks, code changes, verification, and release-ready changes.

## Why This Boundary

The current split creates an eventual conflict:

- Bob already owns planning and decomposition behavior.
- ForgeGraph already owns changesets, PRs, CI, deployments, promotion state, and monitoring.

If Bob remains canonical for `work_items` while ForgeGraph remains canonical for delivery state, the product ends up with two control planes:

- Bob deciding what work exists and what state it is in
- ForgeGraph deciding what code, CI, staging, deployment, and release state exists

That is the wrong seam. A task is not complete until the code and delivery state say it is complete. The work graph therefore belongs next to the delivery graph.

## Ownership Model

### ForgeGraph owns

ForgeGraph is authoritative for:

- `work_items`
- parent/child work item edges
- work item type and state
- planning artifact metadata linked to work items
- changesets and changeset identity (`jj`, `git`, branch refs, PR refs)
- PR records and review/merge state
- CI runs and evidence
- staging and production deployment records
- monitoring, health, and alert-derived operational facts
- approval policy and release policy
- release candidates and promotion decisions
- operator-visible audit history

### Bob owns

Bob is authoritative for:

- planning sessions
- task decomposition logic
- BRD generation logic
- planning artifacts before and during upload
- agent sessions and transcripts
- local workspaces and repository execution state
- JJ and git operations performed during execution
- execution telemetry and local run state
- decisions about what to propose or do next during planning/execution

Bob is not authoritative for the final persisted work graph. Bob computes and acts; ForgeGraph persists and governs.

## Trusted Operator Model

Bob should be treated inside ForgeGraph as a first-class trusted operator identity rather than a generic API client.

That identity needs scoped powers to:

- create child work items
- update work item type
- attach BRDs and planning artifacts
- create or link task execution records
- attach JJ changesets and git refs
- link PRs, CI runs, staging runs, and deployment artifacts
- move a work item into execution-ready states
- request or trigger production PR creation
- close work items when policy and delivery facts allow it

Every mutation performed by Bob must still become a ForgeGraph-native action with:

- idempotency
- auditability
- policy evaluation
- actor attribution

## Work Item Lifecycle

### 1. Intake

1. A work item exists in ForgeGraph as an issue, task, alert-driven incident, or other intake object.
2. ForgeGraph exposes that work item to Bob as available for planning or execution.
3. Bob loads the current graph state and any existing linked delivery evidence.

### 2. Planning

1. Bob may update the type of the work item.
2. Bob may generate a BRD with detailed requirements.
3. Bob uploads planning artifacts and links them to the work item.
4. Bob may create child work items directly in ForgeGraph.
5. Bob may link parent issue, epic, and task structures as part of decomposition.

### 3. Execution

1. Individual task work items become executable by agents.
2. Bob starts agent execution against a task work item.
3. Bob maintains local session state, repository state, and generated changes.
4. Bob posts changeset identities, artifacts, and execution facts back into ForgeGraph.

### 4. Validation

1. Bob monitors CI workflows and task-level verification.
2. ForgeGraph stores the canonical CI, artifact, review, and staging records.
3. A task may move back into an execution state if validation or staging indicates more work is required.
4. Bob can pick the task back up using the same canonical work item.

### 5. Promotion

1. Bob can assemble validated task work into a production PR.
2. ForgeGraph applies application-level policy for auto-approval or manual approval.
3. ForgeGraph governs whether production merge and deployment proceed automatically or stop for review.
4. Bob observes the result and closes or reopens work accordingly.

## Why ForgeGraph Should Own Work Items

The canonical work graph belongs with delivery state for four reasons:

1. A work item is meaningful only in relation to the code changes and delivery evidence attached to it.
2. Staging, production, and monitoring feedback can reopen or reshape the same work item.
3. Monitoring alerts often originate future work items, which means operations naturally feed the planning graph.
4. Approval and release policy already belong in ForgeGraph, so work completion should not be decided elsewhere.

This makes ForgeGraph the delivery control plane, not just a deployment log.

## Required ForgeGraph Capabilities

ForgeGraph needs first-class support for:

- canonical `work_items` schema
- work item type transitions
- work item hierarchy and dependency edges
- BRD and planning artifact linkage
- changeset linkage from both `jj` and `git`
- execution, review, CI, staging, production, and monitoring facts attached to work items
- Bob-authored idempotent mutation APIs
- application/workspace policy for approvals and automation
- operator event history showing why a work item advanced, reopened, or stalled

## Required Bob Capabilities

Bob needs to keep and evolve:

- planning profiles and decomposition logic
- BRD generation and artifact production
- local execution state, transcripts, and run orchestration
- repository-safe mutation logic
- JJ changeset creation and publication
- CI monitoring and interpretation
- logic for taking a work item from planning through execution and back again after failed validation

Bob should stop treating its own DB tables as canonical work-item truth. Any local `work_items` model should become a cache, projection, or convenience index only.

## API Shape

The interface between Bob and ForgeGraph should support three classes of operations.

### 1. Graph mutation

Bob needs APIs to:

- create work items
- update type/state/parentage
- attach artifacts
- link changesets
- link PRs and CI runs
- request staging and production transitions

### 2. Event reporting

Bob needs APIs to:

- report planning milestones
- report execution session state
- report CI observations
- report task re-entry conditions
- report generated recommendations or blockers

### 3. Read models

Bob needs APIs to:

- fetch executable work
- fetch complete work-item context
- fetch policy and automation settings
- fetch linked changeset, PR, CI, and deployment state
- fetch monitoring and alert context relevant to the work item

## Policy Boundary

Application-level policy should live in ForgeGraph, not Bob.

Examples:

- whether task creation from a BRD is automatic
- whether execution starts automatically
- whether staging deploy happens automatically
- whether production PRs are auto-created
- whether production approval is automatic or manual
- whether merge to production is automatic after approval

Bob should request transitions and provide facts. ForgeGraph should decide whether those transitions are allowed, automatic, or blocked pending review.

## Migration Guidance

The safe migration path is:

1. Add ForgeGraph-native `work_items` and linkage primitives.
2. Introduce stable ForgeGraph IDs into Bob for all planning/execution flows.
3. Convert Bob writes into ForgeGraph-native mutations and events.
4. Demote Bob-local `work_items` to projection/cache status.
5. Remove Bob assumptions that local work-item state is canonical.

## Out Of Scope For This Phase

This document does not decide:

- whether the long-term work graph should remain inside ForgeGraph forever
- whether infrastructure control should stay in the same product boundary as delivery state
- whether monitoring/infra should be further separated operationally

Those are longer-term architecture questions and should be analyzed primarily in the ForgeGraph repo because they affect the future shape of the delivery control plane itself.
