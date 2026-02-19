# ForgeGraph WorkspaceManager + Integration Gate API Spec — 2026-02-12

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Define a JJ-native control contract where Bob executes local workspace operations and `linear-clone` (KanBanger/ForgeGraph) owns remote revision/build/deploy state.

**Architecture:** Bob provides a strict WorkspaceManager API for local JJ mutation and test execution, while ForgeGraph provides event ingest and gate decisions for promotion. Integration Gate policies are revision-centric: unit pass gates staging, and staging integration pass gates production.

**Tech Stack:** Bob backend (Express + SQLite), Gateway session runtime, JJ CLI wrapper, ForgeGraph API (tRPC), GitHub Actions for CI/CD callbacks.

---

## 1) Scope and Ownership

### Bob owns

- Local JJ workspace lifecycle (create, mutate, status, cleanup)
- Agent-safe mutation boundaries (one run, one workspace)
- Local test execution and artifact capture
- Emission of immutable run/revision/test/artifact events

### ForgeGraph owns

- Task/Run/Revision/Build/Deployment graph of record
- CI/CD gate decisions and promotion policy
- Remote audit trail and idempotent event ingest
- Rollback decisioning and deployment state transitions

### Hard rules

- Agents do not call `jj` directly; only WorkspaceManager endpoints
- Integration pointer movement and exports are gate-only operations
- Git is export transport only, not primary source of truth

---

## 2) Canonical Identifiers and Metadata

### Required IDs

- `task_id`: ForgeGraph task identifier (stable)
- `run_id`: execution attempt identifier (stable per attempt)
- `workspace_id`: Bob-local workspace identifier
- `rev_id`: JJ commit/revision identity used for execution
- `base_rev`: JJ revision used to start run

### Required per-revision metadata block

Every revision description written by Bob must include:

```text
KB-TASK: <task_id>
BOB-RUN: <run_id>
AGENT: <agent_id>
BASE: <base_rev>
```

### Idempotency conventions

- All mutating endpoints require `X-Idempotency-Key`
- Bob dedupe key: `workspace_id + operation + idempotency_key`
- ForgeGraph dedupe key: `event_source + event_id` (or equivalent unique key)

---

## 3) Bob WorkspaceManager API (HTTP)

Base path: `/api/workspace-manager`

### 3.1 Create run workspace

`POST /repos/:repoId/runs`

Request:

```json
{
  "task_id": "KB-123",
  "run_id": "run_01J...",
  "agent_id": "agent_codex",
  "base_ref": "base"
}
```

Response:

```json
{
  "workspace_id": "ws_01J...",
  "workspace_path": "/repos/projectX/workspaces/run-run_01J...",
  "rev_id": "qzmxk...",
  "base_rev": "pnrta...",
  "status": "MATERIALIZED"
}
```

Behavior:

- Refreshes base (`fetch`, then update `base` bookmark)
- Creates changeset from base with required metadata
- Materializes workspace at new revision

### 3.2 Get workspace/run status

`GET /runs/:runId`

Response:

```json
{
  "run_id": "run_01J...",
  "task_id": "KB-123",
  "workspace_id": "ws_01J...",
  "rev_id": "qzmxk...",
  "base_rev": "pnrta...",
  "integration_rev": "hjkls...",
  "status": "CODING",
  "test_status": "not_started"
}
```

### 3.3 Apply patch

`POST /runs/:runId/apply-patch`

Request:

```json
{
  "patch": "...unified diff..."
}
```

Response:

```json
{
  "rev_id": "newrev...",
  "status": "CODING"
}
```

### 3.4 Describe changeset

`POST /runs/:runId/describe`

Request:

```json
{
  "message": "feat: add workspace lock checks"
}
```

Response:

```json
{
  "rev_id": "qzmxk...",
  "description_updated": true
}
```

### 3.5 Stack ops (optional MVP+)

`POST /runs/:runId/stack`

Request:

```json
{
  "operation": "split",
  "args": {
    "path_globs": ["backend/src/services/**"]
  }
}
```

### 3.6 Cleanup

`DELETE /runs/:runId`

Response:

```json
{
  "run_id": "run_01J...",
  "workspace_id": "ws_01J...",
  "status": "ABANDONED"
}
```

---

## 4) ForgeGraph Integration Gate API

Base path (proposed): `/api/forgegraph`

### 4.1 Event ingest (idempotent)

`POST /events/ingest`

Request:

```json
{
  "event_id": "evt_01J...",
  "event_source": "bob.workspace-manager",
  "event_type": "tests.unit.finished",
  "occurred_at": "2026-02-12T18:00:00Z",
  "task_id": "KB-123",
  "run_id": "run_01J...",
  "workspace_id": "ws_01J...",
  "rev_id": "qzmxk...",
  "sequence_key": "run:run_01J...",
  "sequence_no": 7,
  "payload": {
    "status": "passed",
    "duration_ms": 48321,
    "artifacts": [
      {
        "kind": "junit",
        "uri": "s3://.../junit.xml",
        "digest": "sha256:..."
      }
    ]
  }
}
```

Response:

```json
{
  "accepted": true,
  "deduped": false,
  "stored_event_id": "evt_01J..."
}
```

### 4.2 Gate decision query

`GET /gate/decision?run_id=<...>&rev_id=<...>`

Response:

```json
{
  "decision": "promote_staging",
  "reason": "unit_passed",
  "required_actions": []
}
```

Decision enum:

- `hold`
- `promote_staging`
- `run_staging_integration`
- `promote_production`
- `rollback_staging`
- `rollback_production`

### 4.3 Promotion acknowledge

`POST /gate/ack`

Request:

```json
{
  "run_id": "run_01J...",
  "rev_id": "qzmxk...",
  "action": "promote_staging",
  "status": "completed",
  "deployment_id": "dep_01J..."
}
```

---

## 5) Shared State Machines

### 5.1 Run state (Bob-facing)

- `CREATED`
- `MATERIALIZED`
- `CODING`
- `TESTING`
- `FAILED`
- `PASSED`
- `PENDING_APPROVAL`
- `INTEGRATED`
- `ABANDONED`

Transition constraints:

- `MATERIALIZED -> CODING` only after workspace path is valid
- `TESTING -> PASSED|FAILED` only after test command exits
- `PASSED -> PENDING_APPROVAL` only if event ingest succeeds

### 5.2 Promotion state (Gate-facing)

- `UNIT_PENDING`
- `UNIT_PASSED|UNIT_FAILED`
- `STAGING_DEPLOY_PENDING|STAGING_DEPLOYED|STAGING_DEPLOY_FAILED`
- `INTEG_PENDING|INTEG_PASSED|INTEG_FAILED`
- `PROD_DEPLOY_PENDING|PROD_DEPLOYED|PROD_DEPLOY_FAILED`
- `ROLLBACK_PENDING|ROLLED_BACK`

Policy:

- Unit pass is mandatory before staging deploy
- Integration pass on staging is mandatory before production deploy

---

## 6) CI/Gate Contract (from ForgeGraph phase 1 intent)

### Mandatory callback events

- `tests.unit.finished`
- `deploy.staging.finished`
- `tests.integration.finished`
- `deploy.production.finished`

### Required payload fields

- `run_id`, `rev_id`, `status`, `duration_ms`, `artifacts[]`, `logs_uri`
- `environment` for deploy/test-on-env events (`staging` or `production`)

### Rollback trigger rules

- If `tests.integration.finished.status == failed` on staging, emit `rollback_staging`
- If post-promote health checks fail on production, emit `rollback_production`
- Rollback target must reference last known healthy `rev_id`

---

## 7) Error Model

Standard error response for both systems:

```json
{
  "error": {
    "code": "IDEMPOTENCY_CONFLICT",
    "message": "X-Idempotency-Key reused with different payload",
    "retryable": false
  }
}
```

Common codes:

- `VALIDATION_ERROR`
- `NOT_FOUND`
- `IDEMPOTENCY_CONFLICT`
- `SEQUENCE_CONFLICT`
- `POLICY_DENIED`
- `LOCK_UNAVAILABLE`
- `INTEGRATION_GATE_TIMEOUT`

---

## 8) Bob DB Additions (minimum)

### `workspace_runs`

- `run_id` (pk)
- `task_id`
- `workspace_id`
- `repo_id`
- `agent_id`
- `base_rev`
- `head_rev`
- `status`
- `created_at`
- `updated_at`

### `workspace_operations`

- `id` (pk)
- `run_id`
- `operation`
- `idempotency_key`
- `request_hash`
- `status`
- `result_json`
- `error`
- unique index on (`run_id`, `operation`, `idempotency_key`)

### `workspace_events_outbox`

- `event_id` (pk)
- `event_type`
- `run_id`
- `rev_id`
- `payload_json`
- `published_at`
- `delivery_status`

---

## 9) Compatibility and Rollout

### Phase A (shadow)

- Keep existing git/worktree paths for legacy flows
- Add JJ WorkspaceManager endpoints in parallel
- Mirror events to ForgeGraph without enforcing gate

### Phase B (enforced for opted repos)

- Enable gate decisions for selected repos/tasks
- Reject direct integration actions outside gate

### Phase C (default JJ-native)

- WorkspaceManager + Gate paths are default
- Git paths remain export-only and fallback-only

---

## 10) Test Matrix (must pass)

### WorkspaceManager

- Create run workspace is idempotent under retries
- Patch apply updates `head_rev` deterministically
- Direct integration mutation attempts are denied

### Event ingest

- Duplicate events dedupe cleanly
- Out-of-order sequence rejected or quarantined
- Event replay yields same gate decisions

### Integration Gate

- Unit fail blocks staging
- Unit pass allows staging
- Staging integration fail blocks prod and triggers rollback action
- Staging integration pass allows prod

---

## 11) Implementation Checklist

1. Add Bob schema migration for `workspace_runs`, `workspace_operations`, `workspace_events_outbox`
2. Add WorkspaceManager service in `backend/src/services/`
3. Add routes in `backend/src/routes/workspace-manager.ts` and mount in server
4. Add outbox publisher to ForgeGraph ingest endpoint
5. Add ForgeGraph ingest/gate router implementations and DB constraints
6. Wire CI callback events to ForgeGraph by `run_id` and `rev_id`
7. Enable gate policy checks in staging workflow
8. Enable production promotion only on integration pass

---

## 12) File Targets

### Bob

- Create: `backend/src/services/workspace-manager.ts`
- Create: `backend/src/routes/workspace-manager.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/src/database/database.ts`
- Create migration: `backend/src/database/migrations/0XX_workspace_manager.ts`

### linear-clone

- Create/modify forge schema in `packages/db/src/schema.ts`
- Create/modify ForgeGraph routers under `packages/api/src/routers/`
- Register router in `packages/api/src/routers/index.ts`
- Update CI workflows in `.github/workflows/`
