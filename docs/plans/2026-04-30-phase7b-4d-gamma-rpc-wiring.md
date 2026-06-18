# Phase 7B-4D-gamma: Wire Effect-RPC Endpoint for Bob Domain Contracts

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the 3 Bob domain RpcGroups (WorkItemsRpc 31, PlanningRpc 67, ExternalRpc 31 = 129 procedures) to the Effect-RPC server, bridging handler factories to contract-named layers.

**Architecture:** Each RpcGroup gets an aggregate layer file that imports router-level handler factories, remaps their keys to match contract RPC names, and produces a `Layer` via `RpcGroup.toLayer()`. The RPC server merges all groups and serves them at `/api/rpc`.

**Tech Stack:** Effect 4.0.0-beta.43, Effect-RPC (effect/unstable/rpc), TypeScript

---

## Key Insight: Naming Mismatch

Handler factory keys (from beta) use `"<routerName>.<procedureName>"` format.
Contract RPC names use `"<group>.<namespace>.<action>"` format.

Examples:
- Factory: `"forgegraph.listRevisions"` → Contract: `"external.forgegraph.listRevisions"`
- Factory: `"planSession.create"` → Contract: `"planning.session.create"`
- Factory: `"workItems.list"` → Contract: `"workItem.list"`
- Factory: `"link.list"` → Contract: `"workItem.link.list"`

The aggregate layer files handle this remapping.

---

### Task 1: WorkItemsRpc aggregate layer (31 procedures)

**Files:**
- Create: `packages/bob/src/api/src/rpc-layers/work-items.ts`

**Mapping (factory key → contract name):**

From `workItems` factory:
- `"workItems.list"` → `"workItem.list"`
- `"workItems.get"` → `"workItem.get"`
- `"workItems.update"` → `"workItem.update"`
- `"workItems.promoteToTask"` → `"workItem.promoteToTask"`
- `"workItems.listComments"` → `"workItem.comment.list"`
- `"workItems.createComment"` → `"workItem.comment.create"`
- `"workItems.createArtifact"` → `"workItem.artifact.create"`
- `"workItems.listCurrentArtifacts"` → `"workItem.artifact.listCurrent"`
- `"workItems.listChildArtifactGroups"` → `"workItem.artifact.listChildGroups"`
- `"workItems.listActivities"` → `"workItem.activity.list"`
- `"workItems.listRecentActivities"` → `"workItem.activity.listRecent"`
- `"workItems.listNotifications"` → `"workItem.notification.list"`
- `"workItems.createNotification"` → `"workItem.notification.create"`
- `"workItems.markNotificationAsRead"` → `"workItem.notification.markAsRead"`
- `"workItems.registerPushToken"` → `"workItem.notification.registerPushToken"`

From `agentRun` factory (→ workItem.taskRun namespace):
- `"agentRun.get"` → skip (no contract — not in WorkItemsRpc)
- `"agentRun.list"` → skip (no contract)
- `"agentRun.listByWorkItem"` → `"workItem.taskRun.listByWorkItem"`

Note: agentRun.get/list have no corresponding contracts; only listByWorkItem + execute + listLifecycleEvents do. The execute and listLifecycleEvents handlers are in the workItems factory.

From workItems factory (taskRun sub-procedures):
- Need to check: `"workItems.taskRun.execute"` → `"workItem.taskRun.execute"` (may be named differently in factory)
- Need to check: `"workItems.taskRun.listLifecycleEvents"` → `"workItem.taskRun.listLifecycleEvents"`

From `requirement` factory:
- `"requirement.list"` → `"workItem.requirement.list"`
- `"requirement.create"` → `"workItem.requirement.create"`
- `"requirement.update"` → `"workItem.requirement.update"`
- `"requirement.delete"` → `"workItem.requirement.delete"`
- `"requirement.linkToTask"` → `"workItem.requirement.linkToTask"`

From `link` factory:
- `"link.list"` → `"workItem.link.list"`
- `"link.byId"` → `"workItem.link.byId"`
- `"link.byWorktree"` → `"workItem.link.byWorktree"`
- `"link.create"` → `"workItem.link.create"`
- `"link.update"` → `"workItem.link.update"`
- `"link.delete"` → `"workItem.link.delete"`
- `"link.linkToPlanningTask"` → `"workItem.link.linkToPlanningTask"`
- `"link.linkToGitHubPR"` → `"workItem.link.linkToGitHubPR"`

**Step 1:** Read the handler factory files to verify exact key names:
- `packages/bob/src/api/src/rpc-handlers/workItems.ts`
- `packages/bob/src/api/src/rpc-handlers/agentRun.ts`
- `packages/bob/src/api/src/rpc-handlers/requirement.ts`
- `packages/bob/src/api/src/rpc-handlers/link.ts`

**Step 2:** Create `packages/bob/src/api/src/rpc-layers/work-items.ts`:

```ts
import type { HandlerContext } from "../handlers/context.js";
import { WorkItemsRpc } from "@gmacko/bob/contracts";
import { makeWorkItemsRpcHandlers } from "../rpc-handlers/workItems.js";
import { makeAgentRunRpcHandlers } from "../rpc-handlers/agentRun.js";
import { makeRequirementRpcHandlers } from "../rpc-handlers/requirement.js";
import { makeLinkRpcHandlers } from "../rpc-handlers/link.js";

export const makeWorkItemsLayer = (ctx: HandlerContext) => {
  const wi = makeWorkItemsRpcHandlers(ctx);
  const ar = makeAgentRunRpcHandlers(ctx);
  const req = makeRequirementRpcHandlers(ctx);
  const lnk = makeLinkRpcHandlers(ctx);

  return WorkItemsRpc.toLayer({
    "workItem.list": wi["workItems.list"],
    "workItem.get": wi["workItems.get"],
    // ... map all 31 contract names to factory handler entries
  });
};
```

**Step 3:** Run tests: `cd packages/bob/src/api && pnpm exec vitest run --no-file-parallelism`

**Step 4:** Commit:
```bash
git commit -m "feat(bob/api): WorkItemsRpc aggregate layer — 31 contract handlers wired (7B-4D-gamma Task 1)"
```

---

### Task 2: PlanningRpc aggregate layer (67 procedures)

**Files:**
- Create: `packages/bob/src/api/src/rpc-layers/planning.ts`

**Mapping — from these factories:**

From `planning` factory (21 procedures → top-level planning.* contracts):
- `"planning.listWorkspaces"` → `"planning.listWorkspaces"` ✓ (already matches)
- `"planning.listProjects"` → `"planning.listProjects"` ✓
- ... all 21 top-level planning.* should already match

From `planSession` factory (15 → planning.session.*):
- `"planSession.create"` → `"planning.session.create"`
- `"planSession.start"` → `"planning.session.start"`
- ... prefix change: `planSession.` → `planning.session.`

From `plan` factory (11 → planning.task.*):
- `"plan.list"` → `"planning.task.list"`
- `"plan.byId"` → `"planning.task.byId"`
- ... prefix change: `plan.` → `planning.task.`

From `dispatch` factory (8 → planning.dispatch.*):
- `"dispatch.createBatch"` → `"planning.dispatch.createBatch"`
- ... prefix change: `dispatch.` → `planning.dispatch.`

From `skill` factory (6 → planning.skill.*):
- `"skill.list"` → `"planning.skill.list"`
- ... prefix change: `skill.` → `planning.skill.`

From `snapshot` factory (3 → planning.snapshot.* — already correct from alpha):
- `"planning.snapshot.create"` → `"planning.snapshot.create"` ✓
- `"planning.snapshot.list"` → `"planning.snapshot.list"` ✓
- `"planning.snapshot.get"` → `"planning.snapshot.get"` ✓

From `checkpoint` factory (3 → planning.checkpoint.*):
- `"checkpoint.create"` → `"planning.checkpoint.create"`
- `"checkpoint.list"` → `"planning.checkpoint.list"`
- `"checkpoint.branchFrom"` → `"planning.checkpoint.branchFrom"`

**Step 1:** Read all 7 handler factory files to verify exact key names.

**Step 2:** Create aggregate layer following same pattern as Task 1.

**Step 3:** Run tests.

**Step 4:** Commit:
```bash
git commit -m "feat(bob/api): PlanningRpc aggregate layer — 67 contract handlers wired (7B-4D-gamma Task 2)"
```

---

### Task 3: ExternalRpc aggregate layer (31 procedures)

**Files:**
- Create: `packages/bob/src/api/src/rpc-layers/external.ts`

**Mapping — from these factories:**

From `forgegraph` factory (14 → external.forgegraph.*):
- `"forgegraph.listRevisions"` → `"external.forgegraph.listRevisions"`
- ... prefix change: `forgegraph.` → `external.forgegraph.`

From `webhook` factory (8 → external.webhook.*):
- `"webhook.list"` → `"external.webhook.list"`
- ... prefix change: `webhook.` → `external.webhook.`

From `publicApi` factory (9 → external.publicApi.*):
- `"publicApi.registerWorkspace"` → `"external.publicApi.registerWorkspace"`
- `"publicApi.createRun"` → `"external.publicApi.createRun"`
- ... prefix change: `publicApi.` → `external.publicApi.`

**Step 1:** Read 3 handler factory files, verify exact key names.

**Step 2:** Create aggregate layer.

**Step 3:** Run tests.

**Step 4:** Commit:
```bash
git commit -m "feat(bob/api): ExternalRpc aggregate layer — 31 contract handlers wired (7B-4D-gamma Task 3)"
```

---

### Task 4: Wire RPC server with all 3 groups

**Files:**
- Modify: `apps/bob/src/server/rpc.ts`

**Current state:** Serves only `HealthRpc` at `/api/rpc`.

**Target state:** Serve HealthRpc + WorkItemsRpc + PlanningRpc + ExternalRpc.

**Step 1:** Read current `apps/bob/src/server/rpc.ts` and `apps/bob/src/server/layers.ts`.

**Step 2:** Research how Effect-RPC handles multiple RpcGroups. Options:
- `RpcGroup.merge(HealthGroup, WorkItemsRpc, PlanningRpc, ExternalRpc)` if API supports it
- Separate `RpcServer.layerHttp` per group if merge not available
- Add each group's handlers alongside existing health handler

**Step 3:** Update `apps/bob/src/server/rpc.ts`:
- Import the 3 aggregate layer factories
- Construct a HandlerContext from the existing runtime (db + user from auth)
- Provide the aggregate layers to the server
- Keep the health endpoint

**Step 4:** Run full test suite:
```bash
pnpm exec turbo run test --concurrency=1 -- --no-file-parallelism
```

**Step 5:** Commit:
```bash
git commit -m "feat(bob/api): wire WorkItemsRpc + PlanningRpc + ExternalRpc into Effect-RPC server (7B-4D-gamma Task 4)"
```

---

### Task 5: Integration test + verification

**Files:**
- Create: `packages/bob/src/api/src/__tests__/rpc-layers.test.ts`

**Step 1:** Write tests verifying each aggregate layer can be constructed:
- `makeWorkItemsLayer(ctx)` returns a valid Layer (31 handlers)
- `makePlanningLayer(ctx)` returns a valid Layer (67 handlers)
- `makeExternalLayer(ctx)` returns a valid Layer (31 handlers)

**Step 2:** Run full test suite.

**Step 3:** Commit:
```bash
git commit -m "test(bob/api): aggregate layer verification tests (7B-4D-gamma Task 5)"
```

---

## Important Notes

- The aggregate layers do NOT replace the per-router rpc-handler factories — they compose them
- Handler factories for routers without Bob domain contracts (auth, session, settings, etc.) are left for future platform wiring
- The `HandlerContext` in the server needs `db` and `userId` — the server must extract these from the Effect context (via `GmackoDb` service and `AuthMiddleware`)
