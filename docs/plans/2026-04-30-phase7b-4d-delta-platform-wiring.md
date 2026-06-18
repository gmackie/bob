# Phase 7B-4D-delta: Wire Platform Contracts to Bob's RPC Server

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the 5 platform RpcGroups (AgentRpc 78, ProjectsRpc 56, SettingsRpc 20, SecretsRpc 14, AuthRpc 11 = 179 procedures) to Bob's Effect-RPC server, using existing handler factories from beta + stubs for gmacko-only contracts.

**Architecture:** Same aggregate-layer pattern as gamma. Each platform RpcGroup gets a layer file in `packages/bob/src/api/src/rpc-layers/` that maps handler factory outputs to contract names. ~22 gmacko-only contracts get lightweight stubs.

**Tech Stack:** Effect 4.0.0-beta.43, Effect-RPC, TypeScript

---

## Stub Strategy

22 procedures have no Bob handler (they're gmacko reference-stack operations). These get inline stubs returning `Effect.fail(BobNotFoundError)` or `Effect.succeed(null)` as appropriate, with the entity name in the error. These stubs are intentional — Bob doesn't implement these features yet.

---

### Task 1: AgentRpc aggregate layer (78 procedures)

**Files:**
- Create: `packages/bob/src/api/src/rpc-layers/agent.ts`

**Source factories → contract mapping:**

5 gmacko-only stubs:
- `agent.createSession`, `agent.sendTurn`, `agent.cancelSession`, `agent.closeSession`, `agent.getTranscript`

73 from Bob factories:
- `agentRun` factory (3): `agentRun.*` → `agent.run.*`
- `capture` factory (2): `capture.*` → `agent.capture.*`
- `session` factory (28): `session.*` → `agent.session.*`
- `instance` factory (9): `instance.*` → `agent.instance.*`
- `terminal` factory (5): `terminal.*` → `agent.terminal.*`
- `event` factory (5): `event.*` → `agent.event.*`
- `filesystem` factory (9): `filesystem.*` → `agent.filesystem.*`
- `chat` factory (8): `chat.*` → `agent.chat.*`
- `post` factory (4): `post.*` → `agent.post.*`

**Steps:**
1. Read all 9 handler factory files + contract group to verify exact key names
2. Create aggregate layer with `liftHandlers`-compatible mapping
3. Run tests: `cd packages/bob/src/api && pnpm exec vitest run --no-file-parallelism`
4. Commit: `feat(bob/api): AgentRpc aggregate layer — 78 contract handlers wired (7B-4D-delta Task 1)`

---

### Task 2: ProjectsRpc aggregate layer (56 procedures)

**Files:**
- Create: `packages/bob/src/api/src/rpc-layers/projects.ts`

**Source factories → contract mapping:**

2 stubs (gmacko-only):
- `projects.getBySlug` — Bob uses `project.get` (by ID), no slug lookup
- `projects.delete` — Bob has no project delete

54 from Bob factories:
- `project` factory (6): `project.*` → `projects.*` (note: singular→plural prefix change)
  - `project.create` → `projects.create`
  - `project.list` → `projects.list`
  - `project.get` → `projects.get`
  - `project.updateAutomationSettings` → `projects.updateAutomationSettings`
  - `project.discovery` → `projects.discovery`
  - `project.dismissDir` → `projects.dismissDir`
- `workspace` factory (4): `workspace.*` → `projects.workspace.*`
- `repository` factory (12): `repository.*` → `projects.repository.*`
- `pullRequest` factory (12): `pullRequest.*` → `projects.pullRequest.*`
- `featureBranch` factory (7): `featureBranch.*` → `projects.featureBranch.*`
- `gitProviders` factory (6): `gitProviders.*` → `projects.gitProvider.*` (note: plural→singular)
- `git` factory (7): `git.*` → `projects.git.*`

**Steps:**
1. Read all 7 factory files + contract group
2. Create aggregate layer
3. Run tests
4. Commit: `feat(bob/api): ProjectsRpc aggregate layer — 56 contract handlers wired (7B-4D-delta Task 2)`

---

### Task 3: SettingsRpc + SecretsRpc + AuthRpc aggregate layers (45 procedures)

**Files:**
- Create: `packages/bob/src/api/src/rpc-layers/settings.ts`
- Create: `packages/bob/src/api/src/rpc-layers/secrets.ts`
- Create: `packages/bob/src/api/src/rpc-layers/auth.ts`

**SettingsRpc (20 — zero stubs):**
- `settings` factory (13): `settings.*` → `settings.*` (direct match)
- `cookies` factory (5): `cookies.*` → `settings.cookies.*`
- `system` factory (2): `system.*` → `settings.system.*`

**SecretsRpc (14 — 6 stubs):**
- 6 gmacko-only stubs: `secrets.create`, `secrets.list`, `secrets.getEnvelope`, `secrets.decryptForUse`, `secrets.markUsed`, `secrets.delete`
- `secrets` factory (8): 
  - `secrets.getSessionSecretManifest` → `secrets.session.getManifest`
  - `secrets.getSessionSecretForExecution` → `secrets.session.getForExecution`
  - `secrets.createSessionSecret` → `secrets.session.create`
  - `secrets.listSessionSecrets` → `secrets.session.list`
  - `secrets.deleteSessionSecret` → `secrets.session.delete`
  - `secrets.markSecretUsed` → `secrets.session.markUsed`
  - `secrets.upsertProjectDeployBinding` → `secrets.session.upsertDeployBinding`
  - `secrets.promoteSessionSecret` → `secrets.session.promote`

**AuthRpc (11 — 9 stubs):**
- 9 gmacko-only stubs: `auth.whoAmI`, `auth.listMemberships`, `auth.resolveTenant`, `auth.issueApiKey`, `auth.listApiKeys`, `auth.revokeApiKey`, `auth.startDeviceFlow`, `auth.pollDeviceCode`, `auth.approveDeviceCode`
- `auth` factory (2): `auth.getSession` → `auth.getSession`, `auth.getSecretMessage` → `auth.getSecretMessage`

**Steps:**
1. Read all factory files + 3 contract groups
2. Create 3 aggregate layer files
3. Run tests
4. Commit: `feat(bob/api): Settings + Secrets + Auth aggregate layers — 45 contract handlers wired (7B-4D-delta Task 3)`

---

### Task 4: Wire 5 platform groups into RPC server

**Files:**
- Modify: `apps/bob/src/server/rpc.ts`

**Current state:** Serves HealthRpc + WorkItemsRpc + PlanningRpc + ExternalRpc (130 procedures).

**Target:** Add AgentRpc + ProjectsRpc + SettingsRpc + SecretsRpc + AuthRpc (179 more = 309 total).

**Steps:**
1. Read current `apps/bob/src/server/rpc.ts`
2. Import the 5 new aggregate layer files
3. Import the 5 platform RpcGroups from `@gmacko/core/contracts`
4. Merge into BobRpcGroup: `.merge(WorkItemsRpc, PlanningRpc, ExternalRpc, AgentRpc, ProjectsRpc, SettingsRpc, SecretsRpc, AuthRpc)`
5. Add handler layers to `Layer.mergeAll(...)`
6. Follow the same `liftHandlers` pattern used for the domain groups
7. Run full test suite
8. Commit: `feat(bob/api): wire all 8 RpcGroups into Effect-RPC server — 309 total procedures (7B-4D-delta Task 4)`

---

### Task 5: Verification tests + final doc

**Files:**
- Modify: `packages/bob/src/api/src/__tests__/rpc-layers.test.ts`

**Steps:**
1. Add tests for the 5 new aggregate layers (construction + handler count verification)
2. Add a total count test: 31+67+31+78+56+20+14+11 = 308 from contracts + 1 health = 309
3. Run full test suite
4. Commit: `test(bob/api): platform aggregate layer verification — 309 total RPC procedures (7B-4D-delta Task 5)`
