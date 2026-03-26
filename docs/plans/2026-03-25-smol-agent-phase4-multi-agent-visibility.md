# Phase 4: Hybrid Multi-Agent Visibility

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make smol-agent's internal delegation visible as Bob lifecycle events and optional child taskRuns, wire the lifecycle timeline into the work item detail page, and emit lifecycle events from all existing flows.

**Architecture:** Give the gateway direct DB access to write lifecycle events when delegation tool calls are detected. Use regex heuristics on tool_call_update results to detect artifact-producing delegations and promote them to child taskRuns. Wire the existing LifecycleTimeline component into the work item detail page.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Vitest, Next.js/tRPC, smol-agent ACP

## Task 0: Verify gateway can import @bob/db/client

**Step 1:** Test the import

```bash
cd apps/gateway && npx tsx -e "import { db } from '@bob/db/client'; console.log('DB import OK')"
```

If this fails with module resolution errors, fix the gateway's tsconfig or package.json before proceeding.

**Step 2:** Commit any fixes needed.

## Task 1: Gateway writes delegation lifecycle events to DB

**Files:**
- Modify: `apps/gateway/src/agents/agent-process-manager.ts`
- Modify: `apps/gateway/package.json` (if @bob/db not already a dependency)

**Step 1:** Add DB import and write lifecycle event in the delegation detection block. Replace the existing `console.log` + `actor.handleAgentOutput` with a DB write:

```ts
import { db } from "@bob/db/client";
import { runLifecycleEvents } from "@bob/db/schema";

// In the isDelegation block:
void db.insert(runLifecycleEvents).values({
  taskRunId: managed.agentType === "smol-agent" ? (sessionId) : sessionId,
  eventType: "delegation_started",
  phase: "execute",
  metadata: { toolName, arguments: event.data.arguments },
}).catch((err) => console.warn("[AgentProcessManager] Failed to write delegation event:", err));
```

**Step 2:** Build and verify gateway starts: `cd apps/gateway && npx tsx src/index.ts` (Ctrl+C after startup confirms no import errors).

**Step 3:** Commit.

## Task 2: Capture delegation results and pair events

**Files:**
- Modify: `apps/gateway/src/agents/agent-process-manager.ts`

**Step 1:** In the `tool_result` case of `handleLine`, detect when a delegation tool call completes and write a `delegation_completed` event with the result summary.

Track active delegations in a Map on the ManagedSession:
```ts
interface ManagedSession {
  // ... existing fields
  activeDelegations?: Map<string, { toolName: string; startedAt: number }>;
}
```

**Step 2:** Commit.

## Task 3: Sub-run promotion for artifact-producing delegations

**Files:**
- Modify: `apps/gateway/src/agents/agent-process-manager.ts`

**Step 1:** When a delegation_completed event's result matches artifact heuristics (regex for file paths, PR numbers, commit SHAs), create a child taskRun:

```ts
const ARTIFACT_PATTERNS = [
  /\/home\/|\/tmp\/|\/Volumes\//,  // absolute file paths
  /file:\/\//,                      // file URLs
  /#\d+/,                           // PR numbers
  /[0-9a-f]{7,40}/,                 // commit SHAs
];

function looksLikeArtifact(result: string): boolean {
  return ARTIFACT_PATTERNS.some((p) => p.test(result));
}
```

If artifact detected, insert a child taskRun with `parentTaskRunId` and `runPhase` from the parent. Fire-and-forget with `.catch()`.

**Step 2:** Commit.

## Task 4: Emit lifecycle events from existing flows

**Files:**
- Modify: `apps/execution/src/planning/startPlanningSession.ts`
- Modify: `apps/execution/src/runtime/taskExecutor.ts`
- Modify: `packages/api/src/router/dispatch.ts`

**Step 1:** In `startPlanningSession`, after the session starts, write a `run_started` lifecycle event with the session's phase (shape or plan).

**Step 2:** In `executeTask`, after the task run is created, write a `run_started` lifecycle event with phase "execute".

**Step 3:** In `dispatch.ts` where `triggerCodeReview` is called, write a `review_requested` lifecycle event.

All writes are fire-and-forget using the existing `runLifecycleEvents` table.

**Step 4:** Commit.

## Task 5: Wire LifecycleTimeline into work item detail page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/work-items/[workItemId]/workflow-page-client.tsx` (or the appropriate work item detail page component)

**Step 1:** Import LifecycleTimeline component and add it as a collapsible section below the main workspace area. Only show when the work item has lifecycle events.

**Step 2:** Commit.

## Task 6: Enhance timeline for delegation events

**Files:**
- Modify: `apps/web/src/components/work-items/lifecycle-timeline.tsx`

**Step 1:** Add delegation-specific rendering:
- `delegation_started` / `delegation_completed` events show indented with a different left-border color
- Show delegation tool name as label
- Pair start/end events and show duration
- If a child taskRun was created (sub-run promotion), show a link to it

**Step 2:** Commit.

## Task 7: Tests and verification

**Step 1:** Run all existing tests for regression.
**Step 2:** Type-check all packages.
**Step 3:** Verify gateway starts with DB import.
