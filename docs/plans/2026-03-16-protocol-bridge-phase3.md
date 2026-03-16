# Protocol Bridge + Auto-Completion — Phase 3+4 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement the remaining tasks in controlled batches.

**Goal:** Add JSON-RPC stdio agent communication as an alternative to PTY/Docker, and close the loop from agent completion to PR creation and dependent task unblocking.

**Architecture:** A new `AgentProcessManager` in the gateway spawns agent CLIs as child processes communicating via JSON-RPC over stdio. It sits alongside the existing Docker/PTY path — the gateway picks the communication method based on configuration. For auto-completion, the dispatch router's `checkProgress` is extended to handle PR creation and task status transitions.

**Tech Stack:** Node.js child_process, JSON-RPC message format, existing gateway SessionActor, tRPC.

---

## Batch 1: JSON-RPC Agent Process Manager

### Task 1.1: Create AgentProcessManager

The core of the protocol bridge. Spawns agent CLIs as child processes, sends/receives JSON-RPC messages over stdin/stdout.

**Files:**
- Create: `apps/gateway/src/agents/agent-process-manager.ts`

This module:
1. Exports `AgentProcessManager` class with methods:
   - `startSession(config: { sessionId, agentType, workingDirectory, initialPrompt })` — spawns the agent CLI process
   - `sendInput(sessionId, message)` — sends a JSON-RPC message to the agent's stdin
   - `stopSession(sessionId)` — sends stop signal and kills process
   - `getStatus(sessionId)` — returns process status

2. Process spawning per agent type:
   - `claude`: `claude --json` with stdin/stdout pipes (not PTY)
   - `codex`: `codex app-server` with JSON-RPC over stdio (T3 Code pattern)
   - `opencode`: `opencode serve --stdio` with JSON-RPC

3. JSON-RPC message format:
   ```typescript
   interface JsonRpcMessage {
     jsonrpc: "2.0";
     method?: string;        // For requests/notifications
     id?: string | number;   // For requests (absent for notifications)
     params?: unknown;
     result?: unknown;       // For responses
     error?: { code: number; message: string; data?: unknown };
   }
   ```

4. Output parsing — reads newline-delimited JSON from stdout:
   - `events.output` → calls `actor.handleAgentOutput()`
   - `events.toolCall` → calls `actor.handleToolCall()`
   - `events.toolResult` → calls `actor.handleToolResult()`
   - `events.status` → updates session status
   - Falls back to raw text output for agents that don't speak JSON-RPC

5. Graceful degradation — if an agent doesn't support JSON-RPC stdio, fall back to the existing PTY/Docker path.

### Task 1.2: Create agent stdio adapters

**Files:**
- Create: `apps/gateway/src/agents/adapters/claude-stdio.ts`
- Create: `apps/gateway/src/agents/adapters/codex-stdio.ts`
- Create: `apps/gateway/src/agents/adapters/opencode-stdio.ts`
- Create: `apps/gateway/src/agents/adapters/base-stdio-adapter.ts`

Each adapter defines:
```typescript
export interface StdioAdapterConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  parseOutput(line: string): JsonRpcMessage | null;
  formatInput(message: string): string;
}
```

- **claude-stdio**: `claude --json` — output is JSON lines, input is plaintext via stdin
- **codex-stdio**: `codex app-server` — full JSON-RPC over stdio (matches T3 Code's pattern)
- **opencode-stdio**: `opencode serve --stdio` — JSON-RPC over stdio

The base adapter handles:
- Spawning via `child_process.spawn` with `{ stdio: ['pipe', 'pipe', 'pipe'] }`
- Reading stdout line-by-line
- Parsing each line through the adapter's `parseOutput`
- Forwarding parsed events to the SessionActor

### Task 1.3: Integrate into gateway session start

**Files:**
- Modify: `apps/gateway/src/index.ts`

In `startAgentForSession()`, add a check:
```typescript
const useStdio = process.env.AGENT_STDIO_MODE === "true" ||
                 ["claude", "codex", "opencode"].includes(actor.agentType);

if (useStdio) {
  await agentProcessManager.startSession({
    sessionId: actor.sessionId,
    agentType: actor.agentType,
    workingDirectory: actor.workingDirectory,
    initialPrompt,
    actor,
  });
} else {
  // Existing Docker/PTY path
  const container = await ensureContainer(userId);
  const agentWs = connectToAgentContainer(container, actor.agentType, actor.workingDirectory);
  // ... existing code
}
```

Also wire `ClientInput` messages to `agentProcessManager.sendInput()` when using stdio mode.

### Verification (Batch 1)
```bash
pnpm --filter @bob/gateway typecheck
```

---

## Batch 2: Auto-Completion Lifecycle

### Task 2.1: Extend checkProgress with PR creation

**Files:**
- Modify: `packages/api/src/router/dispatch.ts`

When `checkProgress` finds a completed task:
1. Check if the task run has a branch but no PR
2. If so, call the planning API to create a "review_ready" status update
3. Fetch the git diff summary for the branch (via gateway `/git/diff` endpoint or skip for now)
4. Update the work item status to "in_review" on the planning API

### Task 2.2: Add review_ready status handling

**Files:**
- Modify: `packages/api/src/router/dispatch.ts`

In `checkProgress`, after marking an item as completed:
1. Check if all items in the batch are completed
2. If so, set batch status to "completed"
3. For each completed item, update the planning API task to status "in_review"

### Task 2.3: Dependent task auto-unblocking

This is already implemented in `checkProgress` from Phase 2. Verify it works correctly:
- When a task completes, its dependents should have their `blockedByItems` checked
- If all blockers are completed, the item moves from "blocked" to "queued"
- Next poll cycle starts it if within concurrency limit

**Files:**
- Modify: `packages/api/src/router/dispatch.ts` (if needed)

Add a notification when a task completes:
```typescript
// After marking item as completed
await ctx.db.insert(notifications).values({
  userId: batch.userId,
  title: `Task ${item.planningTaskIdentifier} completed`,
  body: `Agent ${item.agentType} finished work on "${item.title}"`,
  type: "task_completed",
  url: `/work-items/${item.planningTaskId}`,
});
```

### Task 2.4: Batch completion notification

**Files:**
- Modify: `packages/api/src/router/dispatch.ts`

When the entire batch completes:
```typescript
await ctx.db.insert(notifications).values({
  userId: batch.userId,
  title: `Dispatch batch complete`,
  body: `${batch.completedTasks}/${batch.totalTasks} tasks finished`,
  type: "batch_completed",
});
```

### Verification (Batch 2)
```bash
pnpm --filter @bob/api typecheck
pnpm --filter @bob/web typecheck
pnpm --filter @bob/web test
```

---

## Key Files Reference

### New files
| File | Batch | Purpose |
|------|-------|---------|
| `apps/gateway/src/agents/agent-process-manager.ts` | 1 | JSON-RPC stdio process manager |
| `apps/gateway/src/agents/adapters/base-stdio-adapter.ts` | 1 | Base adapter for stdio agents |
| `apps/gateway/src/agents/adapters/claude-stdio.ts` | 1 | Claude Code stdio adapter |
| `apps/gateway/src/agents/adapters/codex-stdio.ts` | 1 | Codex stdio adapter |
| `apps/gateway/src/agents/adapters/opencode-stdio.ts` | 1 | OpenCode stdio adapter |

### Modified files
| File | Batch | Change |
|------|-------|--------|
| `apps/gateway/src/index.ts` | 1 | Add stdio mode branching in startAgentForSession |
| `packages/api/src/router/dispatch.ts` | 2 | Add PR creation, status updates, notifications on completion |
