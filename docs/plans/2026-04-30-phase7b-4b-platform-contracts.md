# Phase 7B-4B — Platform Contracts in Core

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Define Effect-RPC contracts for all Bob procedures that belong in the platform layer (`@gmacko/core/contracts`). These are the Agent, Project, Settings, and Auth groups — procedures shared by both Bob and OODA.

**Architecture:** Contracts-first — define all `Rpc.make()` contracts + Effect Schema types. No handlers yet (those land in Phase D). Each sub-namespace gets its own schema file and contract declarations within the existing group file. Existing gmacko contracts (5 Agent, 4 Projects, 6 Secrets, 9 Auth) are preserved; new procedures extend the same groups.

**Tech Stack:** Effect 4.0.0-beta.43, `Rpc.make()` from `effect/unstable/rpc`, `Schema` from `effect`.

**Branch:** `phase-7b-4b-platform-contracts`
**Worktree:** `~/.config/superpowers/worktrees/gmacko/phase-7b-4b-platform-contracts`

---

## Conventions

### Naming

Procedure names use dot notation: `group.subNamespace.verb` — e.g. `agent.session.list`, `project.repository.add`.

For procedures extending existing groups (Agent, Projects, Secrets, Auth), new procedures sit alongside existing ones in the same group file.

### Schema file organization

Each sub-namespace gets a schema file in `packages/core/src/contracts/schemas/`:
- `agent-session.ts`, `agent-instance.ts`, `agent-run.ts`, etc.
- `project-repository.ts`, `project-pull-request.ts`, etc.
- `settings-general.ts`, `settings-cookies.ts`, etc.

### Error pattern

Reuse existing tagged errors where possible (`NotFoundError`, `UnauthorizedError` from `@gmacko/core/rpc/errors`). Add new tagged errors only when the error carries domain-specific fields.

### Auth level encoding

Auth level is NOT encoded in the contract. The `AuthMiddleware` handles auth enforcement. Public procedures will be handled differently at handler-wiring time (Phase D).

### Translation rules (Zod → Effect Schema)

| Zod | Effect Schema |
|-----|---------------|
| `z.string()` | `Schema.String` |
| `z.string().uuid()` | `Schema.String.pipe(Schema.UUID)` |
| `z.string().url()` | `Schema.String` |
| `z.string().min(1).max(N)` | `Schema.String` |
| `z.number()` | `Schema.Number` |
| `z.number().int()` | `Schema.Number` |
| `z.boolean()` | `Schema.Boolean` |
| `z.date()` | `Schema.DateTimeUtcFromString` |
| `z.enum([...])` | `Schema.Literal(...)` for single, `Schema.Union([Schema.Literal(...), ...])` for multiple |
| `z.object({...})` | `Schema.Struct({...})` |
| `z.array(...)` | `Schema.Array(...)` |
| `z.record(z.string(), z.unknown())` | `Schema.Record({ key: Schema.String, value: Schema.Unknown })` |
| `z.optional(...)` or `.optional()` | `Schema.optional(...)` |
| `.default(val)` | `Schema.optional(...)` (default applied at handler) |
| `z.null()` or `.nullable()` | `Schema.NullOr(...)` |

### Test pattern

Each task creates a test that imports the group, verifies procedure count, and spot-checks a few procedure tags:

```ts
import { describe, expect, it } from "vitest";
import { AgentRpc } from "@gmacko/core/contracts/groups/agent";

describe("AgentRpc group", () => {
  it("has the expected procedure count", () => {
    // RpcGroup exposes .rpcs — an object keyed by procedure tag
    expect(Object.keys(AgentRpc.rpcs).length).toBe(N);
  });

  it("includes agent.session.list", () => {
    expect(AgentRpc.rpcs["agent.session.list"]).toBeDefined();
  });
});
```

---

## Task 1: Agent Run + Capture schemas and contracts

Extend `AgentRpc` with 5 new procedures: 3 from `agentRun.ts` + 2 from `capture.ts`.

**Files:**
- Create: `packages/core/src/contracts/schemas/agent-run.ts`
- Create: `packages/core/src/contracts/schemas/agent-capture.ts`
- Modify: `packages/core/src/contracts/groups/agent.ts` — add 5 new RPCs to `AgentRpc`
- Modify: `packages/core/src/contracts/index.ts` — export new schemas
- Create: `packages/core/src/contracts/__tests__/agent-run-capture.test.ts`

**Procedures to add:**

| Tag | Type | Payload | Success |
|-----|------|---------|---------|
| `agent.run.get` | query | `{ runId: UUID }` | `AgentRunSchema` |
| `agent.run.list` | query | `{ workspaceId: UUID, limit?: number }` | `Array(AgentRunSchema)` |
| `agent.run.listByWorkItem` | query | `{ workItemId: string, limit?: number }` | `Array(AgentRunSchema)` |
| `agent.capture.listTargets` | query | `Void` | `Array(CaptureTargetSchema)` |
| `agent.capture.capture` | mutation | `{ targetType: "browser"\|"window"\|"screen", targetId?: string, url?: string }` | `CaptureResultSchema` |

**Schemas to define:**

`agent-run.ts`:
```ts
export const AgentRunSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.UUID),
  workspaceId: Schema.String.pipe(Schema.UUID),
  sessionId: Schema.NullOr(Schema.String.pipe(Schema.UUID)),
  workItemId: Schema.NullOr(Schema.String),
  status: Schema.Literal("pending", "running", "completed", "failed", "cancelled"),
  startedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  completedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  createdAt: Schema.DateTimeUtcFromString,
});
```

`agent-capture.ts`:
```ts
export const CaptureTargetSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.Literal("browser", "screen", "window"),
  description: Schema.String,
  connected: Schema.Boolean,
});

export const CaptureResultSchema = Schema.Struct({
  url: Schema.String,
  filename: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  capturedAt: Schema.String,
});
```

**Error:** `NotFoundError` from `@gmacko/core/rpc/errors` for `agent.run.get` and `agent.run.listByWorkItem`.

### Steps

1. Write test importing `AgentRpc`, asserting it has 10 procedures (existing 5 + new 5) and spot-checking `agent.run.get` exists.
2. Run test — expect FAIL (only 5 procedures).
3. Create `agent-run.ts` and `agent-capture.ts` schema files.
4. Add 5 `Rpc.make()` declarations to `agent.ts`, add them to the `AgentRpc = RpcGroup.make(...)` call.
5. Update `index.ts` barrel with new schema/type exports.
6. Run test — expect PASS.
7. Verify `@gmacko/core` baseline: `pnpm --filter @gmacko/core test -- --no-file-parallelism` (347 + new tests).
8. Commit: `feat(contracts): add agent.run + agent.capture RPCs (7B-4B Task 1)`

---

## Task 2: Agent Session schemas and contracts

Extend `AgentRpc` with 28 procedures from `session.ts` (the largest router).

**Files:**
- Create: `packages/core/src/contracts/schemas/agent-session.ts`
- Modify: `packages/core/src/contracts/groups/agent.ts` — add 28 RPCs
- Modify: `packages/core/src/contracts/index.ts`
- Create: `packages/core/src/contracts/__tests__/agent-session.test.ts`

**Procedures to add:**

| Tag | Type | Key payload fields |
|-----|------|--------------------|
| `agent.session.list` | query | `{ repositoryId?, worktreeId?, status?, limit?, cursor? }` |
| `agent.session.get` | query | `{ id: UUID }` |
| `agent.session.create` | mutation | `{ repositoryId?, worktreeId?, workingDirectory, agentType?, title? }` |
| `agent.session.bootstrapForChat` | mutation | same as create |
| `agent.session.updateTitle` | mutation | `{ id: UUID, title }` |
| `agent.session.stop` | mutation | `{ id: UUID }` |
| `agent.session.delete` | mutation | `{ id: UUID }` |
| `agent.session.getEvents` | query | `{ sessionId: UUID, fromSeq?, toSeq?, limit? }` |
| `agent.session.getConnections` | query | `{ sessionId: UUID }` |
| `agent.session.sendHeadlessInput` | mutation | `{ sessionId: UUID, message }` |
| `agent.session.updateStatus` | mutation | `{ id: UUID, status, lastError? }` |
| `agent.session.claimLease` | mutation | `{ sessionId: UUID, gatewayId, leaseMs? }` |
| `agent.session.releaseLease` | mutation | `{ sessionId: UUID }` |
| `agent.session.recordEvent` | mutation | `{ sessionId: UUID, seq, direction, eventType, payload }` |
| `agent.session.recordEventBatch` | mutation | `{ sessionId: UUID, events[] }` |
| `agent.session.getGatewayWebSocketUrl` | query | `Void` |
| `agent.session.reportWorkflowStatus` | mutation | `{ sessionId: UUID, status, message, details? }` |
| `agent.session.reportTaskProgress` | mutation | `{ sessionId: UUID, message, phase?, progress? }` |
| `agent.session.linkTaskArtifact` | mutation | `{ sessionId: UUID, artifactType, artifactRole?, url, title?, summary? }` |
| `agent.session.markTaskReviewReady` | mutation | `{ sessionId: UUID, prUrl, summary, notesForReviewer? }` |
| `agent.session.recordVerificationResult` | mutation | `{ sessionId: UUID, result, summary, artifactUrl? }` |
| `agent.session.completeTask` | mutation | `{ sessionId: UUID, summary, prUrl?, markIssueDone? }` |
| `agent.session.requestInput` | mutation | `{ sessionId: UUID, question, options?, defaultAction, timeoutMinutes? }` |
| `agent.session.resolveAwaitingInput` | mutation | `{ sessionId: UUID, resolution: { type, value } }` |
| `agent.session.getWorkflowState` | query | `{ sessionId: UUID }` |
| `agent.session.createVoiceSession` | mutation | `{ sessionId: UUID }` |
| `agent.session.stopVoiceSession` | mutation | `{ sessionId: UUID }` |
| `agent.session.handleVoiceTranscript` | mutation | `{ sessionId: UUID, transcript }` |

**Key schemas:** `SessionSchema`, `SessionEventSchema`, `SessionConnectionSchema`, `WorkflowStateSchema`, `SessionStatusEnum`, `WorkflowStatusEnum`, `EventDirectionEnum`, `ArtifactTypeEnum`, `ArtifactRoleEnum`.

Read `packages/bob/src/api/src/router/session.ts` for exact Zod shapes. The session status enum is `["provisioning", "starting", "running", "idle", "stopping", "stopped", "error"]`. Workflow status enum is `["planning", "implementing", "testing", "reviewing", "awaiting_input", "completed", "failed", "cancelled"]`.

**Errors:** `NotFoundError` for get/stop/delete/getEvents/etc. `BobConflictError` (from `@gmacko/bob/contracts`) for `claimLease` (409).

### Steps

1. Write test asserting `AgentRpc` has 38 procedures (10 from Task 1 + 28 new) and spot-checking `agent.session.list`, `agent.session.create`, `agent.session.recordEvent`.
2. Run test — expect FAIL.
3. Create `agent-session.ts` schema file with all enum/struct schemas.
4. Add 28 `Rpc.make()` declarations to `agent.ts`.
5. Update barrel.
6. Run test — expect PASS.
7. Verify baseline.
8. Commit: `feat(contracts): add agent.session RPCs (7B-4B Task 2)`

---

## Task 3: Agent Instance + Terminal + Event schemas and contracts

Extend `AgentRpc` with 19 more procedures: instance (9) + terminal (5) + event (5).

**Files:**
- Create: `packages/core/src/contracts/schemas/agent-instance.ts`
- Create: `packages/core/src/contracts/schemas/agent-terminal.ts`
- Create: `packages/core/src/contracts/schemas/agent-event.ts`
- Modify: `packages/core/src/contracts/groups/agent.ts` — add 19 RPCs
- Modify: `packages/core/src/contracts/index.ts`
- Create: `packages/core/src/contracts/__tests__/agent-instance-terminal-event.test.ts`

**Instance procedures (9):** list, byId, byRepository, byWorktree, start, stop, restart, delete, updateStatus.
**Terminal procedures (5):** createAgentSession, createDirectorySession, createSystemSession, listByInstance, close.
**Event procedures (5):** list, create, recentActivity, byWorktree, stats.

Read the Bob routers for exact shapes. Key enums: `agentTypeEnum` (instance.ts), `instanceStatusEnum` (instance.ts), `eventTypeEnum` (event.ts).

### Steps

1. Write test asserting `AgentRpc` has 57 procedures (38 + 19) and spot-checking `agent.instance.start`, `agent.terminal.close`, `agent.event.stats`.
2. Run test — expect FAIL.
3. Create 3 schema files.
4. Add 19 RPCs to `agent.ts`.
5. Update barrel.
6. Run test — expect PASS.
7. Verify baseline.
8. Commit: `feat(contracts): add agent.instance + terminal + event RPCs (7B-4B Task 3)`

---

## Task 4: Agent Filesystem + Chat + Post contracts

Extend `AgentRpc` with remaining procedures: filesystem (9) + chat (8) + post (4) = 21.

**Files:**
- Create: `packages/core/src/contracts/schemas/agent-filesystem.ts`
- Create: `packages/core/src/contracts/schemas/agent-chat.ts`
- Modify: `packages/core/src/contracts/groups/agent.ts` — add 21 RPCs
- Modify: `packages/core/src/contracts/index.ts`
- Create: `packages/core/src/contracts/__tests__/agent-filesystem-chat-post.test.ts`

**Filesystem procedures (9):** All throw NOT_IMPLEMENTED — define contracts anyway for completeness. list, read, write, delete, mkdir, move, copy, search, gitStatus.

**Chat procedures (8):** listConversations, getConversation, createConversation, deleteConversation, sendMessage, getMessages, attachImage, getAttachments. These map to `agent.chat.*` namespace (NOT agent.session — they're distinct from session lifecycle).

**Post procedures (4):** These are a Bob sample/demo — map to `agent.post.*`: all, byId, create, delete. `all` and `byId` are public procedures.

After this task, `AgentRpc` should have 78 procedures total (existing 5 + 73 new).

### Steps

1. Write test asserting `AgentRpc` has 78 procedures.
2. Run test — expect FAIL.
3. Create schema files. `agent-filesystem.ts` is simple (placeholder types). `agent-chat.ts` has `ChatConversationSchema` (already exists in `schemas/agent.ts` — reuse it) and `ChatAttachmentSchema`.
4. Add 21 RPCs to `agent.ts`.
5. Update barrel.
6. Run test — expect PASS.
7. Verify baseline.
8. Commit: `feat(contracts): add agent.filesystem + chat + post RPCs (7B-4B Task 4)`

---

## Task 5: Project core + Workspace contracts

Extend `ProjectsRpc` with 10 new procedures: project (6 from Bob — 3 overlap with existing, so net 3 new) + workspace (4).

**Files:**
- Create: `packages/core/src/contracts/schemas/project-workspace.ts`
- Modify: `packages/core/src/contracts/schemas/projects.ts` — add project discovery/automation schemas
- Modify: `packages/core/src/contracts/groups/projects.ts` — add RPCs
- Modify: `packages/core/src/contracts/index.ts`
- Create: `packages/core/src/contracts/__tests__/project-workspace.test.ts`

**Existing gmacko procedures (keep as-is):** `projects.create`, `projects.list`, `projects.getBySlug`, `projects.delete`.

**New project procedures from Bob:**

| Tag | Type | Notes |
|-----|------|-------|
| `projects.get` | query | By ID (vs existing getBySlug) |
| `projects.discovery` | query | Workspace discovery |
| `projects.updateAutomationSettings` | mutation | Automation config |
| `projects.dismissDir` | mutation | Dismiss discovered dir |

**New workspace procedures:**

| Tag | Type |
|-----|------|
| `projects.workspace.list` | query |
| `projects.workspace.create` | mutation |
| `projects.workspace.rename` | mutation |
| `projects.workspace.delete` | mutation |

After this task, `ProjectsRpc` should have 12 procedures (existing 4 + 8 new).

### Steps

1. Write test asserting `ProjectsRpc` has 12 procedures.
2. Run test — expect FAIL.
3. Create `project-workspace.ts` schema, update `projects.ts` schema.
4. Add 8 RPCs to `projects.ts` group.
5. Update barrel.
6. Run test — expect PASS.
7. Verify baseline.
8. Commit: `feat(contracts): add project + workspace RPCs (7B-4B Task 5)`

---

## Task 6: Project Repository contracts

Extend `ProjectsRpc` with 12 repository procedures.

**Files:**
- Create: `packages/core/src/contracts/schemas/project-repository.ts`
- Modify: `packages/core/src/contracts/groups/projects.ts`
- Modify: `packages/core/src/contracts/index.ts`
- Create: `packages/core/src/contracts/__tests__/project-repository.test.ts`

**Procedures:**

| Tag | Type |
|-----|------|
| `projects.repository.list` | query |
| `projects.repository.byId` | query |
| `projects.repository.add` | mutation |
| `projects.repository.addFromProvider` | mutation |
| `projects.repository.delete` | mutation |
| `projects.repository.refreshMainBranch` | mutation |
| `projects.repository.getWorktrees` | query |
| `projects.repository.createWorktree` | mutation |
| `projects.repository.getWorktreePlanning` | query |
| `projects.repository.updateWorktreePlanning` | mutation |
| `projects.repository.deleteWorktree` | mutation |
| `projects.repository.getWorktreeMergeStatus` | query |

**Key schemas:** `RepositorySchema`, `WorktreeSchema`, `WorktreePlanSchema`.

After: `ProjectsRpc` = 24 procedures.

### Steps

1. Write test asserting 24 procedures, spot-check `projects.repository.createWorktree`.
2. Run test — FAIL.
3. Create schema, add RPCs.
4. Update barrel.
5. Run test — PASS.
6. Verify baseline.
7. Commit: `feat(contracts): add project.repository RPCs (7B-4B Task 6)`

---

## Task 7: Project PullRequest + FeatureBranch contracts

Extend `ProjectsRpc` with 19 more: pullRequest (12) + featureBranch (7).

**Files:**
- Create: `packages/core/src/contracts/schemas/project-pull-request.ts`
- Create: `packages/core/src/contracts/schemas/project-feature-branch.ts`
- Modify: `packages/core/src/contracts/groups/projects.ts`
- Modify: `packages/core/src/contracts/index.ts`
- Create: `packages/core/src/contracts/__tests__/project-pr-fb.test.ts`

**PullRequest procedures (12):** list, get, listByRepository, listBySession, create, update, merge, syncCommits, linkToPlanningTask, refresh, listReviews, addReview.

**FeatureBranch procedures (7):** create, get, list, addTaskPR, markTaskPRMerged, createFeaturePR, updateStatus.

After: `ProjectsRpc` = 43 procedures.

### Steps

1-7: Same pattern. Commit: `feat(contracts): add project.pullRequest + featureBranch RPCs (7B-4B Task 7)`

---

## Task 8: Project GitProvider + Git contracts

Extend `ProjectsRpc` with 13 more: gitProviders (6) + git (7).

**Files:**
- Create: `packages/core/src/contracts/schemas/project-git-provider.ts`
- Create: `packages/core/src/contracts/schemas/project-git.ts`
- Modify: `packages/core/src/contracts/groups/projects.ts`
- Modify: `packages/core/src/contracts/index.ts`
- Create: `packages/core/src/contracts/__tests__/project-git.test.ts`

**GitProvider procedures (6):** listConnections, connectPat, disconnect, testConnection, setDefaultForRepo, detectRemote.

**Git procedures (7):** pushAndCreatePr, jjIsRepo, jjLog, jjNew, jjDescribe, jjSquash, jjDiff.

After: `ProjectsRpc` = 56 procedures (existing 4 + 52 new).

### Steps

1-7: Same pattern. Commit: `feat(contracts): add project.gitProvider + git RPCs (7B-4B Task 8)`

---

## Task 9: Settings contracts (new group)

Create a new `SettingsRpc` group with 20 procedures: general settings (13) + system (2) + cookies (5).

**Files:**
- Create: `packages/core/src/contracts/groups/settings.ts`
- Create: `packages/core/src/contracts/schemas/settings-general.ts`
- Create: `packages/core/src/contracts/schemas/settings-cookies.ts`
- Create: `packages/core/src/contracts/schemas/settings-system.ts`
- Modify: `packages/core/src/contracts/index.ts`
- Create: `packages/core/src/contracts/__tests__/settings.test.ts`

**General settings (13):**

| Tag | Type |
|-----|------|
| `settings.getPreferences` | query |
| `settings.updatePreferences` | mutation |
| `settings.listApiKeys` | query |
| `settings.createApiKey` | mutation |
| `settings.revokeApiKey` | mutation |
| `settings.listConfigRoots` | query |
| `settings.listConfigEntries` | query |
| `settings.readConfigFile` | query |
| `settings.writeConfigFile` | mutation |
| `settings.deleteConfigFile` | mutation |
| `settings.getForgeGraphConnection` | query |
| `settings.connectForgeGraph` | mutation |
| `settings.disconnectForgeGraph` | mutation |

**Cookies (5):**

| Tag | Type |
|-----|------|
| `settings.cookies.import` | mutation |
| `settings.cookies.list` | query |
| `settings.cookies.remove` | mutation |
| `settings.cookies.getForSession` | query |
| `settings.cookies.setSessionScopes` | mutation |

**System (2):**

| Tag | Type |
|-----|------|
| `settings.system.health` | query |
| `settings.system.status` | query |

Total: 20 procedures in `SettingsRpc`.

**Key schemas:** `UserPreferencesSchema`, `ApiKeySchema`, `ConfigRootSchema`, `ConfigEntrySchema`, `CookieSchema`, `SystemStatusSchema`, `ConfigRootIdEnum`.

### Steps

1. Write test asserting `SettingsRpc` has 20 procedures.
2. Run test — FAIL (group doesn't exist).
3. Create schema files and group file.
4. Update barrel with `SettingsRpc` export.
5. Run test — PASS.
6. Verify baseline.
7. Commit: `feat(contracts): add SettingsRpc group (7B-4B Task 9)`

---

## Task 10: Secrets contracts (extend existing)

Extend `SecretsRpc` with 8 Bob-specific procedures from `secrets.ts`.

**Files:**
- Create: `packages/core/src/contracts/schemas/secrets-session.ts`
- Modify: `packages/core/src/contracts/groups/secrets.ts` — add 8 RPCs
- Modify: `packages/core/src/contracts/index.ts`
- Create: `packages/core/src/contracts/__tests__/secrets-session.test.ts`

**Procedures:**

| Tag | Type |
|-----|------|
| `secrets.session.getManifest` | query |
| `secrets.session.getForExecution` | query |
| `secrets.session.create` | mutation |
| `secrets.session.list` | query |
| `secrets.session.delete` | mutation |
| `secrets.session.markUsed` | mutation |
| `secrets.session.upsertDeployBinding` | mutation |
| `secrets.session.promote` | mutation |

After: `SecretsRpc` = 14 procedures (existing 6 + 8 new).

### Steps

1-7: Same pattern. Commit: `feat(contracts): add secrets.session RPCs (7B-4B Task 10)`

---

## Task 11: Auth contracts (extend existing)

Extend `AuthRpc` with 2 Bob procedures from `auth.ts`.

**Files:**
- Modify: `packages/core/src/contracts/groups/auth.ts` — add 2 RPCs
- Modify: `packages/core/src/contracts/index.ts`
- Create: `packages/core/src/contracts/__tests__/auth-bob.test.ts`

**Procedures:**

| Tag | Type | Notes |
|-----|------|-------|
| `auth.getSession` | query | Returns session or null (public) |
| `auth.getSecretMessage` | query | Returns string (protected, demo) |

After: `AuthRpc` = 11 procedures (existing 9 + 2 new).

### Steps

1-7: Same pattern. Commit: `feat(contracts): add Bob auth RPCs (7B-4B Task 11)`

---

## Task 12: Final verification + barrel cleanup

Verify all contract counts, clean up barrel exports, run full test suite.

**Expected totals:**
- `AgentRpc`: 78 procedures (5 existing + 73 new)
- `ProjectsRpc`: 56 procedures (4 existing + 52 new)
- `SettingsRpc`: 20 procedures (new group)
- `SecretsRpc`: 14 procedures (6 existing + 8 new)
- `AuthRpc`: 11 procedures (9 existing + 2 new)
- **Platform total: 179 procedures**

**Files:**
- Create: `packages/core/src/contracts/__tests__/all-groups.test.ts` — comprehensive group count test
- Modify: `packages/core/src/contracts/index.ts` — ensure all exports are clean

### Steps

1. Write comprehensive test asserting all 5 group sizes.
2. Run test — expect PASS.
3. Run `pnpm --filter @gmacko/core test -- --no-file-parallelism` — expect all pass.
4. Run `pnpm --filter @bob/api test -- --no-file-parallelism` — expect 370 passed | 1 skipped.
5. Commit: `test(contracts): verify all platform contract groups (7B-4B Task 12)`

---

## Reference: Existing contract file structure

```
packages/core/src/contracts/
├── index.ts                    # barrel
├── errors.ts                   # ThreadNotFoundError, etc.
├── rpc.ts                      # GmackoRpcGroup (legacy)
├── groups/
│   ├── agent.ts               # AgentRpc (5 → 78)
│   ├── auth.ts                # AuthRpc (9 → 11)
│   ├── projects.ts            # ProjectsRpc (4 → 56)
│   ├── secrets.ts             # SecretsRpc (6 → 14)
│   └── settings.ts            # SettingsRpc (new, 20)
├── schemas/
│   ├── agent.ts               # existing agent schemas
│   ├── agent-run.ts           # NEW
│   ├── agent-capture.ts       # NEW
│   ├── agent-session.ts       # NEW
│   ├── agent-instance.ts      # NEW
│   ├── agent-terminal.ts      # NEW
│   ├── agent-event.ts         # NEW
│   ├── agent-filesystem.ts    # NEW
│   ├── agent-chat.ts          # NEW
│   ├── auth.ts                # existing auth schemas
│   ├── projects.ts            # existing project schemas
│   ├── project-workspace.ts   # NEW
│   ├── project-repository.ts  # NEW
│   ├── project-pull-request.ts # NEW
│   ├── project-feature-branch.ts # NEW
│   ├── project-git-provider.ts # NEW
│   ├── project-git.ts         # NEW
│   ├── secrets.ts             # existing secrets schemas
│   ├── secrets-session.ts     # NEW
│   ├── settings-general.ts    # NEW
│   ├── settings-cookies.ts    # NEW
│   └── settings-system.ts     # NEW
└── stubs/
    ├── auth.ts                # existing stubs
    ├── projects.ts
    └── secrets.ts
```
