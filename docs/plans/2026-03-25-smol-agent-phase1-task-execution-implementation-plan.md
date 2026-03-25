# Smol-Agent Phase 1 Task Execution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `smol-agent` available as a first-class Bob task-execution runtime for task workspaces while keeping Bob authoritative for task runs, sessions, worktrees, PRs, and workflow status.

**Architecture:** Keep Bob’s existing `taskRun.execute -> @bob/execution/runtime/taskExecutor -> gateway session start` path intact, but add a new `smol-agent` runtime option that uses `smol-agent --acp` behind a gateway ACP bridge adapter. Bob continues to own task-run/session persistence and PR/task workflow state; `smol-agent` only replaces the agent subprocess and message protocol beneath that layer.

**Tech Stack:** TypeScript, Vitest, Next.js/tRPC, Bob execution runtime, Bob gateway stdio adapters, `smol-agent` ACP server

## Preconditions

- Work in the `bob` repository root.
- Ensure `../smol-agent` exists and `npm install` has already been run there.
- Keep Phase 1 scoped to task execution. Do not implement shaping, planning, review, or release profiles in this batch.
- Preserve the existing `claude`, `codex`, and `opencode` task execution paths.

## Task 1: Add failing tests for `smol-agent` agent-type availability

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `apps/web/src/pages/api/system-status.ts`
- Modify: `packages/api/src/services/dispatch/agentHeuristics.ts`
- Create: `packages/api/src/services/dispatch/__tests__/agentHeuristics.smol-agent.test.ts`

**Step 1: Write the failing test**

Create `packages/api/src/services/dispatch/__tests__/agentHeuristics.smol-agent.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { suggestAgent } from "../agentHeuristics";

describe("smol-agent heuristics", () => {
  it("can recommend smol-agent for implementation-oriented task execution", () => {
    expect(
      suggestAgent({
        kind: "task",
        title: "Implement ACP bridge for smol-agent runtime",
        description:
          "Build the gateway adapter and task execution wiring for smol-agent",
      }),
    ).toBe("smol-agent");
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest packages/api/src/services/dispatch/__tests__/agentHeuristics.smol-agent.test.ts
```

Expected:

- FAIL because `smol-agent` is not currently returned by the heuristics and may not yet exist in the shared agent-type definitions

**Step 3: Write minimal implementation**

Update:

- `packages/db/src/schema.ts` to include `"smol-agent"` in `agentTypeEnum`
- `apps/web/src/pages/api/system-status.ts` to include `"smol-agent"` in the status API response
- `packages/api/src/services/dispatch/agentHeuristics.ts` to allow `smol-agent` as the default implementation runtime instead of hard-coding `opencode`

Minimal heuristic direction:

```ts
if (draft.kind === "epic") return "claude";
if (looksTestHeavy(draft)) return "codex";
return "smol-agent";
```

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest packages/api/src/services/dispatch/__tests__/agentHeuristics.smol-agent.test.ts
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add packages/db/src/schema.ts apps/web/src/pages/api/system-status.ts packages/api/src/services/dispatch/agentHeuristics.ts packages/api/src/services/dispatch/__tests__/agentHeuristics.smol-agent.test.ts
git commit -m "feat: add smol-agent as a Bob runtime option"
```

## Task 2: Add failing tests for a gateway ACP adapter for `smol-agent`

**Files:**
- Create: `apps/gateway/src/agents/adapters/smol-agent-acp.ts`
- Create: `apps/gateway/src/agents/adapters/__tests__/smol-agent-acp.test.ts`
- Modify: `apps/gateway/src/agents/adapters/base-stdio-adapter.ts`

**Step 1: Write the failing tests**

Create `apps/gateway/src/agents/adapters/__tests__/smol-agent-acp.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createSmolAgentAcpAdapter } from "../smol-agent-acp";
import { getStdioAdapter } from "../base-stdio-adapter";

describe("smol-agent ACP adapter", () => {
  it("registers a gateway adapter for smol-agent", () => {
    const adapter = getStdioAdapter("smol-agent", "/tmp/project");
    expect(adapter).not.toBeNull();
    expect(adapter?.command).toContain("smol-agent");
  });

  it("formats ACP initialize and prompt requests as JSON-RPC lines", () => {
    const adapter = createSmolAgentAcpAdapter("/tmp/project");
    const line = adapter.formatInput("Implement the task");

    expect(line).toContain("\"jsonrpc\":\"2.0\"");
    expect(line).toContain("\"method\":\"prompt\"");
    expect(line).toContain("Implement the task");
  });

  it("parses ACP agent message chunks into gateway output events", () => {
    const adapter = createSmolAgentAcpAdapter("/tmp/project");

    const event = adapter.parseLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello from smol-agent" },
          },
        },
      }),
    );

    expect(event).toEqual({
      type: "output",
      data: { text: "hello from smol-agent" },
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest apps/gateway/src/agents/adapters/__tests__/smol-agent-acp.test.ts
```

Expected:

- FAIL because the adapter does not exist and `getStdioAdapter("smol-agent", ...)` returns `null`

**Step 3: Write minimal implementation**

Create `apps/gateway/src/agents/adapters/smol-agent-acp.ts` that:

- launches `smol-agent`
- passes `--acp`
- passes `--directory <workingDirectory>`
- translates gateway input messages into ACP `prompt` requests
- parses `session/update` notifications from the ACP server into gateway `output`, `status`, and `error` events

Initial adapter shape:

```ts
import type { ParsedEvent, StdioAdapter } from "./base-stdio-adapter.js";

let nextId = 1;

export function createSmolAgentAcpAdapter(
  workingDirectory: string,
): StdioAdapter {
  return {
    command: "smol-agent",
    args: ["--acp", "--directory", workingDirectory],
    env: {
      SMOL_AGENT_NO_BROWSER: "1",
    },
    parseLine(line: string): ParsedEvent | null {
      const trimmed = line.trim();
      if (!trimmed) return null;
      const msg = JSON.parse(trimmed) as Record<string, unknown>;

      if (msg.method === "session/update") {
        const params = (msg.params as Record<string, unknown>) ?? {};
        const update = (params.update as Record<string, unknown>) ?? {};

        if (update.sessionUpdate === "agent_message_chunk") {
          const content = update.content as Record<string, unknown>;
          return {
            type: "output",
            data: { text: (content?.text as string) ?? "" },
          };
        }
      }

      return null;
    },
    formatInput(message: string): string {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: nextId++,
        method: "prompt",
        params: {
          sessionId: "bob-session",
          prompt: [{ type: "text", text: message }],
        },
      }) + "\n";
    },
  };
}
```

Then register it in `apps/gateway/src/agents/adapters/base-stdio-adapter.ts`:

```ts
case "smol-agent":
  return createSmolAgentAcpAdapter(workingDirectory);
```

Note:

- Do not overbuild a full ACP client in one step.
- The first version may keep a simple one-session-per-process assumption and later add explicit `initialize` and `session/new` handshake state if the runtime requires it.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest apps/gateway/src/agents/adapters/__tests__/smol-agent-acp.test.ts
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add apps/gateway/src/agents/adapters/smol-agent-acp.ts apps/gateway/src/agents/adapters/__tests__/smol-agent-acp.test.ts apps/gateway/src/agents/adapters/base-stdio-adapter.ts
git commit -m "feat: add smol-agent ACP gateway adapter"
```

## Task 3: Add failing tests for Bob-owned runtime launch profiles

**Files:**
- Create: `apps/execution/src/runtime/smolAgentProfile.ts`
- Create: `apps/execution/src/runtime/smolAgentProfile.test.ts`
- Modify: `apps/execution/src/runtime/index.ts`

**Step 1: Write the failing tests**

Create `apps/execution/src/runtime/smolAgentProfile.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildSmolAgentTaskExecutionProfile } from "./smolAgentProfile";

describe("smol-agent task execution profile", () => {
  it("builds a Bob-owned execution prompt for a task run", () => {
    const profile = buildSmolAgentTaskExecutionProfile({
      sessionId: "session-1",
      taskRunId: "task-run-1",
      workItemId: "work-item-1",
      workItemIdentifier: "ENG-42",
      title: "Add ACP bridge",
      description: "Implement the gateway ACP bridge for smol-agent",
      branch: "bob/eng-42/add-acp-bridge",
      workingDirectory: "/tmp/project",
    });

    expect(profile.agentType).toBe("smol-agent");
    expect(profile.initialPrompt).toContain("ENG-42");
    expect(profile.initialPrompt).toContain("update_status");
    expect(profile.initialPrompt).toContain("create_pr");
    expect(profile.env.BOB_SESSION_ID).toBe("session-1");
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest apps/execution/src/runtime/smolAgentProfile.test.ts
```

Expected:

- FAIL because the profile builder does not exist

**Step 3: Write minimal implementation**

Create `apps/execution/src/runtime/smolAgentProfile.ts`:

```ts
export interface SmolAgentTaskExecutionProfileInput {
  sessionId: string;
  taskRunId: string;
  workItemId: string;
  workItemIdentifier: string;
  title: string;
  description: string | null;
  branch: string;
  workingDirectory: string;
}

export function buildSmolAgentTaskExecutionProfile(
  input: SmolAgentTaskExecutionProfileInput,
) {
  const initialPrompt = [
    "You are working in a Bob-managed task execution session.",
    `Task: ${input.workItemIdentifier} - ${input.title}`,
    `Branch: ${input.branch}`,
    "",
    "Use Bob workflow tools while you work:",
    "- update_status",
    "- request_input",
    "- mark_blocked",
    "- create_pr",
    "- submit_for_review",
    "- complete_task",
  ].join("\n");

  return {
    agentType: "smol-agent" as const,
    initialPrompt,
    env: {
      BOB_SESSION_ID: input.sessionId,
      BOB_TASK_RUN_ID: input.taskRunId,
      BOB_WORK_ITEM_ID: input.workItemId,
      BOB_WORK_ITEM_IDENTIFIER: input.workItemIdentifier,
      BOB_WORKTREE_PATH: input.workingDirectory,
    },
  };
}
```

Export it from `apps/execution/src/runtime/index.ts`.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest apps/execution/src/runtime/smolAgentProfile.test.ts
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add apps/execution/src/runtime/smolAgentProfile.ts apps/execution/src/runtime/smolAgentProfile.test.ts apps/execution/src/runtime/index.ts
git commit -m "feat: add smol-agent task execution profile"
```

## Task 4: Add failing tests for `taskExecutor` wiring of the `smol-agent` runtime

**Files:**
- Modify: `apps/execution/src/runtime/taskExecutor.ts`
- Modify: `apps/execution/src/runtime/taskExecutor.test.ts`

**Step 1: Write the failing test**

Extend `apps/execution/src/runtime/taskExecutor.test.ts` with:

```ts
it("uses the smol-agent profile when agentType is smol-agent", async () => {
  const source = readFileSync(
    path.resolve(__dirname, "./taskExecutor.ts"),
    "utf8",
  );

  expect(source).toContain("buildSmolAgentTaskExecutionProfile");
  expect(source).toContain('options?.agentType ?? "opencode"');
  expect(source).toContain('if ((options?.agentType ?? "opencode") === "smol-agent")');
});
```

If you prefer a behavioral test, mock the profile builder and assert that `gatewayRequest` receives `agentType: "smol-agent"` and the profile-generated prompt.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest apps/execution/src/runtime/taskExecutor.test.ts
```

Expected:

- FAIL because `taskExecutor.ts` does not yet reference the profile builder

**Step 3: Write minimal implementation**

Update `apps/execution/src/runtime/taskExecutor.ts` so that when `options?.agentType === "smol-agent"` it:

- builds a Bob-owned task execution profile
- uses the profile’s `initialPrompt`
- passes `agentType: "smol-agent"` to the gateway session start path
- attaches the profile environment values to the launched session metadata or launch request

Minimal direction inside `executeTask`:

```ts
const selectedAgent = options?.agentType ?? "opencode";
const smolProfile =
  selectedAgent === "smol-agent"
    ? buildSmolAgentTaskExecutionProfile({
        sessionId,
        taskRunId,
        workItemId: task.id,
        workItemIdentifier: task.identifier,
        title: task.title,
        description: task.description,
        branch,
        workingDirectory: worktreePath,
      })
    : null;
```

Use `smolProfile?.initialPrompt ?? existingPrompt`.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest apps/execution/src/runtime/taskExecutor.test.ts
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add apps/execution/src/runtime/taskExecutor.ts apps/execution/src/runtime/taskExecutor.test.ts
git commit -m "feat: wire smol-agent into task execution runtime"
```

## Task 5: Add failing tests for Bob MCP tool exposure in `smol-agent` task sessions

**Files:**
- Modify: `packages/mcp-server/src/tools/index.ts`
- Create: `packages/mcp-server/src/tools/__tests__/smol-agent-tool-registry.test.ts`
- Optionally modify: `packages/bob-agent-toolkit/src/oh-my-opencode/bob-workflow-skill.ts`

**Step 1: Write the failing test**

Create `packages/mcp-server/src/tools/__tests__/smol-agent-tool-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createToolRegistry, getToolsList } from "../index";

describe("Bob tool registry for smol-agent task execution", () => {
  it("includes workflow, task, and PR tools required by the smol-agent execution profile", () => {
    const tools = getToolsList(createToolRegistry()).map((tool) => tool.name);

    expect(tools).toContain("update_status");
    expect(tools).toContain("request_input");
    expect(tools).toContain("mark_blocked");
    expect(tools).toContain("create_pr");
    expect(tools).toContain("submit_for_review");
    expect(tools).toContain("complete_task");
  });
});
```

**Step 2: Run test to verify it fails if needed**

Run:

```bash
pnpm vitest packages/mcp-server/src/tools/__tests__/smol-agent-tool-registry.test.ts
```

Expected:

- PASS if all required tools already exist
- If it already passes, treat this as a locking test and continue without code changes

**Step 3: Write minimal implementation**

If the test fails, add the missing tool exports to `packages/mcp-server/src/tools/index.ts`.

If the test already passes, add a small comment near the `allTools` list clarifying that these tools are the minimum Phase 1 Bob runtime surface for `smol-agent` task execution.

Example:

```ts
// Phase 1 smol-agent task execution depends on workflow, task, and PR tools.
```

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest packages/mcp-server/src/tools/__tests__/smol-agent-tool-registry.test.ts
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add packages/mcp-server/src/tools/index.ts packages/mcp-server/src/tools/__tests__/smol-agent-tool-registry.test.ts
git commit -m "test: lock Bob MCP tool surface for smol-agent execution"
```

## Task 6: Add failing integration tests for gateway process-manager support

**Files:**
- Modify: `apps/gateway/src/agents/__tests__/agent-process-manager.test.ts`
- Modify: `apps/gateway/src/agents/agent-process-manager.ts`

**Step 1: Write the failing test**

Extend `apps/gateway/src/agents/__tests__/agent-process-manager.test.ts` with a case that verifies `startSession` works when `agentType` is `"smol-agent"` and the adapter returns a writable stdio process.

Example:

```ts
it("can start a smol-agent session via stdio adapter", async () => {
  const actor = createMockActor();

  await manager.startSession({
    sessionId: "session-smol-1",
    agentType: "smol-agent",
    workingDirectory: "/tmp/project",
    initialPrompt: "Implement the task",
    actor,
  });

  expect(actor.setStatus).toHaveBeenCalledWith("running");
});
```

If the current test harness only recognizes `"mock"`, extend the adapter mock so `"smol-agent"` maps to the same fake process adapter.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest apps/gateway/src/agents/__tests__/agent-process-manager.test.ts
```

Expected:

- FAIL because the mock adapter map and/or manager assumptions do not yet include `smol-agent`

**Step 3: Write minimal implementation**

Update the test mocks and, if necessary, `apps/gateway/src/agents/agent-process-manager.ts` so `smol-agent` uses the generic stdio session path and is not treated as a Claude-specific per-message spawn case.

Important:

- Do not add `smol-agent` to the PTY-only path
- Do not special-case it like Claude’s `--resume` mode
- Keep it in the ordinary managed stdio session flow

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest apps/gateway/src/agents/__tests__/agent-process-manager.test.ts
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add apps/gateway/src/agents/__tests__/agent-process-manager.test.ts apps/gateway/src/agents/agent-process-manager.ts
git commit -m "test: cover smol-agent gateway session management"
```

## Task 7: Verify the end-to-end Phase 1 task execution path

**Files:**
- Test: `apps/execution/src/runtime/taskExecutor.test.ts`
- Test: `apps/gateway/src/agents/adapters/__tests__/smol-agent-acp.test.ts`
- Test: `apps/gateway/src/agents/__tests__/agent-process-manager.test.ts`
- Test: `packages/api/src/services/dispatch/__tests__/agentHeuristics.smol-agent.test.ts`
- Test: `packages/mcp-server/src/tools/__tests__/smol-agent-tool-registry.test.ts`

**Step 1: Run the focused test suite**

Run:

```bash
pnpm vitest apps/execution/src/runtime/taskExecutor.test.ts apps/execution/src/runtime/smolAgentProfile.test.ts apps/gateway/src/agents/adapters/__tests__/smol-agent-acp.test.ts apps/gateway/src/agents/__tests__/agent-process-manager.test.ts packages/api/src/services/dispatch/__tests__/agentHeuristics.smol-agent.test.ts packages/mcp-server/src/tools/__tests__/smol-agent-tool-registry.test.ts
```

Expected:

- PASS

**Step 2: Run one API-level regression test for task execution**

Run:

```bash
pnpm vitest packages/api/src/router/__tests__/session.linked-task.test.ts
```

Expected:

- PASS

**Step 3: Manually smoke-test the gateway launch path**

Run:

```bash
pnpm vitest apps/execution/src/runtime/planningControl.test.ts
```

Expected:

- PASS

Then manually verify:

1. Start the gateway locally
2. Launch a task from the work-item UI with `agentType: "smol-agent"`
3. Confirm a task run and chat session are created
4. Confirm the gateway launches `smol-agent`
5. Confirm session events appear in the Bob task workspace

**Step 4: Commit**

```bash
git add .
git commit -m "feat: add phase 1 smol-agent task execution runtime"
```

## Notes For The Implementer

- Keep Phase 1 deliberately narrow. Do not add shaping, planning, review, or release flows here.
- Prefer the ACP path over inventing a second custom `smol-agent` protocol.
- If ACP requires an explicit `initialize` and `session/new` handshake before `prompt`, add that to the adapter rather than bypassing ACP.
- Do not move Bob lifecycle state into `.smol-agent/state`.
- Treat local `smol-agent` persistence as cache or recovery only.
- Preserve all existing Bob task-run/session/PR/trpc semantics.

## Follow-Up After Phase 1

Once this plan lands, the next implementation plan should cover:

- planning and shaping run profiles
- Bob-owned artifact capture for BRDs and requirement extraction
- reviewer and release-manager profiles
- optional visibility for internal `smol-agent` delegation and sub-run import
