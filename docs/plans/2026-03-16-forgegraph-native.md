# ForgeGraph Native — Local DB + Pipeline Orchestration

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement the remaining tasks in controlled batches.

**Goal:** Replace the incorrect ForgeGraph HTTP client with native DB tables and direct queries. Build the full pipeline orchestration: agent lifecycle events → builds → deployments (dev → staging → prod). ForgeGraph, kanbanger, and Bob are all the same tRPC API with the same DB.

**Architecture:** New ForgeGraph tables (`forge_revisions`, `forge_builds`, `forge_deployments`, `forge_run_events`) in Bob's DB. The `forgegraph` tRPC router becomes direct DB operations (no HTTP). A `PipelineOrchestrator` state machine advances dispatch items through build/deploy stages. Existing `repositories` table gets a `forgegraphRepoId` linking to a forge revision namespace.

**Tech Stack:** Drizzle ORM, tRPC, existing dispatch polling, existing UI components.

---

## Batch 1: ForgeGraph Schema + Remove HTTP Client

### Task 1.1: Create ForgeGraph tables

**Files:**
- Modify: `packages/db/src/schema.ts`

Add after the dispatch tables section:

```typescript
// =============================================================================
// ForgeGraph Tables (revisions, builds, deployments, run events)
// =============================================================================

export const forgeRevisionStatusEnum = ["open", "merged", "abandoned"] as const;

export const forgeRevisions = pgTable(
  "forge_revisions",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    revId: t.text().notNull(), // commit SHA or JJ changeset ID
    taskId: t.uuid().references(() => workItems.id, { onDelete: "set null" }),
    taskRunId: t.uuid().references(() => taskRuns.id, { onDelete: "set null" }),
    branch: t.text(),
    status: t.varchar({ length: 20 }).notNull().default("open"),
    gates: t.json().$type<Array<{ name: string; status: string; startedAt?: string; finishedAt?: string }>>().default([]),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "forge_revisions_repo_idx", columns: [table.repoId] },
    { name: "forge_revisions_task_idx", columns: [table.taskId] },
    { name: "forge_revisions_repo_rev_idx", columns: [table.repoId, table.revId], unique: true },
  ],
);

export const forgeBuildStatusEnum = ["queued", "running", "passed", "failed", "canceled", "superseded"] as const;

export const forgeBuilds = pgTable(
  "forge_builds",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    revisionId: t.uuid().notNull().references(() => forgeRevisions.id, { onDelete: "cascade" }),
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    status: t.varchar({ length: 20 }).notNull().default("queued"),
    idempotencyKey: t.text().notNull(),
    ciProvider: t.text(),
    externalJobId: t.text(),
    imageDigest: t.text(),
    artifactManifestRef: t.text(),
    durationMs: t.integer(),
    startedAt: t.timestamp({ mode: "date", withTimezone: true }),
    finishedAt: t.timestamp({ mode: "date", withTimezone: true }),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "forge_builds_revision_idx", columns: [table.revisionId] },
    { name: "forge_builds_idempotency_idx", columns: [table.idempotencyKey], unique: true },
  ],
);

export const forgeDeploymentEnvEnum = ["dev", "staging", "prod", "preview"] as const;
export const forgeDeploymentStatusEnum = ["pending_approval", "deploying", "healthy", "unhealthy", "rolled_back", "failed"] as const;

export const forgeDeployments = pgTable(
  "forge_deployments",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    revisionId: t.uuid().notNull().references(() => forgeRevisions.id, { onDelete: "cascade" }),
    buildId: t.uuid().notNull().references(() => forgeBuilds.id, { onDelete: "cascade" }),
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    environment: t.varchar({ length: 20 }).notNull(),
    status: t.varchar({ length: 30 }).notNull().default("pending_approval"),
    rollbackTargetId: t.uuid().references(() => forgeDeployments.id, { onDelete: "set null" }),
    deployedAt: t.timestamp({ mode: "date", withTimezone: true }),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "forge_deployments_revision_idx", columns: [table.revisionId] },
    { name: "forge_deployments_env_idx", columns: [table.repoId, table.environment] },
  ],
);

export const forgeRunEventTypeEnum = ["created", "patch_applied", "tests_started", "tests_finished", "approved", "integrated", "failed"] as const;

export const forgeRunEvents = pgTable(
  "forge_run_events",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    runId: t.text().notNull(), // Bob taskRunId
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    revisionId: t.uuid().notNull().references(() => forgeRevisions.id, { onDelete: "cascade" }),
    taskId: t.uuid().references(() => workItems.id, { onDelete: "set null" }),
    agentId: t.uuid(), // chatConversation session ID
    eventType: t.varchar({ length: 30 }).notNull(),
    testStatus: t.text(),
    artifactRefs: t.json().$type<Array<{ type: string; url?: string; description?: string }>>().default([]),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    { name: "forge_run_events_run_idx", columns: [table.runId] },
    { name: "forge_run_events_revision_idx", columns: [table.revisionId] },
  ],
);
```

Add Drizzle relations for all four tables.

Add `pipelineState: t.varchar({ length: 30 })` to `dispatchItems` table.

### Task 1.2: Rewrite forgegraph tRPC router as direct DB operations

**Files:**
- Rewrite: `packages/api/src/router/forgegraph.ts`
- Delete: `packages/api/src/services/forgegraph/forgegraphClient.ts`

The router becomes direct DB queries:

```typescript
// All procedures use protectedProcedure with direct ctx.db operations
listRevisions → ctx.db.query.forgeRevisions.findMany({ where: ... })
getRevision → ctx.db.query.forgeRevisions.findFirst({ where: ... })
triggerBuild → ctx.db.insert(forgeBuilds).values({ ... }).returning()
updateBuildStatus → ctx.db.update(forgeBuilds).set({ status }).where(...)
createDeployment → ctx.db.insert(forgeDeployments).values({ ... }).returning()
updateDeploymentStatus → ctx.db.update(forgeDeployments).set({ status }).where(...)
ingestRunEvent → ctx.db.insert(forgeRunEvents).values({ ... }) + update revision gates
listDeployments → ctx.db.query.forgeDeployments.findMany({ where: ... })
```

The `ingestRunEvent` procedure is idempotent — on duplicate `(runId, eventType)` it's a no-op.

### Task 1.3: Update UI components to use new data shape

**Files:**
- Modify: `apps/web/src/components/forgegraph/revision-status-bar.tsx`
- Modify: `apps/web/src/components/forgegraph/build-history.tsx`
- Modify: `apps/web/src/components/forgegraph/deployment-status.tsx`
- Modify: `apps/web/src/components/work-items/work-item-detail-interactive.tsx` (ForgeGraphSection)

The UI components already expect the right shapes (gates, builds, deployments). Just update the tRPC query calls to match the new router signatures (which now take `repoId` instead of `taskId` for some queries, and return DB records instead of `{ available, data }` wrappers).

### Verification (Batch 1)
```bash
pnpm --filter @bob/db typecheck
pnpm --filter @bob/api typecheck
pnpm --filter @bob/web typecheck
```

---

## Batch 2: Event Reporter + Task Lifecycle Wiring

### Task 2.1: Create ForgeGraphEventReporter as direct DB service

**Files:**
- Create: `packages/api/src/services/forgegraph/eventReporter.ts`
- Delete: `packages/api/src/services/forgegraph/forgegraphClient.ts` (if not already deleted)

A service that inserts `forgeRunEvents` and creates/updates `forgeRevisions`:

```typescript
export class ForgeGraphEventReporter {
  constructor(private db: Database) {}

  async reportCreated(taskRun: { id, repositoryId, branch, workItemId }): Promise<void>
    // 1. Upsert forgeRevision (repoId + revId=branch HEAD or taskRunId)
    // 2. Insert forgeRunEvent with eventType="created"

  async reportPatchApplied(taskRunId, commitSha): Promise<void>
    // 1. Update forgeRevision.revId to commitSha
    // 2. Insert forgeRunEvent "patch_applied"

  async reportTestsStarted(taskRunId): Promise<void>
  async reportTestsFinished(taskRunId, passed): Promise<void>
  async reportApproved(taskRunId): Promise<void>
  async reportFailed(taskRunId): Promise<void>
  async reportIntegrated(taskRunId): Promise<void>
}
```

Each method: look up taskRun → find/create revision → insert event → update revision gates if applicable. All operations are idempotent.

### Task 2.2: Wire into task executor + dispatch

**Files:**
- Modify: `apps/execution/src/runtime/taskExecutor.ts` — call `reportCreated` after executeTask
- Modify: `packages/api/src/router/dispatch.ts` — call `reportApproved`/`reportFailed` in checkProgress

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

State machine per dispatch item:
```
agent_complete → building → gates_passed → deploying_dev → dev_healthy →
deploying_staging → staging_healthy → awaiting_prod_approval →
deploying_prod → prod_healthy → complete
```

Each transition is a direct DB operation:
- `agent_complete → building`: insert into forgeBuilds, update dispatchItems.pipelineState
- `building → gates_passed`: check forgeRevision.gates, all passed?
- `gates_passed → deploying_dev`: insert into forgeDeployments(env="dev")
- etc.

### Task 3.2: Wire into checkProgress + add approveProd endpoint

**Files:**
- Modify: `packages/api/src/router/dispatch.ts`
- Modify: `packages/api/src/router/forgegraph.ts` (add `approveProdDeploy`)

### Verification (Batch 3)
```bash
pnpm --filter @bob/api typecheck
```

---

## Batch 4: UI Pipeline Visibility + Delight

### Task 4.1: Pipeline column on dispatch plan
### Task 4.2: Pipeline state on work item detail
### Task 4.3: Time-in-stage counters
### Task 4.4: Smart retry button

### Verification (Batch 4)
```bash
pnpm --filter @bob/web typecheck
pnpm --filter @bob/web test
```
