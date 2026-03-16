# JJ Integration + Tests + T3 Code — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement the remaining tasks in controlled batches.

**Goal:** Add JJ/Jujutsu VCS support (auto-detected, gateway-managed), comprehensive test coverage for the new planning/dispatch/pipeline infrastructure, and T3 Code protocol compatibility.

**Architecture:**
- **JJ:** Gateway auto-detects `.jj/` in repos. A new `VcsAdapter` abstraction handles git vs jj commands. Gateway creates JJ changes before dispatching agents, pushes after completion. `revId` in ForgeGraph = JJ change ID when available, commit SHA otherwise.
- **Tests:** Integration tests for planSession router, dispatch router, pipeline orchestrator, event reporter. Unit tests for VCS adapter.
- **T3 Code:** Validate stdio bridge with mock agent process. Map Bob's SessionEvent to T3 Code's domain event schema.

---

## Batch 1: VCS Adapter Abstraction

### Task 1.1: Create VcsAdapter interface + git/jj implementations

**Files:**
- Create: `apps/gateway/src/vcs/vcs-adapter.ts` — Interface
- Create: `apps/gateway/src/vcs/git-adapter.ts` — Git implementation
- Create: `apps/gateway/src/vcs/jj-adapter.ts` — JJ implementation

The interface:
```typescript
export interface VcsAdapter {
  type: "git" | "jj";

  /** Create a new working change for a task (branch in git, change in jj) */
  createChange(opts: {
    repoPath: string;
    baseBranch: string;
    name: string; // branch name or bookmark name
  }): Promise<{ changeId: string }>; // commit SHA or jj change ID

  /** Get the current revision ID (HEAD SHA or jj change ID) */
  getCurrentRevId(repoPath: string): Promise<string>;

  /** Push the change to remote */
  push(opts: {
    repoPath: string;
    name: string;
  }): Promise<void>;

  /** Get status (clean/dirty/conflicted) */
  status(repoPath: string): Promise<{ clean: boolean; conflicted: boolean }>;

  /** Describe/commit the current state */
  describe(opts: {
    repoPath: string;
    message: string;
  }): Promise<{ revId: string }>;
}

/** Auto-detect VCS type for a repo path */
export function detectVcs(repoPath: string): "git" | "jj";
```

**Git implementation** — wraps existing `child_process.execSync` git commands:
- `createChange`: `git checkout -b {name} {baseBranch}`
- `getCurrentRevId`: `git rev-parse HEAD`
- `push`: `git push -u origin {name}`
- `status`: `git status --porcelain`
- `describe`: `git add -A && git commit -m "{message}"`

**JJ implementation** — uses jj CLI in colocated mode:
- `createChange`: `jj new main` + `jj bookmark create {name} -r @` → returns change ID from `jj log -r @ -T change_id --no-graph`
- `getCurrentRevId`: `jj log -r @ -T change_id --no-graph`
- `push`: `jj git push --bookmark {name} --allow-new`
- `status`: `jj st` (parse for conflicts)
- `describe`: `jj describe -m "{message}"` → get new revId

**detectVcs**: Check if `path/.jj` directory exists. If yes → "jj". Otherwise → "git".

### Task 1.2: Integrate VcsAdapter into gateway

**Files:**
- Modify: `apps/gateway/src/index.ts`

Replace direct git commands in the gateway with VcsAdapter calls. Find where `/git/checkout` is handled and replace with:
```typescript
const vcs = detectVcs(repoPath) === "jj" ? new JjAdapter() : new GitAdapter();
const { changeId } = await vcs.createChange({ repoPath, baseBranch, name: branch });
```

Also update `executeTask` in `taskExecutor.ts` — when creating a branch, use the VcsAdapter and store the `changeId` as `forgegraphRevisionId` on the taskRun.

### Task 1.3: Store change ID as ForgeGraph revId

**Files:**
- Modify: `apps/execution/src/runtime/taskExecutor.ts`
- Modify: `packages/api/src/services/forgegraph/eventReporter.ts`

In `executeTask`, after creating the branch/change:
- Get the revId via VcsAdapter.getCurrentRevId()
- Store it on the taskRun as `forgegraphRevisionId`
- The eventReporter already uses this field

### Verification (Batch 1)
```bash
pnpm --filter @bob/gateway typecheck
pnpm --filter @bob/execution typecheck
```

---

## Batch 2: Comprehensive Test Coverage

### Task 2.1: PlanSession router integration tests

**Files:**
- Create: `packages/api/src/router/__tests__/planSession.integration.test.ts`

Tests:
- Create planning session → verify chatConversation has sessionType "planning"
- Create draft → verify draft appears in get()
- Update draft → verify changes persist
- Remove draft → verify it's gone
- Set dependency → verify dependency in get()
- Commit plan → verify drafts marked "committed" (mock the planning API fetch)

### Task 2.2: Dispatch router integration tests

**Files:**
- Create: `packages/api/src/router/__tests__/dispatch.integration.test.ts`

Tests:
- Create batch from committed drafts → verify items created with correct agent suggestions
- Blocked items get status "blocked", unblocked get "queued"
- Update agent type → verify change persists
- CheckProgress marks completed items and unblocks dependents
- CheckProgress starts next wave up to concurrency

### Task 2.3: Pipeline orchestrator unit tests

**Files:**
- Create: `packages/api/src/services/forgegraph/__tests__/pipelineOrchestrator.test.ts`

Tests:
- agent_complete → building (creates build)
- building → gates_passed (when build status is "passed")
- building → build_failed (when build status is "failed")
- gates_passed → deploying_dev (creates deployment)
- deploying_dev → dev_healthy (when deployment is "healthy")
- staging_healthy → awaiting_prod_approval (creates notification)
- Terminal states return immediately

### Task 2.4: Event reporter unit tests

**Files:**
- Create: `packages/api/src/services/forgegraph/__tests__/eventReporter.test.ts`

Tests:
- reportCreated creates revision + run event
- reportApproved creates run event with type "approved"
- reportFailed creates run event with type "failed"
- Graceful degradation when repositoryId is null

### Task 2.5: VCS adapter unit tests

**Files:**
- Create: `apps/gateway/src/vcs/__tests__/vcs-adapter.test.ts`

Tests:
- detectVcs returns "jj" when .jj exists
- detectVcs returns "git" when only .git exists
- GitAdapter.createChange runs correct git commands
- JjAdapter.createChange runs correct jj commands
- JjAdapter.getCurrentRevId parses change ID

### Verification (Batch 2)
```bash
pnpm --filter @bob/api test
pnpm --filter @bob/gateway test (if test script exists)
```

---

## Batch 3: T3 Code Protocol Compatibility

### Task 3.1: Validate stdio bridge with mock agent

**Files:**
- Create: `apps/gateway/src/agents/__tests__/agent-process-manager.test.ts`
- Create: `apps/gateway/src/agents/__tests__/mock-agent.ts` — A tiny Node script that speaks JSON-RPC over stdio

The mock agent:
```typescript
// Reads JSON-RPC from stdin, writes events to stdout
process.stdin.on('data', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.method === 'session.start') {
    // Emit some output events
    console.log(JSON.stringify({ method: 'events.output', params: { type: 'text', content: 'Hello from mock agent' } }));
    console.log(JSON.stringify({ method: 'events.toolCall', params: { name: 'read_file', args: { path: 'README.md' } } }));
  }
});
```

Tests:
- AgentProcessManager spawns mock agent
- Output events are received and parsed correctly
- Input messages are sent to agent stdin
- Process cleanup on stopSession

### Task 3.2: Map Bob SessionEvent to T3 Code domain events

**Files:**
- Create: `apps/gateway/src/agents/t3code-event-map.ts`

T3 Code uses an `orchestration.domainEvent` schema defined in their `packages/contracts`. Map Bob's event types:

| Bob SessionEvent | T3 Code Domain Event |
|-----------------|---------------------|
| output_chunk (direction: agent) | conversation.textDelta |
| tool_call | conversation.toolCall |
| tool_result | conversation.toolResult |
| state (status: running) | session.running |
| state (status: stopped) | session.stopped |
| input (direction: client) | conversation.userMessage |

Create bidirectional mapping functions:
```typescript
export function bobEventToT3(event: SessionEvent): T3DomainEvent | null
export function t3EventToBob(event: T3DomainEvent): SessionEvent | null
```

This is a translation layer — when T3 Code exposes an API, we can plug these in.

### Task 3.3: Install and reference T3 Code contracts

Check if `@t3code/contracts` is published on npm. If not, create local type definitions based on the T3 Code repo's `packages/contracts` schemas. Define the minimum set of types needed for the event mapping.

### Verification (Batch 3)
```bash
pnpm --filter @bob/gateway test (or typecheck)
```
