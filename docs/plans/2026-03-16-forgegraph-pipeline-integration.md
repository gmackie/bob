# ForgeGraph Pipeline Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement the remaining tasks in controlled batches.

**Goal:** Close the loop between Bob agent sessions and ForgeGraph: report lifecycle events, trigger builds, orchestrate deployments through dev → staging → prod, and surface pipeline state in the UI.

**Architecture:** A `ForgeGraphEventReporter` service reports agent lifecycle events automatically. A `PipelineOrchestrator` state machine drives build → deploy → done per dispatch item. Both hook into the existing `dispatch.checkProgress` polling loop. ForgeGraph repos are linked to Bob repos via a stored `forgegraphRepoId` mapping.

**Tech Stack:** ForgeGraph HTTP API (tasks.gmac.io), tRPC, Drizzle, existing dispatch infrastructure.

---

## Batch 1: Schema + ForgeGraph Client Extensions

### Task 1.1: Add ForgeGraph columns to existing tables

**Files:**
- Modify: `packages/db/src/schema.ts`

Add to `repositories` table:
```typescript
forgegraphRepoId: t.text(),
```

Add to `taskRuns` table (after `branch`):
```typescript
forgegraphRevisionId: t.text(),
forgegraphBuildId: t.text(),
lastKnownBuildStatus: t.varchar({ length: 20 }),
lastKnownGates: t.json().$type<Record<string, string>>(),
```

Add to `dispatchItems` table (after `sortOrder`):
```typescript
pipelineState: t.varchar({ length: 30 }),
// null | agent_complete | building | gates_passed | deploying_dev | dev_healthy |
// deploying_staging | staging_healthy | awaiting_prod_approval |
// deploying_prod | prod_healthy | complete | build_failed | deploy_failed
```

### Task 1.2: Extend ForgeGraph HTTP client

**Files:**
- Modify: `packages/api/src/services/forgegraph/forgegraphClient.ts`

Add missing API methods:

```typescript
export function ingestRunEvent(params: {
  runId: string;
  repoId: string;
  revId: string;
  eventType: "created" | "patch_applied" | "tests_started" | "tests_finished" | "approved" | "integrated" | "failed";
  taskId?: string;
  agentId?: string;
  testStatus?: string;
  artifactRefs?: Array<{ type: string; url?: string; description?: string }>;
}) {
  return forgeGraphRequest<{ ok: boolean }>("POST", "/run-events", params);
}

export function createDeployment(params: {
  repoId: string;
  revId: string;
  buildId: string;
  environment: "dev" | "staging" | "prod" | "preview";
}) {
  return forgeGraphRequest<FGDeployment>("POST", "/deployments", params);
}

export function updateBuildStatus(params: {
  buildId: string;
  status: "queued" | "running" | "passed" | "failed" | "canceled" | "superseded";
  imageDigest?: string;
}) {
  return forgeGraphRequest<{ ok: boolean }>("POST", `/builds/${params.buildId}/status`, {
    status: params.status,
    imageDigest: params.imageDigest,
  });
}

export function updateDeploymentStatus(params: {
  deploymentId: string;
  status: "pending_approval" | "deploying" | "healthy" | "unhealthy" | "rolled_back" | "failed";
}) {
  return forgeGraphRequest<{ ok: boolean }>(
    "POST",
    `/deployments/${params.deploymentId}/status`,
    { status: params.status },
  );
}
```

### Task 1.3: Add new tRPC procedures to forgegraph router

**Files:**
- Modify: `packages/api/src/router/forgegraph.ts`

Add procedures:
- `ingestRunEvent` — wraps the new client method
- `createDeployment` — wraps client
- `updateDeploymentStatus` — wraps client
- `approveProdDeploy` — sets dispatch item pipeline state to `deploying_prod` (user action)

### Verification (Batch 1)
```bash
pnpm --filter @bob/db typecheck
pnpm --filter @bob/api typecheck
```

---

## Batch 2: Event Reporter Service

### Task 2.1: Create ForgeGraphEventReporter

**Files:**
- Create: `packages/api/src/services/forgegraph/eventReporter.ts`

A stateless service with methods that map Bob lifecycle events to ForgeGraph run events:

```typescript
export class ForgeGraphEventReporter {
  /** Called when executeTask creates a session + taskRun */
  async reportCreated(taskRun: {
    id: string;
    repositoryId: string | null;
    branch: string | null;
    planningItemId: string;
  }): Promise<void>

  /** Called when agent commits code (detected from session events) */
  async reportPatchApplied(taskRunId: string, commitSha: string): Promise<void>

  /** Called when agent starts running tests */
  async reportTestsStarted(taskRunId: string): Promise<void>

  /** Called when tests finish */
  async reportTestsFinished(taskRunId: string, passed: boolean): Promise<void>

  /** Called when task completes and is ready for review */
  async reportApproved(taskRunId: string): Promise<void>

  /** Called when PR is merged / code integrated */
  async reportIntegrated(taskRunId: string): Promise<void>

  /** Called when task fails */
  async reportFailed(taskRunId: string): Promise<void>
}
```

Each method:
1. Looks up the taskRun to get `forgegraphRevisionId` and repository's `forgegraphRepoId`
2. If either is missing, returns silently (graceful degradation)
3. Calls `ingestRunEvent` with the appropriate event type
4. Logs success/failure

For `reportCreated`: also fetches the branch HEAD SHA via the planning API or stores it as `forgegraphRevisionId` on the taskRun.

### Task 2.2: Wire into task lifecycle

**Files:**
- Modify: `apps/execution/src/runtime/taskExecutor.ts`

After `executeTask` creates the taskRun and starts the session, call:
```typescript
void eventReporter.reportCreated(taskRun);
```

- Modify: `packages/api/src/router/dispatch.ts`

In `checkProgress`, when marking an item completed:
```typescript
void eventReporter.reportApproved(item.taskRunId);
```

When marking an item failed:
```typescript
void eventReporter.reportFailed(item.taskRunId);
```

### Verification (Batch 2)
```bash
pnpm --filter @bob/api typecheck
pnpm --filter @bob/execution typecheck
```

---

## Batch 3: Pipeline Orchestrator

### Task 3.1: Create PipelineOrchestrator

**Files:**
- Create: `packages/api/src/services/forgegraph/pipelineOrchestrator.ts`

State machine that advances dispatch items through the build/deploy pipeline:

```typescript
export async function advancePipeline(
  db: Database,
  item: DispatchItem,
  batch: DispatchBatch,
): Promise<void>
```

State transitions:
- `null` → `agent_complete` (set when checkProgress marks item completed)
- `agent_complete` → `building` (trigger build, store buildId)
- `building` → `gates_passed` or `build_failed` (poll getRevision for gate status)
- `gates_passed` → `deploying_dev` (create dev deployment)
- `deploying_dev` → `dev_healthy` or `deploy_failed` (poll deployment status)
- `dev_healthy` → `deploying_staging` (create staging deployment)
- `deploying_staging` → `staging_healthy` or `deploy_failed` (poll)
- `staging_healthy` → `awaiting_prod_approval` (notify user, wait)
- `awaiting_prod_approval` → `deploying_prod` (user clicks approve)
- `deploying_prod` → `prod_healthy` or `deploy_failed` (poll)
- `prod_healthy` → `complete` (update planning task to "done", report integrated)

Each state transition:
1. Calls the appropriate ForgeGraph API
2. Updates `dispatchItems.pipelineState`
3. Updates `taskRuns` cached fields (lastKnownBuildStatus, lastKnownGates)
4. On failure: creates notification

### Task 3.2: Wire into dispatch checkProgress

**Files:**
- Modify: `packages/api/src/router/dispatch.ts`

In `checkProgress`, after processing task completion/failure, iterate dispatch items that have a `pipelineState` and call `advancePipeline` for each. This piggybacks on the existing 10s polling.

### Verification (Batch 3)
```bash
pnpm --filter @bob/api typecheck
```

---

## Batch 4: UI — Pipeline Visibility

### Task 4.1: Pipeline state on dispatch plan

**Files:**
- Modify: `apps/web/src/components/planning/dispatch-plan.tsx`

Add a "Pipeline" column to the dispatch table showing the current pipeline state as a badge. States map to colors:
- building = blue
- gates_passed = emerald
- deploying_* = blue (pulsing)
- *_healthy = emerald
- awaiting_prod_approval = amber
- complete = emerald
- *_failed = rose

Add "Approve Prod" button for items in `awaiting_prod_approval` state — calls `forgegraph.approveProdDeploy`.

### Task 4.2: Pipeline state on work item detail

**Files:**
- Modify: `apps/web/src/components/work-items/work-item-detail-interactive.tsx`

The existing `ForgeGraphSection` shows revision gates. Extend it to also show:
- Current pipeline state (if dispatch item exists)
- Build status + gate progression
- Deployment status per environment (dev/staging/prod)

Query the dispatch items for this task's planning ID to get pipeline state.

### Verification (Batch 4)
```bash
pnpm --filter @bob/web typecheck
pnpm --filter @bob/web test
```
