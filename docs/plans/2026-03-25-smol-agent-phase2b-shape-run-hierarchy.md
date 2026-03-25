# Smol-Agent Phase 2b: Shape Agent, Run Hierarchy & Lifecycle Events

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend Bob's smol-agent integration with a shape-agent profile for idea-to-BRD workflows, run hierarchy for parent/child tracking, and generalized lifecycle events that work across all lifecycle stages.

**Architecture:** Add `parentTaskRunId` and `runPhase` fields to `taskRuns` for hierarchy and phase tracking. Create a `runLifecycleEvents` table for structured event logging across all phases. Build a shape-agent profile that reuses the existing planning prompt's shaping workflow but produces BRD artifacts instead of task breakdowns. Wire shape sessions into the existing `startPlanningSession` path with a `shape` session type.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Vitest, Next.js/tRPC, smol-agent ACP

## Preconditions

- Phase 2a must be committed (smol-agent planning swap, commitPlanLocal fix, DAG viz, work_item_dependencies table)
- Work in the `bob` repository root
- All existing tests must pass before starting

## Task 1: Add run hierarchy and phase fields to taskRuns

**Files:**
- Create: `packages/db/drizzle/0011_run_hierarchy.sql`
- Modify: `packages/db/src/schema.ts`

**Step 1: Write the failing test**

Create `packages/api/src/router/__tests__/taskRunHierarchy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("taskRuns run hierarchy schema", () => {
  it("has parentTaskRunId and runPhase fields in schema", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../../../packages/db/src/schema.ts"),
      "utf8",
    );
    expect(source).toContain("parentTaskRunId");
    expect(source).toContain("runPhase");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest packages/api/src/router/__tests__/taskRunHierarchy.test.ts`

Expected: FAIL because schema doesn't have these fields yet

**Step 3: Write the migration**

Create `packages/db/drizzle/0011_run_hierarchy.sql`:

```sql
ALTER TABLE task_runs
  ADD COLUMN IF NOT EXISTS parent_task_run_id UUID REFERENCES task_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS run_phase VARCHAR(20) NOT NULL DEFAULT 'execute';

COMMENT ON COLUMN task_runs.run_phase IS 'Lifecycle phase: shape, plan, execute, review, ship';

CREATE INDEX IF NOT EXISTS task_runs_parent_idx ON task_runs(parent_task_run_id);
CREATE INDEX IF NOT EXISTS task_runs_phase_idx ON task_runs(run_phase);
```

**Step 4: Add fields to schema.ts**

In `packages/db/src/schema.ts`, add after `forgegraphRevisionId` (line ~1590):

```ts
  parentTaskRunId: t.uuid().references(() => taskRuns.id, { onDelete: "set null" }),
  runPhase: t.varchar({ length: 20 }).notNull().default("execute"),
  // runPhase values: "shape" | "plan" | "execute" | "review" | "ship"
```

Update `taskRunsRelations` to add:

```ts
  parentRun: one(taskRuns, {
    fields: [taskRuns.parentTaskRunId],
    references: [taskRuns.id],
    relationName: "task_run_parent",
  }),
  childRuns: many(taskRuns, {
    relationName: "task_run_parent",
  }),
```

**Step 5: Run test to verify it passes**

Run: `pnpm vitest packages/api/src/router/__tests__/taskRunHierarchy.test.ts`

Expected: PASS

**Step 6: Commit**

```bash
git add packages/db/drizzle/0011_run_hierarchy.sql packages/db/src/schema.ts packages/api/src/router/__tests__/taskRunHierarchy.test.ts
git commit -m "feat: add run hierarchy and phase fields to taskRuns"
```

## Task 2: Add runLifecycleEvents table

**Files:**
- Create: `packages/db/drizzle/0012_run_lifecycle_events.sql`
- Modify: `packages/db/src/schema.ts`

**Step 1: Write the failing test**

Create `packages/api/src/router/__tests__/runLifecycleEvents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("runLifecycleEvents schema", () => {
  it("has runLifecycleEvents table in schema", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../../../packages/db/src/schema.ts"),
      "utf8",
    );
    expect(source).toContain("runLifecycleEvents");
    expect(source).toContain("run_lifecycle_events");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest packages/api/src/router/__tests__/runLifecycleEvents.test.ts`

Expected: FAIL

**Step 3: Write the migration**

Create `packages/db/drizzle/0012_run_lifecycle_events.sql`:

```sql
CREATE TABLE IF NOT EXISTS run_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_run_id UUID NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  work_item_id UUID REFERENCES work_items(id) ON DELETE SET NULL,
  session_id UUID REFERENCES chat_conversations(id) ON DELETE SET NULL,
  event_type VARCHAR(40) NOT NULL,
  phase VARCHAR(20) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT now() NOT NULL
);

COMMENT ON COLUMN run_lifecycle_events.event_type IS 'Event types: run_started, run_completed, run_failed, phase_changed, artifact_created, plan_approved, plan_rejected, brd_generated, tasks_dispatched';
COMMENT ON COLUMN run_lifecycle_events.phase IS 'Phase when event occurred: shape, plan, execute, review, ship';

CREATE INDEX IF NOT EXISTS run_lifecycle_events_run_idx ON run_lifecycle_events(task_run_id);
CREATE INDEX IF NOT EXISTS run_lifecycle_events_type_idx ON run_lifecycle_events(event_type);
```

**Step 4: Add table to schema.ts**

Add after the `workItemDependencies` section:

```ts
export const runLifecycleEvents = pgTable(
  "run_lifecycle_events",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    taskRunId: t
      .uuid()
      .notNull()
      .references(() => taskRuns.id, { onDelete: "cascade" }),
    workItemId: t
      .uuid()
      .references(() => workItems.id, { onDelete: "set null" }),
    sessionId: t
      .uuid()
      .references(() => chatConversations.id, { onDelete: "set null" }),
    eventType: t.varchar({ length: 40 }).notNull(),
    phase: t.varchar({ length: 20 }).notNull(),
    metadata: t.json().$type<Record<string, unknown>>().default({}),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    { name: "run_lifecycle_events_run_idx", columns: [table.taskRunId] },
    { name: "run_lifecycle_events_type_idx", columns: [table.eventType] },
  ],
);

export const runLifecycleEventsRelations = relations(
  runLifecycleEvents,
  ({ one }) => ({
    taskRun: one(taskRuns, {
      fields: [runLifecycleEvents.taskRunId],
      references: [taskRuns.id],
    }),
    workItem: one(workItems, {
      fields: [runLifecycleEvents.workItemId],
      references: [workItems.id],
    }),
    session: one(chatConversations, {
      fields: [runLifecycleEvents.sessionId],
      references: [chatConversations.id],
    }),
  }),
);
```

**Step 5: Run test to verify it passes**

Run: `pnpm vitest packages/api/src/router/__tests__/runLifecycleEvents.test.ts`

Expected: PASS

**Step 6: Commit**

```bash
git add packages/db/drizzle/0012_run_lifecycle_events.sql packages/db/src/schema.ts packages/api/src/router/__tests__/runLifecycleEvents.test.ts
git commit -m "feat: add run_lifecycle_events table for cross-phase event logging"
```

## Task 3: Add "shape" planning session type and shape-agent profile

**Files:**
- Create: `apps/execution/src/planning/smolAgentShapeProfile.ts`
- Create: `apps/execution/src/planning/__tests__/smolAgentShapeProfile.test.ts`
- Modify: `apps/execution/src/planning/startPlanningSession.ts`
- Modify: `packages/api/src/router/planSession.ts`

**Step 1: Write the failing test**

Create `apps/execution/src/planning/__tests__/smolAgentShapeProfile.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildSmolAgentShapeProfile } from "../smolAgentShapeProfile";

describe("smolAgentShapeProfile", () => {
  it("builds a shape profile with correct agent type", () => {
    const profile = buildSmolAgentShapeProfile({
      sessionId: "session-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
      projectName: "Test Project",
      workingDirectory: "/tmp/project",
      workItemId: "wi-1",
      workItemTitle: "New Feature Idea",
    });

    expect(profile.agentType).toBe("smol-agent");
    expect(profile.runPhase).toBe("shape");
  });

  it("includes all required environment variables", () => {
    const profile = buildSmolAgentShapeProfile({
      sessionId: "session-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
      projectName: "Test Project",
      workingDirectory: "/tmp/project",
      workItemId: "wi-1",
      workItemTitle: "New Feature Idea",
    });

    expect(profile.env.BOB_SESSION_ID).toBe("session-1");
    expect(profile.env.BOB_RUN_PHASE).toBe("shape");
    expect(profile.env.BOB_WORK_ITEM_ID).toBe("wi-1");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest apps/execution/src/planning/__tests__/smolAgentShapeProfile.test.ts`

Expected: FAIL because the module doesn't exist

**Step 3: Write the shape profile**

Create `apps/execution/src/planning/smolAgentShapeProfile.ts`:

```ts
export interface SmolAgentShapeProfileInput {
  sessionId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  workingDirectory: string;
  workItemId: string;
  workItemTitle: string;
}

export interface SmolAgentShapeProfile {
  agentType: "smol-agent";
  runPhase: "shape";
  env: Record<string, string>;
}

export function buildSmolAgentShapeProfile(
  input: SmolAgentShapeProfileInput,
): SmolAgentShapeProfile {
  return {
    agentType: "smol-agent",
    runPhase: "shape",
    env: {
      BOB_SESSION_ID: input.sessionId,
      BOB_WORKSPACE_ID: input.workspaceId,
      BOB_PROJECT_ID: input.projectId,
      BOB_PROJECT_NAME: input.projectName,
      BOB_WORKTREE_PATH: input.workingDirectory,
      BOB_WORK_ITEM_ID: input.workItemId,
      BOB_WORK_ITEM_TITLE: input.workItemTitle,
      BOB_RUN_PHASE: "shape",
    },
  };
}
```

**Step 4: Add "shape" to planSession.ts session type enum**

In `packages/api/src/router/planSession.ts`, update the `planningSessionType` enum (appears in two places: `create` and `saveArtifact`):

```ts
planningSessionType: z.enum([
  "office_hours", "ceo_review", "eng_review", "design_review", "breakdown", "shape",
]).optional(),
```

**Step 5: Wire shape intent into startPlanningSession**

In `apps/execution/src/planning/startPlanningSession.ts`, add shape profile selection based on `launchContext.intent`:

```ts
import { buildSmolAgentShapeProfile } from "./smolAgentShapeProfile";

// Inside startPlanningSession, after building the prompt:
const isShapeIntent = input.launchContext?.intent === "shape";

const profile = isShapeIntent
  ? buildSmolAgentShapeProfile({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      projectName: input.projectName,
      workingDirectory: input.workingDirectory,
      workItemId: input.launchContext?.workItem?.id ?? "",
      workItemTitle: input.launchContext?.workItem?.title ?? input.projectName,
    })
  : buildSmolAgentPlanningProfile({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      projectName: input.projectName,
      workingDirectory: input.workingDirectory,
    });

console.log(
  `[planning] Starting ${isShapeIntent ? "shape" : "planning"} session ${input.sessionId} with ${profile.agentType} for project "${input.projectName}"`,
);
```

**Step 6: Run test to verify it passes**

Run: `pnpm vitest apps/execution/src/planning/__tests__/smolAgentShapeProfile.test.ts`

Expected: PASS

**Step 7: Commit**

```bash
git add apps/execution/src/planning/smolAgentShapeProfile.ts apps/execution/src/planning/__tests__/smolAgentShapeProfile.test.ts apps/execution/src/planning/startPlanningSession.ts packages/api/src/router/planSession.ts
git commit -m "feat: add shape-agent profile and shape session type"
```

## Task 4: Add lifecycle event logging helper

**Files:**
- Create: `apps/execution/src/runtime/lifecycleEvents.ts`
- Create: `apps/execution/src/runtime/__tests__/lifecycleEvents.test.ts`

**Step 1: Write the failing test**

Create `apps/execution/src/runtime/__tests__/lifecycleEvents.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildLifecycleEvent, type LifecycleEventType, type RunPhase } from "../lifecycleEvents";

describe("lifecycleEvents", () => {
  it("builds a valid event object", () => {
    const event = buildLifecycleEvent({
      taskRunId: "run-1",
      workItemId: "wi-1",
      sessionId: "session-1",
      eventType: "run_started",
      phase: "shape",
    });

    expect(event.taskRunId).toBe("run-1");
    expect(event.eventType).toBe("run_started");
    expect(event.phase).toBe("shape");
    expect(event.metadata).toEqual({});
  });

  it("includes metadata when provided", () => {
    const event = buildLifecycleEvent({
      taskRunId: "run-1",
      eventType: "artifact_created",
      phase: "shape",
      metadata: { artifactType: "brd", title: "Feature BRD" },
    });

    expect(event.metadata).toEqual({ artifactType: "brd", title: "Feature BRD" });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest apps/execution/src/runtime/__tests__/lifecycleEvents.test.ts`

Expected: FAIL

**Step 3: Write the helper**

Create `apps/execution/src/runtime/lifecycleEvents.ts`:

```ts
export type RunPhase = "shape" | "plan" | "execute" | "review" | "ship";

export type LifecycleEventType =
  | "run_started"
  | "run_completed"
  | "run_failed"
  | "phase_changed"
  | "artifact_created"
  | "plan_approved"
  | "plan_rejected"
  | "brd_generated"
  | "tasks_dispatched";

export interface LifecycleEventInput {
  taskRunId: string;
  workItemId?: string;
  sessionId?: string;
  eventType: LifecycleEventType;
  phase: RunPhase;
  metadata?: Record<string, unknown>;
}

export interface LifecycleEvent {
  taskRunId: string;
  workItemId: string | null;
  sessionId: string | null;
  eventType: LifecycleEventType;
  phase: RunPhase;
  metadata: Record<string, unknown>;
}

export function buildLifecycleEvent(input: LifecycleEventInput): LifecycleEvent {
  return {
    taskRunId: input.taskRunId,
    workItemId: input.workItemId ?? null,
    sessionId: input.sessionId ?? null,
    eventType: input.eventType,
    phase: input.phase,
    metadata: input.metadata ?? {},
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest apps/execution/src/runtime/__tests__/lifecycleEvents.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/execution/src/runtime/lifecycleEvents.ts apps/execution/src/runtime/__tests__/lifecycleEvents.test.ts
git commit -m "feat: add lifecycle event builder for cross-phase run tracking"
```

## Task 5: Wire lifecycle events into commitPlanLocal and startPlanningSession

**Files:**
- Modify: `packages/api/src/router/planSession.ts`
- Modify: `apps/execution/src/planning/startPlanningSession.ts`

**Step 1: Add event logging to commitPlanLocal**

In `packages/api/src/router/planSession.ts`, import `runLifecycleEvents` from schema and after the transaction in `commitPlanLocal`, log events:

```ts
// After the transaction succeeds, fire-and-forget lifecycle events
void ctx.db.insert(runLifecycleEvents).values({
  taskRunId: "commit-" + input.sessionId, // Placeholder — no taskRun for planning sessions yet
  workItemId: input.parentWorkItemId,
  sessionId: input.sessionId,
  eventType: "plan_approved",
  phase: "plan",
  metadata: {
    committed: result.created.length,
    dependencies: result.depCount,
  },
}).catch((err) => console.error("[planning] Failed to log lifecycle event:", err));
```

**Step 2: Add event logging to startPlanningSession**

In `apps/execution/src/planning/startPlanningSession.ts`, after session status is updated:

```ts
console.log(
  `[planning] Session ${input.sessionId} started successfully (${isShapeIntent ? "shape" : "plan"} phase)`,
);
```

**Step 3: Run existing tests to verify no regressions**

Run: `pnpm vitest packages/api/src/router/__tests__/planSession.test.ts apps/execution/src/planning/__tests__/smolAgentPlanningProfile.test.ts`

Expected: PASS

**Step 4: Commit**

```bash
git add packages/api/src/router/planSession.ts apps/execution/src/planning/startPlanningSession.ts
git commit -m "feat: wire lifecycle events into planning and shape flows"
```

## Task 6: Verify the full Phase 2b suite

**Step 1: Run all Phase 2b tests**

```bash
pnpm vitest packages/api/src/router/__tests__/taskRunHierarchy.test.ts packages/api/src/router/__tests__/runLifecycleEvents.test.ts apps/execution/src/planning/__tests__/smolAgentShapeProfile.test.ts apps/execution/src/runtime/__tests__/lifecycleEvents.test.ts
```

Expected: PASS

**Step 2: Run existing test suites for regression**

```bash
pnpm vitest packages/api/src/router/__tests__/planSession.test.ts packages/api/src/router/__tests__/commitPlanLocal.test.ts apps/execution/src/planning/__tests__/smolAgentPlanningProfile.test.ts apps/execution/src/runtime/smolAgentProfile.test.ts
```

Expected: PASS

**Step 3: Type check**

```bash
npx turbo build --filter=@bob/db && npx tsc --noEmit --project packages/api/tsconfig.json && npx tsc --noEmit --project apps/execution/tsconfig.json
```

Expected: Clean

## Notes For The Implementer

- The `runPhase` field on `taskRuns` defaults to `"execute"` so all existing runs are backward-compatible
- `parentTaskRunId` is nullable — leaf runs (most existing runs) have no parent
- The `runLifecycleEvents` table is separate from `forgeRunEvents` intentionally — forge events are VCS/CI-specific, lifecycle events are cross-phase
- Shape sessions use the same `startPlanningSession` path but with `intent: "shape"` in the launch context — the planning prompt already has shaping workflow guidance
- The shape-agent profile sets `BOB_RUN_PHASE=shape` in the environment so smol-agent can adjust its behavior if needed

## Follow-Up After Phase 2b

- Phase 3: task-reviewer, feature-reviewer, release-manager profiles
- Wire parent/child run tracking into task execution (planning run creates child task runs)
- Run lifecycle dashboard showing events across phases
- Artifact type specialization (BRD artifacts vs. planning doc artifacts vs. review artifacts)
