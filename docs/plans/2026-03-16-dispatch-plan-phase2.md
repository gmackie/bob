# Dispatch Plan + Agent Selection — Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement the remaining tasks in controlled batches.

**Goal:** After committing a plan, users see a dispatch table with agent assignments, edit them, and kick off batch execution with dependency-aware scheduling.

**Architecture:** A new `dispatch_batches` table groups committed tasks. `executeTask` accepts agent type as a parameter (no longer hardcoded). A dispatcher function processes the batch — starting unblocked tasks up to a concurrency limit, then polling for completions and starting the next wave. The dispatch plan UI shows a table of task → agent → branch mappings with editable agent selectors.

**Tech Stack:** tRPC, Drizzle, React client components, existing `executeTask` from taskExecutor.ts.

---

## Batch 1: Schema + executeTask Agent Selection

### Task 1.1: Create dispatch_batches table

**Files:**
- Modify: `packages/db/src/schema.ts`

Add after the `planDraftDependencies` relations:

```typescript
export const dispatchBatches = pgTable("dispatch_batches", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
  sessionId: t.uuid().references(() => chatConversations.id, { onDelete: "set null" }),
  workspaceId: t.text().notNull(),
  projectId: t.text().notNull(),
  status: t.varchar({ length: 20 }).notNull().default("pending"),
  // status: "pending" | "dispatching" | "running" | "completed" | "failed"
  concurrency: t.integer().notNull().default(2),
  totalTasks: t.integer().notNull().default(0),
  completedTasks: t.integer().notNull().default(0),
  failedTasks: t.integer().notNull().default(0),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
}));

export const dispatchItems = pgTable(
  "dispatch_items",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    batchId: t.uuid().notNull().references(() => dispatchBatches.id, { onDelete: "cascade" }),
    planningTaskId: t.text().notNull(),
    planningTaskIdentifier: t.text().notNull(),
    title: t.text().notNull(),
    description: t.text(),
    agentType: t.varchar({ length: 50 }).notNull().default("opencode"),
    status: t.varchar({ length: 20 }).notNull().default("queued"),
    // status: "queued" | "blocked" | "running" | "completed" | "failed"
    blockedByItems: t.json().$type<string[]>().default([]),
    // Array of dispatchItem IDs that must complete before this one starts
    taskRunId: t.uuid().references(() => taskRuns.id, { onDelete: "set null" }),
    sortOrder: t.integer().notNull().default(0),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "dispatch_items_batch_idx", columns: [table.batchId] },
  ],
);
```

Push schema and verify typecheck.

### Task 1.2: Make executeTask accept agentType parameter

**Files:**
- Modify: `apps/execution/src/runtime/taskExecutor.ts`

Change `executeTask` signature to accept an optional `agentType` in options:

```typescript
export async function executeTask(
  userId: string,
  task: PlanningTask,
  options?: {
    contextPreamble?: string;
    agentType?: string;  // NEW — defaults to "opencode"
  },
): Promise<TaskExecutionResult>
```

In the function body, replace the hardcoded `agentType: "opencode"` with:
```typescript
agentType: options?.agentType ?? "opencode",
```

This change applies in two places:
1. The `chatConversations` insert (~line 279)
2. The `gatewayRequest` call for `/session/start` (~line 310)

Verify existing callers still work (they don't pass agentType, so default applies).

### Verification (Batch 1)
```bash
pnpm --filter @bob/db typecheck
pnpm --filter @bob/execution typecheck
pnpm --filter @bob/api typecheck
```

---

## Batch 2: Dispatch Router + Agent Heuristics

### Task 2.1: Create dispatch tRPC router

**Files:**
- Create: `packages/api/src/router/dispatch.ts`
- Modify: `packages/api/src/root.ts`

Procedures:

**`createBatch`** — After commitPlan, create a dispatch batch from committed tasks:
- Input: `{ sessionId, concurrency? }`
- Fetches committed drafts + dependencies for the session
- Creates `dispatchBatches` row
- Creates `dispatchItems` rows — one per committed draft, with:
  - `planningTaskId` and `identifier` from commitPlan result
  - `agentType` from heuristic (see Task 2.2)
  - `blockedByItems` computed from draft dependencies
  - `status: "queued"` or `"blocked"` based on dependencies
- Returns batch with items

**`getBatch`** — Get batch + items:
- Input: `{ batchId }`
- Returns batch details + all items with status

**`updateItemAgent`** — Change agent for an item:
- Input: `{ itemId, agentType }`
- Updates the dispatch item's agent type

**`updateConcurrency`** — Change concurrency limit:
- Input: `{ batchId, concurrency }`
- Updates the batch's concurrency

**`dispatch`** — Start executing the batch:
- Input: `{ batchId }`
- Sets batch status to "dispatching"
- Finds all unblocked items (status: "queued")
- Up to `concurrency` limit, calls `executeTask` for each
- Updates dispatched items to "running"
- Returns count of started tasks

**`checkProgress`** — Poll batch progress and start next wave:
- Input: `{ batchId }`
- Checks task run status for running items
- Marks completed/failed items
- Starts next unblocked items up to concurrency
- Updates batch counters
- Returns updated batch status

### Task 2.2: Agent assignment heuristics

**Files:**
- Create: `packages/api/src/services/dispatch/agentHeuristics.ts`

Simple rule-based assignment:

```typescript
export function suggestAgent(draft: {
  kind: string;
  title: string;
  description: string | null;
}): string {
  // Epics and design tasks → claude (best reasoning)
  if (draft.kind === "epic") return "claude";

  // Test tasks → codex (good at test generation)
  const titleLower = draft.title.toLowerCase();
  const descLower = (draft.description ?? "").toLowerCase();
  if (titleLower.includes("test") || titleLower.includes("e2e") ||
      descLower.includes("test coverage") || descLower.includes("write tests")) {
    return "codex";
  }

  // Default implementation → opencode
  return "opencode";
}
```

### Verification (Batch 2)
```bash
pnpm --filter @bob/api typecheck
```

---

## Batch 3: Dispatch Plan UI

### Task 3.1: Create DispatchPlan component

**Files:**
- Create: `apps/web/src/components/planning/dispatch-plan.tsx`

A "use client" component showing the dispatch table:
- Accepts `batchId: string` prop
- Polls `trpc.dispatch.getBatch` every 5s
- Renders a table with columns: Task (identifier + title), Agent (select dropdown), Status, Blocked By
- Agent dropdown uses `Select` from `@bob/ui/select` with options: claude, codex, opencode, gemini, kiro, cursor-agent
- Changing agent calls `trpc.dispatch.updateItemAgent`
- Concurrency control: number input calling `trpc.dispatch.updateConcurrency`
- "Dispatch" button at bottom calls `trpc.dispatch.dispatch`
- After dispatch, polls `trpc.dispatch.checkProgress` every 10s
- Shows progress bar: `{completed}/{total} tasks complete`

### Task 3.2: Create DispatchPlan page

**Files:**
- Create: `apps/web/src/app/(dashboard)/planning/dispatch/[batchId]/page.tsx`

Client page rendering the DispatchPlan component with breadcrumbs.

### Task 3.3: Wire commitPlan → dispatch flow

**Files:**
- Modify: `apps/web/src/components/planning/draft-panel.tsx`

After successful `commitPlan`:
1. Call `trpc.dispatch.createBatch({ sessionId })`
2. Navigate to `/planning/dispatch/${batchId}`

This replaces the current "toast + refresh" behavior with a redirect to the dispatch plan page.

### Verification (Batch 3)
```bash
pnpm --filter @bob/web typecheck
```

---

## Batch 4: Live Dispatch Monitoring

### Task 4.1: Add dispatch status to board cards

**Files:**
- Modify: `apps/web/src/components/work-items/work-item-board.tsx`

For items that are part of an active dispatch batch, show the agent type icon and running/queued status. This requires extending the board item type to include optional dispatch state.

### Task 4.2: Dispatch batch status in planning page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/planning/page.tsx`

If there's an active dispatch batch, show a compact status bar above the work board:
"Dispatching: 2/5 running, 1/5 complete, 2/5 queued — View dispatch plan"

### Task 4.3: Auto-progress checker

**Files:**
- Create: `apps/web/src/hooks/use-dispatch-progress.ts`

A hook that polls `dispatch.checkProgress` every 10s when a batch is active. This ensures dependent tasks get started automatically as predecessors complete.

### Verification (Batch 4)
```bash
pnpm --filter @bob/web typecheck
pnpm --filter @bob/web test
```

---

## Key Files Reference

### New files
| File | Batch | Purpose |
|------|-------|---------|
| `packages/api/src/router/dispatch.ts` | 2 | Dispatch batch CRUD + execution |
| `packages/api/src/services/dispatch/agentHeuristics.ts` | 2 | Agent assignment suggestions |
| `apps/web/src/components/planning/dispatch-plan.tsx` | 3 | Dispatch table UI |
| `apps/web/src/app/(dashboard)/planning/dispatch/[batchId]/page.tsx` | 3 | Dispatch plan page |
| `apps/web/src/hooks/use-dispatch-progress.ts` | 4 | Auto-progress polling |

### Modified files
| File | Batch | Change |
|------|-------|--------|
| `packages/db/src/schema.ts` | 1 | dispatch_batches + dispatch_items tables |
| `apps/execution/src/runtime/taskExecutor.ts` | 1 | Accept agentType parameter |
| `packages/api/src/root.ts` | 2 | Register dispatch router |
| `apps/web/src/components/planning/draft-panel.tsx` | 3 | Navigate to dispatch after commit |
| `apps/web/src/components/work-items/work-item-board.tsx` | 4 | Dispatch status on cards |
| `apps/web/src/app/(dashboard)/planning/page.tsx` | 4 | Active batch status bar |
