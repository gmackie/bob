# Phase 7B-4C — Bob Domain Contracts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Define 128 Effect-RPC contracts across 3 Bob-specific domain groups (WorkItems, Planning, External) in `packages/bob/src/contracts/`.

**Architecture:** Faithful Zod→Effect Schema translation of Bob's tRPC procedures. Each group gets an `RpcGroup.make()` with dotted procedure names, schemas in sibling files, stubs alongside. All contracts go in `@gmacko/bob/contracts` (not core — these are Bob-specific domain logic).

**Tech Stack:** Effect 4.0.0-beta.43, `Rpc.make()` + `RpcGroup.make()` from `effect/unstable/rpc`, Effect Schema.

---

## Reference: Established Patterns (from 7B-4B)

### Effect-RPC contract pattern

```ts
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { BobNotFoundError, BobForbiddenError } from "../errors.js";

export const SomeRpc = Rpc.make("group.verb", {
  payload: Schema.Struct({ id: Schema.String }),
  success: SomeOutputSchema,
  error: Schema.Union(BobNotFoundError, BobForbiddenError),
});

export const GroupRpc = RpcGroup.make(SomeRpc, OtherRpc, ...);
```

### Known Effect Schema gotchas

- **No `Schema.UUID`** — use `Schema.String` for UUID fields.
- **`Schema.Literals([...])` not `Schema.Literal(a, b, c)`** — variadic `Literal` only matches the first member. Use `Schema.Literals(["a", "b", "c"])` for union of literals.
- **`Schema.optional`** not `Schema.optionalWith` — the latter doesn't exist.
- **`Schema.Record(key, value)`** — positional args, not `{ key, value }`.
- **`Schema.NullOr(T)`** for `T | null`.
- **Stubs provide runtime values** — use `Schema.String` (not `DateTimeUtcFromString`) for date fields in stubs since they provide string values directly.

### File structure

```
packages/bob/src/contracts/
  groups/work-items.ts      — WorkItemsRpc group
  groups/planning.ts        — PlanningRpc group
  groups/external.ts        — ExternalRpc group
  schemas/work-item-core.ts — WorkItem, Comment, Artifact, etc.
  schemas/work-item-sub.ts  — Requirement, Link, TaskRun, etc.
  schemas/planning-core.ts  — Planning task, label, cycle schemas
  schemas/planning-session.ts — PlanSession, draft schemas
  schemas/planning-ops.ts   — Plan, Dispatch, Skill, Snapshot, Checkpoint
  schemas/external.ts       — ForgeGraph, Webhook, PublicApi schemas
  stubs/work-items.ts       — Stub responses
  stubs/planning.ts         — Stub responses
  stubs/external.ts         — Stub responses
  __tests__/work-items.test.ts
  __tests__/planning.test.ts
  __tests__/external.test.ts
  __tests__/all-bob-groups.test.ts
  index.ts                  — barrel (updated)
  errors.ts                 — existing (BobNotFoundError, etc.)
  bridge.ts                 — existing
```

### Zod→Effect Schema translation rules

| Zod | Effect Schema |
|-----|--------------|
| `z.string()` | `Schema.String` |
| `z.string().uuid()` | `Schema.String` |
| `z.number()` | `Schema.Number` |
| `z.number().int()` | `Schema.Number` |
| `z.boolean()` | `Schema.Boolean` |
| `z.string().datetime()` | `Schema.String` |
| `z.enum(["a","b"])` | `Schema.Literals(["a","b"])` |
| `z.object({...})` | `Schema.Struct({...})` |
| `z.array(T)` | `Schema.Array(T)` |
| `z.record(k, v)` | `Schema.Record(k, v)` |
| `z.string().optional()` | `Schema.optional(Schema.String)` |
| `z.string().nullable()` | `Schema.NullOr(Schema.String)` |
| `z.string().nullable().optional()` | `Schema.optional(Schema.NullOr(Schema.String))` |
| `z.string().default("x")` | `Schema.optional(Schema.String)` |
| `z.unknown()` | `Schema.Unknown` |
| `z.union([A, B])` | `Schema.Union(A, B)` |
| No input / `z.void()` | `Schema.Void` |

---

## Procedure Inventory

### WorkItems Group (31 RPCs)

**Source routers:** `workItems.ts` (937 lines), `requirement.ts` (172 lines), `link.ts` (273 lines)

| Sub-namespace | Procedures | Source |
|--------------|-----------|--------|
| `workItem.*` | list, get, update, promoteToTask | workItems.ts |
| `workItem.comment.*` | list, create | workItems.ts |
| `workItem.artifact.*` | create, listCurrent, listChildGroups | workItems.ts |
| `workItem.activity.*` | list, listRecent | workItems.ts |
| `workItem.notification.*` | list, create, markAsRead, registerPushToken | workItems.ts |
| `workItem.taskRun.*` | listByWorkItem, execute, listLifecycleEvents | workItems.ts |
| `workItem.requirement.*` | list, create, update, delete, linkToTask | requirement.ts |
| `workItem.link.*` | list, byId, byWorktree, create, update, delete, linkToPlanningTask, linkToGitHubPR | link.ts |

### Planning Group (67 RPCs)

**Source routers:** `planning.ts` (1,211 lines), `planSession.ts` (830 lines), `plan.ts` (288 lines), `dispatch.ts` (896 lines), `skill.ts` (392 lines), `snapshot.ts` (96 lines), `checkpoint.ts` (104 lines)

| Sub-namespace | Procedures | Source |
|--------------|-----------|--------|
| `planning.*` | listWorkspaces, listProjects, getProject, listTasks, getTask, getTaskByIdentifier, createTask, updateTask, addComment, listComments, searchTasks, listLabels, listCycles, getCurrentUser, agentClaimTask, agentReportProgress, agentCompleteTask, agentFailTask, agentGetAvailableTasks, agentStartSession, agentEndSession | planning.ts |
| `planning.session.*` | create, start, get, list, listByWorkItem, getActiveForWorkItem, saveArtifact, getPriorContext, createDraft, updateDraft, removeDraft, setDependency, removeDependency, commitPlan, commitPlanLocal | planSession.ts |
| `planning.task.*` | list, byId, byWorktree, create, update, delete, syncFromFile, addTask, updateTask, deleteTask, reorderTasks | plan.ts |
| `planning.dispatch.*` | createBatch, getBatch, updateItemAgent, updateConcurrency, dispatch, checkProgress, listBatches, resetPipelineState | dispatch.ts |
| `planning.skill.*` | list, seed, getExecution, listExecutions, recordExecution, updateExecution | skill.ts |
| `planning.snapshot.*` | create, list, get | snapshot.ts |
| `planning.checkpoint.*` | create, list, branchFrom | checkpoint.ts |

### External Group (31 RPCs)

**Source routers:** `forgegraph.ts` (477 lines), `webhook.ts` (260 lines), `publicApi.ts` (540 lines)

| Sub-namespace | Procedures | Source |
|--------------|-----------|--------|
| `external.forgegraph.*` | listRevisions, getRevision, createRevision, triggerBuild, updateBuildStatus, createDeployment, updateDeploymentStatus, ingestRunEvent, listDeployments, listBuilds, approveProdDeploy, listApps, listUnlinkedApps, importApp | forgegraph.ts |
| `external.webhook.*` | list, byId, create, update, delete, deliveries, redeliver, testWebhook | webhook.ts |
| `external.publicApi.*` | registerWorkspace, createRun, updateRun, createArtifact, getRun, listRuns, listRunsByWorkItem, heartbeat, generateApiKey | publicApi.ts |

**Grand total: 129 RPCs** (31 + 67 + 31)

---

## Tasks

### Task 1: WorkItem core + comment RPCs (6 RPCs)

**Files:**
- Create: `packages/bob/src/contracts/schemas/work-item-core.ts`
- Create: `packages/bob/src/contracts/groups/work-items.ts`
- Create: `packages/bob/src/contracts/stubs/work-items.ts`
- Create: `packages/bob/src/contracts/__tests__/work-items-core.test.ts`

**Reference:** `packages/bob/src/work-items/src/schema.ts` (Zod schemas), `packages/bob/src/api/src/router/workItems.ts` (procedures)

**Step 1: Create work-item-core.ts schemas**

Translate these Zod schemas from `@bob/work-items/schema`:
- `projectSummarySchema` → `ProjectSummarySchema`
- `workItemRecordSchema` → `WorkItemRecordSchema`
- `commentRecordSchema` → `CommentRecordSchema`
- `listWorkItemsInputSchema` fields
- `getWorkItemInputSchema` fields
- `updateWorkItemInputSchema` fields
- `getWorkItemOutputSchema` structure (workItem + currentArtifacts + childCount)

Also define enum constants:
- `WorkItemKindEnum = Schema.Literals(["issue", "epic", "task"])`

```ts
// packages/bob/src/contracts/schemas/work-item-core.ts
import { Schema } from "effect";

export const WorkItemKindEnum = Schema.Literals(["issue", "epic", "task"]);

export const ProjectSummarySchema = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  name: Schema.String,
});

export const WorkItemRecordSchema = Schema.Struct({
  id: Schema.String,
  identifier: Schema.optional(Schema.String),
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  kind: Schema.String,
  status: Schema.String,
  priority: Schema.optional(Schema.String),
  sequenceNumber: Schema.optional(Schema.NullOr(Schema.Number)),
  projectId: Schema.optional(Schema.NullOr(Schema.String)),
  ownerUserId: Schema.optional(Schema.NullOr(Schema.String)),
  workspaceId: Schema.optional(Schema.NullOr(Schema.String)),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  project: Schema.optional(Schema.NullOr(ProjectSummarySchema)),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});

export const CommentRecordSchema = Schema.Struct({
  id: Schema.String,
  workItemId: Schema.String,
  userId: Schema.String,
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  body: Schema.String,
  bodyHtml: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});

export const GetWorkItemResultSchema = Schema.NullOr(
  Schema.Struct({
    workItem: WorkItemRecordSchema,
    currentArtifacts: Schema.Array(Schema.Struct({
      id: Schema.String,
      workItemId: Schema.String,
      artifactType: Schema.String,
      artifactRole: Schema.String,
      isCurrent: Schema.optional(Schema.Boolean),
    })),
    childCount: Schema.Number,
  }),
);
```

**Step 2: Create groups/work-items.ts with first 6 RPCs**

```ts
// packages/bob/src/contracts/groups/work-items.ts
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { BobNotFoundError, BobForbiddenError } from "../errors.js";
import {
  WorkItemKindEnum,
  WorkItemRecordSchema,
  CommentRecordSchema,
  GetWorkItemResultSchema,
} from "../schemas/work-item-core.js";

export const WorkItemListRpc = Rpc.make("workItem.list", {
  payload: Schema.Struct({
    workspaceId: Schema.String,
    projectId: Schema.optional(Schema.String),
    parentId: Schema.optional(Schema.NullOr(Schema.String)),
    kind: Schema.optional(WorkItemKindEnum),
    status: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(WorkItemRecordSchema),
  error: BobNotFoundError,
});

export const WorkItemGetRpc = Rpc.make("workItem.get", {
  payload: Schema.Struct({ id: Schema.String }),
  success: GetWorkItemResultSchema,
  error: BobNotFoundError,
});

export const WorkItemUpdateRpc = Rpc.make("workItem.update", {
  payload: Schema.Struct({
    id: Schema.String,
    title: Schema.optional(Schema.String),
    description: Schema.optional(Schema.NullOr(Schema.String)),
    status: Schema.optional(Schema.String),
  }),
  success: Schema.NullOr(WorkItemRecordSchema),
  error: Schema.Union(BobNotFoundError, BobForbiddenError),
});

export const WorkItemPromoteToTaskRpc = Rpc.make("workItem.promoteToTask", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.NullOr(WorkItemRecordSchema),
  error: BobNotFoundError,
});

export const WorkItemCommentListRpc = Rpc.make("workItem.comment.list", {
  payload: Schema.Struct({ workItemId: Schema.String }),
  success: Schema.Array(CommentRecordSchema),
  error: BobNotFoundError,
});

export const WorkItemCommentCreateRpc = Rpc.make("workItem.comment.create", {
  payload: Schema.Struct({
    workItemId: Schema.String,
    body: Schema.String,
    bodyHtml: Schema.optional(Schema.String),
    parentId: Schema.optional(Schema.String),
  }),
  success: CommentRecordSchema,
  error: BobNotFoundError,
});

// Group will be extended in Tasks 2-4
export const WorkItemsRpc = RpcGroup.make(
  WorkItemListRpc,
  WorkItemGetRpc,
  WorkItemUpdateRpc,
  WorkItemPromoteToTaskRpc,
  WorkItemCommentListRpc,
  WorkItemCommentCreateRpc,
);
```

**Step 3: Create stubs and test**

Create `stubs/work-items.ts` with stub responses for all 6 RPCs. Create test asserting `WorkItemsRpc.requests.size` equals 6.

**Step 4: Run tests**

Run: `cd packages/bob && pnpm exec vitest run src/contracts/__tests__/work-items-core.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/bob/src/contracts/
git commit -m "feat(bob/contracts): add workItem core + comment RPCs (7B-4C Task 1)"
```

---

### Task 2: WorkItem artifact + activity + notification + taskRun RPCs (12 RPCs)

**Files:**
- Create: `packages/bob/src/contracts/schemas/work-item-sub.ts`
- Modify: `packages/bob/src/contracts/groups/work-items.ts`
- Modify: `packages/bob/src/contracts/stubs/work-items.ts`
- Create: `packages/bob/src/contracts/__tests__/work-items-sub.test.ts`

**Reference:** `packages/bob/src/work-items/src/schema.ts` (artifactRecordSchema, activityRecordSchema, notificationRecordSchema), `packages/bob/src/api/src/router/workItems.ts`

**Step 1: Create work-item-sub.ts schemas**

Translate:
- `artifactRecordSchema` → `ArtifactRecordSchema`
- `activityRecordSchema` → `ActivityRecordSchema`
- `notificationRecordSchema` → `NotificationRecordSchema`
- Enum constants: `ArtifactProducerTypeEnum`, `ArtifactTypeEnum`, `NotificationTypeEnum`
- `ChildArtifactGroupSchema` for listChildGroups output

```ts
// packages/bob/src/contracts/schemas/work-item-sub.ts
import { Schema } from "effect";

export const ArtifactProducerTypeEnum = Schema.Literals([
  "task_run", "session", "integration", "manual",
]);

export const ArtifactTypeEnum = Schema.Literals([
  "pr", "verification", "build", "test_report", "doc",
  "deliverable", "planning_doc", "code_review", "other",
]);

export const NotificationTypeEnum = Schema.Literals([
  "work_item_assigned", "work_item_commented", "work_item_needs_input",
  "work_item_review_ready", "task_completed", "batch_completed",
]);

export const ArtifactRecordSchema = Schema.Struct({
  id: Schema.String,
  workItemId: Schema.String,
  taskRunId: Schema.optional(Schema.NullOr(Schema.String)),
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
  producerType: Schema.String,
  producerId: Schema.optional(Schema.NullOr(Schema.String)),
  artifactType: Schema.String,
  artifactRole: Schema.String,
  title: Schema.optional(Schema.NullOr(Schema.String)),
  summary: Schema.optional(Schema.NullOr(Schema.String)),
  content: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
  isCurrent: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  createdAt: Schema.optional(Schema.String),
});

// ... ActivityRecordSchema, NotificationRecordSchema, etc.
```

**Step 2: Add 12 RPCs to groups/work-items.ts**

Add these procedures and extend the RpcGroup:
- `workItem.artifact.create` — input: workItemId + artifact fields, success: ArtifactRecordSchema
- `workItem.artifact.listCurrent` — input: workItemId, success: Array(ArtifactRecordSchema)
- `workItem.artifact.listChildGroups` — input: parentWorkItemId, success: Array of {workItem, artifacts}
- `workItem.activity.list` — input: workItemId + limit?, success: Array(ActivityRecordSchema)
- `workItem.activity.listRecent` — input: limit?, success: Array(ActivityRecordSchema)
- `workItem.notification.list` — input: unreadOnly? + limit?, success: {items: Array(NotificationRecordSchema)}
- `workItem.notification.create` — input: userId + type + title + etc, success: NotificationRecordSchema
- `workItem.notification.markAsRead` — input: id, success: NullOr(NotificationRecordSchema)
- `workItem.notification.registerPushToken` — input: token + platform + deviceName?, success: Schema.Struct({ok: Boolean})
- `workItem.taskRun.listByWorkItem` — input: workItemId, success: Array of task run records
- `workItem.taskRun.execute` — input: workItemId + agentType?, success: task run record
- `workItem.taskRun.listLifecycleEvents` — input: workItemId + limit?, success: Array of lifecycle events

**Step 3: Update stubs and test**

Update stubs, create test asserting `WorkItemsRpc.requests.size` equals 18.

**Step 4: Run tests, commit**

```bash
git commit -m "feat(bob/contracts): add workItem artifact/activity/notification/taskRun RPCs (7B-4C Task 2)"
```

---

### Task 3: Requirement + Link RPCs (13 RPCs)

**Files:**
- Create: `packages/bob/src/contracts/schemas/work-item-requirement.ts`
- Create: `packages/bob/src/contracts/schemas/work-item-link.ts`
- Modify: `packages/bob/src/contracts/groups/work-items.ts`
- Modify: `packages/bob/src/contracts/stubs/work-items.ts`
- Create: `packages/bob/src/contracts/__tests__/work-items-req-link.test.ts`

**Reference:** `packages/bob/src/api/src/router/requirement.ts`, `packages/bob/src/api/src/router/link.ts`

**Step 1: Create requirement schema + RPCs**

Requirement enums and schemas:
- `RequirementCategoryEnum = Schema.Literals(["data", "api", "ui", "infra", "test", "other"])`
- `RequirementStatusEnum = Schema.Literals(["pending", "in_progress", "done"])`
- `RequirementRecordSchema`

5 RPCs:
- `workItem.requirement.list` — input: workItemId
- `workItem.requirement.create` — input: workItemId + category + description + sortOrder?
- `workItem.requirement.update` — input: id + description? + status? + category? + sortOrder?
- `workItem.requirement.delete` — input: id
- `workItem.requirement.linkToTask` — input: id + taskId

**Step 2: Create link schema + RPCs**

Link schemas:
- `WorktreeLinkRecordSchema`
- `LinkTypeEnum` (from link.ts — discover the enum values)

8 RPCs:
- `workItem.link.list` — input: worktreeId? + linkType?
- `workItem.link.byId` — input: id
- `workItem.link.byWorktree` — input: worktreeId
- `workItem.link.create` — input: CreateWorktreeLinkSchema fields
- `workItem.link.update` — input: id + externalId? + url? + title? + metadata?
- `workItem.link.delete` — input: id
- `workItem.link.linkToPlanningTask` — input: worktreeId + taskId + taskUrl? + taskTitle?
- `workItem.link.linkToGitHubPR` — input: worktreeId + prNumber + prUrl + prTitle + repoOwner + repoName

**Step 3: Extend WorkItemsRpc, update stubs, test**

Assert `WorkItemsRpc.requests.size` equals 31.

**Step 4: Commit**

```bash
git commit -m "feat(bob/contracts): add requirement + link RPCs (7B-4C Task 3)"
```

---

### Task 4: Planning core RPCs (21 RPCs)

**Files:**
- Create: `packages/bob/src/contracts/schemas/planning-core.ts`
- Create: `packages/bob/src/contracts/groups/planning.ts`
- Create: `packages/bob/src/contracts/stubs/planning.ts`
- Create: `packages/bob/src/contracts/__tests__/planning-core.test.ts`

**Reference:** `packages/bob/src/api/src/router/planning.ts` (1,211 lines)

**Step 1: Create planning-core.ts schemas**

Schemas needed from planning.ts:
- Planning task record (id, title, description, status, priority, kind, assigneeId, etc.)
- Planning label record
- Planning cycle record
- Planning comment record
- Agent task claim/progress/complete/fail schemas
- Status enum: `Schema.Literals(["backlog", "todo", "in_progress", "done", "cancelled"])`
- Priority enum: `Schema.Literals(["urgent", "high", "medium", "low", "no_priority"])`
- Kind enum: reuse `WorkItemKindEnum` from work-item-core

**Step 2: Create groups/planning.ts with 21 RPCs**

All use the `planning.*` namespace:
- `planning.listWorkspaces` — payload: Void, success: Array
- `planning.listProjects` — payload: {workspaceId}
- `planning.getProject` — payload: {id}
- `planning.listTasks` — payload: {workspaceId, projectId?, status?, priority?, assigneeId?, search?, limit?}
- `planning.getTask` — payload: {id}
- `planning.getTaskByIdentifier` — payload: {identifier, workspaceId?}
- `planning.createTask` — payload: {projectId, title, description?, kind?, status?, priority?, assigneeId?, labelIds?, dueDate?}
- `planning.updateTask` — payload: {id, title?, description?, status?, priority?, assigneeId?, dueDate?}
- `planning.addComment` — payload: {issueId, body}
- `planning.listComments` — payload: {issueId, includeReplies?}
- `planning.searchTasks` — payload: {workspaceId, query, limit?}
- `planning.listLabels` — payload: {workspaceId}
- `planning.listCycles` — payload: {workspaceId, status?}
- `planning.getCurrentUser` — payload: Void
- `planning.agentClaimTask` — payload: {agentId, issueId, sessionId?}
- `planning.agentReportProgress` — payload: {taskRunId, progress}
- `planning.agentCompleteTask` — payload: {taskRunId, summary?, artifacts?, markIssueDone?}
- `planning.agentFailTask` — payload: {taskRunId, errorCode, errorMessage, recoverable?, returnToBacklog?}
- `planning.agentGetAvailableTasks` — payload: {agentId, workspaceId, limit?}
- `planning.agentStartSession` — payload: {agentId, workspaceId, clientInfo?}
- `planning.agentEndSession` — payload: {sessionId}

**Step 3: Stubs + test**

Assert `PlanningRpc.requests.size` equals 21.

**Step 4: Commit**

```bash
git commit -m "feat(bob/contracts): add planning core RPCs (7B-4C Task 4)"
```

---

### Task 5: PlanSession RPCs (15 RPCs)

**Files:**
- Create: `packages/bob/src/contracts/schemas/planning-session.ts`
- Modify: `packages/bob/src/contracts/groups/planning.ts`
- Modify: `packages/bob/src/contracts/stubs/planning.ts`
- Create: `packages/bob/src/contracts/__tests__/planning-session.test.ts`

**Reference:** `packages/bob/src/api/src/router/planSession.ts` (830 lines)

**Step 1: Create planning-session.ts schemas**

- `PlanSessionRecordSchema` — session record with id, workspaceId, projectId, status, title, etc.
- `PlanDraftRecordSchema` — draft work item with id, title, description, kind, priority, sortOrder
- `PlanningSessionTypeEnum` — discover values from planSession.ts
- `PlanArtifactSchema` — for saveArtifact
- `PriorContextSchema` — for getPriorContext output

**Step 2: Add 15 RPCs to groups/planning.ts**

All `planning.session.*`:
- `planning.session.create` — payload: {workspaceId?, projectId?, workingDirectory?, title?, workItemId?, planningSessionType?}
- `planning.session.start` — payload: {sessionId, workspaceId, projectId, projectName, workingDirectory, launchContext?}
- `planning.session.get` — payload: {sessionId}
- `planning.session.list` — payload: {workspaceId?, limit?}
- `planning.session.listByWorkItem` — payload: {workItemId, limit?}
- `planning.session.getActiveForWorkItem` — payload: {workItemId}
- `planning.session.saveArtifact` — payload: {sessionId, workItemId, title, content, planningSessionType?}
- `planning.session.getPriorContext` — payload: {workItemId, excludeSessionId?, maxChars?}
- `planning.session.createDraft` — payload: {sessionId, workspaceId, projectId, title, description?, kind?, priority?, sortOrder?}
- `planning.session.updateDraft` — payload: {id, title?, description?, kind?, priority?, sortOrder?}
- `planning.session.removeDraft` — payload: {id}
- `planning.session.setDependency` — payload: {draftId, dependsOnDraftId}
- `planning.session.removeDependency` — payload: {draftId, dependsOnDraftId}
- `planning.session.commitPlan` — payload: {sessionId}
- `planning.session.commitPlanLocal` — payload: {sessionId, parentWorkItemId}

**Step 3: Update stubs, test**

Assert `PlanningRpc.requests.size` equals 36.

**Step 4: Commit**

```bash
git commit -m "feat(bob/contracts): add planning.session RPCs (7B-4C Task 5)"
```

---

### Task 6: Plan + Dispatch RPCs (19 RPCs)

**Files:**
- Create: `packages/bob/src/contracts/schemas/planning-ops.ts`
- Modify: `packages/bob/src/contracts/groups/planning.ts`
- Modify: `packages/bob/src/contracts/stubs/planning.ts`
- Create: `packages/bob/src/contracts/__tests__/planning-ops.test.ts`

**Reference:** `packages/bob/src/api/src/router/plan.ts` (288 lines), `packages/bob/src/api/src/router/dispatch.ts` (896 lines)

**Step 1: Create planning-ops.ts schemas**

- `WorktreePlanRecordSchema` — plan record
- `PlanTaskItemRecordSchema` — from planTaskItems table
- `TaskStatusEnum = Schema.Literals(["pending", "in_progress", "completed", "cancelled"])`
- `TaskPriorityEnum = Schema.Literals(["low", "medium", "high"])`
- `DispatchBatchRecordSchema` — batch record
- `DispatchItemRecordSchema` — item record

**Step 2: Add 11 plan RPCs**

`planning.task.*`:
- `planning.task.list` — payload: {worktreeId?}
- `planning.task.byId` — payload: {id}
- `planning.task.byWorktree` — payload: {worktreeId}
- `planning.task.create` — payload: CreateWorktreePlanSchema fields
- `planning.task.update` — payload: {id, title?, goal?, status?, planningTaskId?}
- `planning.task.delete` — payload: {id}
- `planning.task.syncFromFile` — payload: {id}
- `planning.task.addTask` — payload: CreatePlanTaskItemSchema fields
- `planning.task.updateTask` — payload: {id, content?, status?, priority?, sortOrder?}
- `planning.task.deleteTask` — payload: {id}
- `planning.task.reorderTasks` — payload: {planId, taskIds: Array}

**Step 3: Add 8 dispatch RPCs**

`planning.dispatch.*`:
- `planning.dispatch.createBatch` — payload: {sessionId, concurrency?, tasks: Array({draftId, taskId, identifier})}
- `planning.dispatch.getBatch` — payload: {batchId}
- `planning.dispatch.updateItemAgent` — payload: {itemId, agentType}
- `planning.dispatch.updateConcurrency` — payload: {batchId, concurrency}
- `planning.dispatch.dispatch` — payload: {batchId}
- `planning.dispatch.checkProgress` — payload: {batchId}
- `planning.dispatch.listBatches` — payload: {status?, limit?}
- `planning.dispatch.resetPipelineState` — payload: {itemId}

**Step 4: Update stubs, test**

Assert `PlanningRpc.requests.size` equals 55.

**Step 5: Commit**

```bash
git commit -m "feat(bob/contracts): add planning.task + planning.dispatch RPCs (7B-4C Task 6)"
```

---

### Task 7: Skill + Snapshot + Checkpoint RPCs (12 RPCs)

**Files:**
- Modify: `packages/bob/src/contracts/schemas/planning-ops.ts` (add skill/snapshot/checkpoint schemas)
- Modify: `packages/bob/src/contracts/groups/planning.ts`
- Modify: `packages/bob/src/contracts/stubs/planning.ts`
- Create: `packages/bob/src/contracts/__tests__/planning-skill-snap-cp.test.ts`

**Reference:** `packages/bob/src/api/src/router/skill.ts` (392 lines), `packages/bob/src/api/src/router/snapshot.ts` (96 lines), `packages/bob/src/api/src/router/checkpoint.ts` (104 lines)

**Step 1: Add schemas for skill, snapshot, checkpoint**

- `SkillRecordSchema` — skill template record
- `SkillExecutionRecordSchema` — execution tracking
- `SkillCategoryEnum`, `SkillSourceEnum`, `ExecutionStatusEnum`
- `WorkItemSnapshotRecordSchema` — snapshot record
- `CheckpointRecordSchema` — checkpoint record

**Step 2: Add 6 skill RPCs**

`planning.skill.*`:
- `planning.skill.list` — payload: {category?, source?}
- `planning.skill.seed` — payload: Void
- `planning.skill.getExecution` — payload: {id}
- `planning.skill.listExecutions` — payload: {sessionId?, workItemId?}
- `planning.skill.recordExecution` — payload: {sessionId?, skillId?, skillSlug, workItemId?, parentExecutionId?, status?, input?}
- `planning.skill.updateExecution` — payload: {id, status?, output?, findings?, completedAt?, durationMs?}

**Step 3: Add 3 snapshot RPCs**

`planning.snapshot.*`:
- `planning.snapshot.create` — payload: {workItemId, stage, data}
- `planning.snapshot.list` — payload: {workItemId}
- `planning.snapshot.get` — payload: {id}

**Step 4: Add 3 checkpoint RPCs**

`planning.checkpoint.*`:
- `planning.checkpoint.create` — payload: {sessionId, turnNumber, eventSeq, label?, snapshotData?, gitRef?}
- `planning.checkpoint.list` — payload: {sessionId}
- `planning.checkpoint.branchFrom` — payload: {checkpointId}

**Step 5: Update stubs, test**

Assert `PlanningRpc.requests.size` equals 67.

**Step 6: Commit**

```bash
git commit -m "feat(bob/contracts): add planning.skill + snapshot + checkpoint RPCs (7B-4C Task 7)"
```

---

### Task 8: ForgeGraph RPCs (14 RPCs)

**Files:**
- Create: `packages/bob/src/contracts/schemas/external.ts`
- Create: `packages/bob/src/contracts/groups/external.ts`
- Create: `packages/bob/src/contracts/stubs/external.ts`
- Create: `packages/bob/src/contracts/__tests__/external-forgegraph.test.ts`

**Reference:** `packages/bob/src/api/src/router/forgegraph.ts` (477 lines)

**Step 1: Create external.ts schemas**

ForgeGraph schemas:
- `RevisionRecordSchema` — revision record
- `BuildRecordSchema` — build record
- `DeploymentRecordSchema` — deployment record
- `ForgeAppRecordSchema` — app record
- `RunEventSchema` — run event payload
- `DeployEnvironmentEnum`, `BuildStatusEnum`, `DeployStatusEnum`

**Step 2: Create groups/external.ts with 14 RPCs**

`external.forgegraph.*`:
- `external.forgegraph.listRevisions` — payload: {repoId?, taskId?, limit?}
- `external.forgegraph.getRevision` — payload: {repoId, revId}
- `external.forgegraph.createRevision` — payload: {repoId, revId, taskId?, taskRunId?, branch?}
- `external.forgegraph.triggerBuild` — payload: {revisionId, repoId, idempotencyKey, ciProvider?, taskId?}
- `external.forgegraph.updateBuildStatus` — payload: {buildId, status, imageDigest?, externalJobId?}
- `external.forgegraph.createDeployment` — payload: {revisionId, buildId, repoId, environment, rollbackTargetId?}
- `external.forgegraph.updateDeploymentStatus` — payload: {deploymentId, status}
- `external.forgegraph.ingestRunEvent` — payload: {runId, repoId, revisionId, eventType, taskId?, agentId?, testStatus?, artifactRefs?}
- `external.forgegraph.listDeployments` — payload: {revisionId?, repoId?, environment?}
- `external.forgegraph.listBuilds` — payload: {revisionId?}
- `external.forgegraph.approveProdDeploy` — payload: {dispatchItemId}
- `external.forgegraph.listApps` — payload: Void
- `external.forgegraph.listUnlinkedApps` — payload: {workspaceId}
- `external.forgegraph.importApp` — payload: {workspaceId, appId, key}

**Step 3: Stubs + test**

Assert `ExternalRpc.requests.size` equals 14.

**Step 4: Commit**

```bash
git commit -m "feat(bob/contracts): add external.forgegraph RPCs (7B-4C Task 8)"
```

---

### Task 9: Webhook + PublicApi RPCs (17 RPCs)

**Files:**
- Modify: `packages/bob/src/contracts/schemas/external.ts`
- Modify: `packages/bob/src/contracts/groups/external.ts`
- Modify: `packages/bob/src/contracts/stubs/external.ts`
- Create: `packages/bob/src/contracts/__tests__/external-webhook-api.test.ts`

**Reference:** `packages/bob/src/api/src/router/webhook.ts` (260 lines), `packages/bob/src/api/src/router/publicApi.ts` (540 lines)

**Step 1: Add webhook + publicApi schemas**

- `WebhookConfigRecordSchema` — webhook config
- `WebhookDeliveryRecordSchema` — delivery log
- `PublicApiRunRecordSchema` — public API run
- `PublicApiArtifactRecordSchema` — public API artifact
- `HeartbeatRepoSchema` — repo info in heartbeat
- `RunStatusEnum = Schema.Literals(["running", "completed", "failed"])`
- `PublicApiArtifactTypeEnum = Schema.Literals(["diff", "log", "test-report", "file-snapshot"])`

**Step 2: Add 8 webhook RPCs**

`external.webhook.*`:
- `external.webhook.list` — payload: {workspaceId?, activeOnly?}
- `external.webhook.byId` — payload: {id}
- `external.webhook.create` — payload: {workspaceId?, url, secret, events?, active?, description?}
- `external.webhook.update` — payload: {id, url?, secret?, events?, active?, description?}
- `external.webhook.delete` — payload: {id}
- `external.webhook.deliveries` — payload: {configId, limit?, cursor?}
- `external.webhook.redeliver` — payload: {deliveryId}
- `external.webhook.testWebhook` — payload: {configId}

**Step 3: Add 9 publicApi RPCs**

`external.publicApi.*`:
- `external.publicApi.registerWorkspace` — payload: {name, slug, machineId, repoPath?}
- `external.publicApi.createRun` — payload: {workItemId, workspaceId, agentType, agentConfig?}
- `external.publicApi.updateRun` — payload: {runId, status, summary?}
- `external.publicApi.createArtifact` — payload: {runId, type, storageKey, metadata?}
- `external.publicApi.getRun` — payload: {runId}
- `external.publicApi.listRuns` — payload: {workspaceId, limit?}
- `external.publicApi.listRunsByWorkItem` — payload: {workItemId, limit?}
- `external.publicApi.heartbeat` — payload: {workspaceId, agentTypes?, forgeAvailable?, repos?}
- `external.publicApi.generateApiKey` — payload: {name?}

**Step 4: Update stubs, test**

Assert `ExternalRpc.requests.size` equals 31.

**Step 5: Commit**

```bash
git commit -m "feat(bob/contracts): add external.webhook + publicApi RPCs (7B-4C Task 9)"
```

---

### Task 10: Barrel exports + final verification (129 RPCs total)

**Files:**
- Modify: `packages/bob/src/contracts/index.ts`
- Create: `packages/bob/src/contracts/__tests__/all-bob-groups.test.ts`

**Step 1: Update barrel exports**

Update `packages/bob/src/contracts/index.ts` to export:
- All 3 RpcGroup instances: `WorkItemsRpc`, `PlanningRpc`, `ExternalRpc`
- All individual Rpc descriptors (for handler typing)
- All schemas (for client and handler use)
- All stub layers
- Existing error + bridge exports (keep as-is)

**Step 2: Create all-bob-groups.test.ts**

```ts
import { describe, expect, it } from "vitest";
import { WorkItemsRpc } from "../groups/work-items.js";
import { PlanningRpc } from "../groups/planning.js";
import { ExternalRpc } from "../groups/external.js";

describe("Bob contract groups — Phase 7B-4C verification", () => {
  it("WorkItemsRpc has 31 procedures", () => {
    expect(WorkItemsRpc.requests.size).toBe(31);
  });

  it("PlanningRpc has 67 procedures", () => {
    expect(PlanningRpc.requests.size).toBe(67);
  });

  it("ExternalRpc has 31 procedures", () => {
    expect(ExternalRpc.requests.size).toBe(31);
  });

  it("Bob domain total is 129 procedures", () => {
    const total =
      WorkItemsRpc.requests.size +
      PlanningRpc.requests.size +
      ExternalRpc.requests.size;
    expect(total).toBe(129);
  });
});
```

**Step 3: Run full test suite**

Run: `pnpm exec turbo run test --concurrency=1 -- --no-file-parallelism`
Expected: all core tests pass (458), all bob API tests pass (370/1 skipped), all new bob contract tests pass.

**Step 4: Commit**

```bash
git commit -m "feat(bob/contracts): barrel exports + final verification (7B-4C Task 10)"
```

---

## Test Baselines

- `@gmacko/core` tests: 458 (unchanged — this phase only touches `@gmacko/bob`)
- `@bob/api` tests: 370 passed, 1 skipped (unchanged — no router modifications)
- New `@gmacko/bob` contract tests: TBD (expect ~80-100 new tests across 8 test files)

## Completion Criteria

- [ ] 3 new RpcGroups in `packages/bob/src/contracts/groups/` (WorkItems, Planning, External)
- [ ] 129 total Rpc.make() contract descriptors matching Bob's tRPC procedures
- [ ] All schemas translated from Zod to Effect Schema
- [ ] Stub layers for all 3 groups
- [ ] All tests passing
- [ ] Barrel exports complete
- [ ] Existing test baselines maintained
