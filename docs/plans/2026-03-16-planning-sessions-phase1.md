# Planning Sessions + Draft Tasks — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement the remaining tasks in controlled batches.

**Goal:** Enable users to start an AI planning session that reads the codebase, asks clarifying questions, and creates draft tasks — then review and commit those drafts as real work items.

**Architecture:** A planning session is a `chatConversation` with `sessionType: "planning"` and `agentType: "claude"`. The planning agent gets MCP-style tools (`create_draft_task`, `update_draft_task`, etc.) that write to a new `plan_drafts` table in the local DB. A "Plan Review" UI shows all drafts for the session, and "Commit Plan" batch-creates them via the planning API.

**Tech Stack:** tRPC, Drizzle ORM (schema-push), React client components, existing session infrastructure, planning API (tasks.gmac.io).

---

## Batch 1: Schema + Plan Session Router

### Task 1.1: Add `sessionType` column to chatConversations

**Files:**
- Modify: `packages/db/src/schema.ts:568-630` (chatConversations table)

**Step 1:** Add `sessionType` column after `agentType`:

```typescript
// In chatConversations table definition, after agentType line:
sessionType: t.varchar({ length: 20 }).notNull().default("execution"),
```

Valid values: `"execution"` (default, existing behavior) and `"planning"`.

**Step 2:** Push schema:

```bash
pnpm -C packages/db push
```

**Step 3:** Verify:

```bash
pnpm --filter @bob/db typecheck
```

### Task 1.2: Create `plan_drafts` table

**Files:**
- Modify: `packages/db/src/schema.ts` (add after workItems table, ~line 160)

**Step 1:** Add the table definition:

```typescript
export const planDrafts = pgTable("plan_drafts", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  sessionId: t
    .uuid()
    .notNull()
    .references(() => chatConversations.id, { onDelete: "cascade" }),
  workspaceId: t.uuid().notNull(),
  projectId: t.uuid().notNull(),
  title: t.varchar({ length: 256 }).notNull(),
  description: t.text(),
  kind: workItemKindEnum().notNull().default("task"),
  priority: t.varchar({ length: 20 }).notNull().default("no_priority"),
  sortOrder: t.integer().notNull().default(0),
  status: t.varchar({ length: 20 }).notNull().default("draft"),
  // status: "draft" | "committed" | "discarded"
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const planDraftDependencies = pgTable("plan_draft_dependencies", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  draftId: t
    .uuid()
    .notNull()
    .references(() => planDrafts.id, { onDelete: "cascade" }),
  dependsOnDraftId: t
    .uuid()
    .notNull()
    .references(() => planDrafts.id, { onDelete: "cascade" }),
}));
```

**Step 2:** Push schema:

```bash
pnpm -C packages/db push
```

**Step 3:** Verify:

```bash
pnpm --filter @bob/db typecheck
```

### Task 1.3: Create planSession tRPC router

**Files:**
- Create: `packages/api/src/router/planSession.ts`
- Modify: `packages/api/src/root.ts` (register router)

**Step 1:** Create the router with CRUD procedures for plan sessions and drafts:

```typescript
// packages/api/src/router/planSession.ts
import { z } from "zod/v4";

import { and, desc, eq } from "@bob/db";
import { chatConversations, planDraftDependencies, planDrafts } from "@bob/db/schema";

import {
  getPlanningApiKey,
  getPlanningBaseUrl,
} from "../services/integrations/planningRemoteConfig";
import { protectedProcedure } from "../trpc";

export const planSessionRouter = {
  /** Create a new planning session. */
  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        projectId: z.string().uuid(),
        workingDirectory: z.string(),
        title: z.string().max(256).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .insert(chatConversations)
        .values({
          userId: ctx.session.user.id,
          workingDirectory: input.workingDirectory,
          agentType: "claude",
          sessionType: "planning",
          title: input.title ?? "Planning session",
          status: "provisioning",
        })
        .returning();

      return session!;
    }),

  /** Get a planning session with its drafts. */
  get: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.sessionId),
          eq(chatConversations.sessionType, "planning"),
          eq(chatConversations.userId, ctx.session.user.id),
        ),
      });

      if (!session) return null;

      const drafts = await ctx.db.query.planDrafts.findMany({
        where: eq(planDrafts.sessionId, input.sessionId),
        orderBy: [planDrafts.sortOrder, planDrafts.createdAt],
      });

      const deps = await ctx.db.query.planDraftDependencies.findMany({
        where: eq(
          planDraftDependencies.draftId,
          // Get deps for all drafts in this session
          // We'll filter client-side since drizzle doesn't have easy IN from subquery
          drafts[0]?.id ?? "00000000-0000-0000-0000-000000000000",
        ),
      });

      return { session, drafts, dependencies: deps };
    }),

  /** List planning sessions for a workspace. */
  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid().optional(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const sessions = await ctx.db.query.chatConversations.findMany({
        where: and(
          eq(chatConversations.userId, ctx.session.user.id),
          eq(chatConversations.sessionType, "planning"),
        ),
        orderBy: desc(chatConversations.createdAt),
        limit: input.limit,
      });

      return sessions;
    }),

  // --- Draft CRUD ---

  createDraft: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        projectId: z.string().uuid(),
        title: z.string().min(1).max(256),
        description: z.string().optional(),
        kind: z.enum(["issue", "task", "epic"]).default("task"),
        priority: z
          .enum(["no_priority", "urgent", "high", "medium", "low"])
          .default("no_priority"),
        sortOrder: z.number().int().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [draft] = await ctx.db
        .insert(planDrafts)
        .values({
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          title: input.title,
          description: input.description ?? null,
          kind: input.kind,
          priority: input.priority,
          sortOrder: input.sortOrder,
        })
        .returning();

      return draft!;
    }),

  updateDraft: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(256).optional(),
        description: z.string().optional(),
        kind: z.enum(["issue", "task", "epic"]).optional(),
        priority: z
          .enum(["no_priority", "urgent", "high", "medium", "low"])
          .optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      const [draft] = await ctx.db
        .update(planDrafts)
        .set(updates)
        .where(eq(planDrafts.id, id))
        .returning();

      return draft!;
    }),

  removeDraft: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(planDrafts).where(eq(planDrafts.id, input.id));
      return { ok: true };
    }),

  setDependency: protectedProcedure
    .input(
      z.object({
        draftId: z.string().uuid(),
        dependsOnDraftId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [dep] = await ctx.db
        .insert(planDraftDependencies)
        .values({
          draftId: input.draftId,
          dependsOnDraftId: input.dependsOnDraftId,
        })
        .returning();

      return dep!;
    }),

  removeDependency: protectedProcedure
    .input(
      z.object({
        draftId: z.string().uuid(),
        dependsOnDraftId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(planDraftDependencies)
        .where(
          and(
            eq(planDraftDependencies.draftId, input.draftId),
            eq(planDraftDependencies.dependsOnDraftId, input.dependsOnDraftId),
          ),
        );
      return { ok: true };
    }),

  /** Commit all drafts — batch-create tasks via planning API. */
  commitPlan: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const drafts = await ctx.db.query.planDrafts.findMany({
        where: and(
          eq(planDrafts.sessionId, input.sessionId),
          eq(planDrafts.status, "draft"),
        ),
        orderBy: [planDrafts.sortOrder, planDrafts.createdAt],
      });

      if (drafts.length === 0) {
        return { committed: 0, tasks: [] };
      }

      const planningApiKey = getPlanningApiKey();
      if (!planningApiKey) {
        throw new Error("PLANNING_API_KEY not configured");
      }

      // Create tasks on planning API one by one, collecting results
      const createdTasks: Array<{
        draftId: string;
        taskId: string;
        identifier: string;
      }> = [];

      for (const draft of drafts) {
        const url = `${getPlanningBaseUrl()}/api/trpc/issue.create`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": planningApiKey,
          },
          body: JSON.stringify({
            "0": {
              json: {
                projectId: draft.projectId,
                title: draft.title,
                description: draft.description,
                status: "todo",
                priority: draft.priority,
              },
            },
          }),
        });

        if (!response.ok) {
          console.error(
            `[planSession] Failed to create task for draft ${draft.id}: ${response.status}`,
          );
          continue;
        }

        const result = (await response.json()) as Array<{
          result?: { data?: { json?: { id: string; identifier: string } } };
        }>;
        const created = result[0]?.result?.data?.json;

        if (created) {
          createdTasks.push({
            draftId: draft.id,
            taskId: created.id,
            identifier: created.identifier,
          });
        }
      }

      // Mark drafts as committed
      if (createdTasks.length > 0) {
        const committedIds = createdTasks.map((t) => t.draftId);
        for (const draftId of committedIds) {
          await ctx.db
            .update(planDrafts)
            .set({ status: "committed" })
            .where(eq(planDrafts.id, draftId));
        }
      }

      return { committed: createdTasks.length, tasks: createdTasks };
    }),
};
```

**Step 2:** Register in root.ts:

In `packages/api/src/root.ts`, add:
```typescript
import { planSessionRouter } from "./router/planSession";
```

And in the `appRouterRecord`:
```typescript
planSession: planSessionRouter,
```

**Step 3:** Verify:

```bash
pnpm --filter @bob/api typecheck
```

### Verification (Batch 1)
```bash
pnpm --filter @bob/db typecheck
pnpm --filter @bob/api typecheck
```

---

## Batch 2: Planning Agent Tools

### Task 2.1: Create planning agent tool definitions

The planning agent needs structured tools it can call during the session. These are presented to Claude as tool definitions in the initial prompt.

**Files:**
- Create: `apps/execution/src/planning/planningAgentTools.ts`

**Step 1:** Create the tool definitions and prompt builder:

```typescript
// apps/execution/src/planning/planningAgentTools.ts

export interface PlanningContext {
  workspaceId: string;
  projectId: string;
  projectName: string;
  sessionId: string;
}

/**
 * Build the system prompt for a planning agent session.
 * Includes tool descriptions that the agent can invoke via structured output.
 */
export function buildPlanningPrompt(ctx: PlanningContext): string {
  return `# Planning Session

You are a planning agent for the "${ctx.projectName}" project. Your job is to help the user break down their goal into structured, actionable tasks.

## Your Capabilities

You can explore the codebase using standard tools (read files, search, etc.) and you have special planning tools:

### create_draft_task
Create a new draft task. Call this as you identify work items.
Parameters:
- title (required): Clear, actionable task title
- description (required): Detailed description with acceptance criteria
- kind: "task" (default), "issue", or "epic"
- priority: "no_priority" (default), "urgent", "high", "medium", "low"

### update_draft_task
Update an existing draft. Use the draft ID returned from create_draft_task.
Parameters:
- id (required): Draft ID
- title, description, kind, priority: Fields to update

### remove_draft_task
Remove a draft that's no longer needed.
Parameters:
- id (required): Draft ID

### set_dependency
Mark that one task depends on another completing first.
Parameters:
- draftId (required): The task that is blocked
- dependsOnDraftId (required): The task that must complete first

### list_drafts
Show all current draft tasks for this session.

## Process

1. Ask the user to describe their goal
2. Explore the codebase to understand the current state
3. Ask clarifying questions (one at a time)
4. Create draft tasks progressively as the plan takes shape
5. Set dependencies between tasks where order matters
6. When the plan is complete, summarize and tell the user to review

## Guidelines

- Each task should be completable by an AI coding agent in a single session
- Tasks should have clear, testable acceptance criteria in the description
- Prefer smaller tasks over larger ones
- Set dependencies only where truly necessary (avoid over-constraining)
- Use "epic" kind for grouping-only items, "task" for executable work, "issue" for bugs/problems

## Context

- Workspace ID: ${ctx.workspaceId}
- Project ID: ${ctx.projectId}
- Project: ${ctx.projectName}
- Session ID: ${ctx.sessionId}
`;
}

/**
 * Parse a tool call from the planning agent's output and return
 * the tRPC procedure name + input to execute.
 */
export interface PlanningToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export function mapPlanningToolCall(
  call: PlanningToolCall,
  ctx: PlanningContext,
):
  | { procedure: "createDraft"; input: Record<string, unknown> }
  | { procedure: "updateDraft"; input: Record<string, unknown> }
  | { procedure: "removeDraft"; input: Record<string, unknown> }
  | { procedure: "setDependency"; input: Record<string, unknown> }
  | { procedure: "removeDependency"; input: Record<string, unknown> }
  | null {
  switch (call.tool) {
    case "create_draft_task":
      return {
        procedure: "createDraft",
        input: {
          sessionId: ctx.sessionId,
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          title: call.args.title,
          description: call.args.description,
          kind: call.args.kind ?? "task",
          priority: call.args.priority ?? "no_priority",
        },
      };
    case "update_draft_task":
      return {
        procedure: "updateDraft",
        input: {
          id: call.args.id,
          title: call.args.title,
          description: call.args.description,
          kind: call.args.kind,
          priority: call.args.priority,
        },
      };
    case "remove_draft_task":
      return {
        procedure: "removeDraft",
        input: { id: call.args.id },
      };
    case "set_dependency":
      return {
        procedure: "setDependency",
        input: {
          draftId: call.args.draftId,
          dependsOnDraftId: call.args.dependsOnDraftId,
        },
      };
    default:
      return null;
  }
}
```

**Step 2:** Verify:

```bash
pnpm --filter @bob/execution typecheck
```

### Task 2.2: Create planning session start endpoint

When a user starts a planning session, Bob needs to create the session in the DB and start it on the gateway with the planning prompt.

**Files:**
- Create: `apps/execution/src/planning/startPlanningSession.ts`

**Step 1:** Create the orchestrator:

```typescript
// apps/execution/src/planning/startPlanningSession.ts
import { db } from "@bob/db";
import { eq } from "@bob/db";
import { chatConversations } from "@bob/db/schema";

import { buildPlanningPrompt, type PlanningContext } from "./planningAgentTools";
import { gatewayRequest } from "../runtime/taskExecutor";

interface StartPlanningInput {
  userId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  sessionId: string;
  workingDirectory: string;
}

export async function startPlanningSession(
  input: StartPlanningInput,
): Promise<{ sessionId: string }> {
  const ctx: PlanningContext = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    projectName: input.projectName,
    sessionId: input.sessionId,
  };

  const prompt = buildPlanningPrompt(ctx);

  // Start the session on the gateway
  await gatewayRequest(input.userId, "/session/start", {
    sessionId: input.sessionId,
    workingDirectory: input.workingDirectory,
    agentType: "claude",
    initialPrompt: prompt,
  });

  // Update session status
  await db
    .update(chatConversations)
    .set({ status: "running" })
    .where(eq(chatConversations.id, input.sessionId));

  return { sessionId: input.sessionId };
}
```

**Step 2:** Add a `start` procedure to the planSession router that calls this:

In `packages/api/src/router/planSession.ts`, add after the `create` procedure:

```typescript
  start: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        projectId: z.string().uuid(),
        projectName: z.string(),
        workingDirectory: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { startPlanningSession } = await import(
        "@bob/execution/planning/startPlanningSession"
      );

      return startPlanningSession({
        userId: ctx.session.user.id,
        ...input,
      });
    }),
```

**Step 3:** Verify:

```bash
pnpm --filter @bob/execution typecheck
pnpm --filter @bob/api typecheck
```

### Verification (Batch 2)
```bash
pnpm --filter @bob/execution typecheck
pnpm --filter @bob/api typecheck
```

---

## Batch 3: Draft Panel UI

### Task 3.1: Create DraftPanel component

Shows draft tasks forming alongside the chat during a planning session.

**Files:**
- Create: `apps/web/src/components/planning/draft-panel.tsx`

**Step 1:** Create the component:

```typescript
// Client component showing drafts for the active planning session.
// Polls planSession.get every 5s while the session is active.
// Renders a mini task list with title, kind badge, priority, description preview.
// Each draft has edit/remove buttons.
// Shows dependency arrows between linked drafts.
// Footer shows "N drafts" count and "Commit Plan" button.
```

The component should:
- Accept `sessionId: string` prop
- Use `useQuery(trpc.planSession.get.queryOptions({ sessionId }), { refetchInterval: 5000 })`
- Render each draft as a compact card with `Badge` for kind and priority (from `@bob/ui/badge` and `~/lib/design/colors`)
- Show dependency links as "blocked by X" text
- Include a "Commit Plan" button that calls `trpc.planSession.commitPlan.mutationOptions()`
- Show success toast with count of created tasks
- After commit, call `router.refresh()`

### Task 3.2: Create PlanReview page

Full-screen review of all drafts before committing.

**Files:**
- Create: `apps/web/src/app/(dashboard)/planning/review/[sessionId]/page.tsx`

**Step 1:** Create as a server component that fetches drafts, with a client wrapper for the commit action:

The page should:
- Fetch session + drafts via tRPC caller (server-side)
- Show each draft as an editable card (using `InlineEditable` from `@bob/ui/inline-editable`)
- Show dependency graph as a simple list ("ENG-1 → ENG-2 → ENG-3")
- Include "Commit Plan" button (client component)
- After commit, redirect to `/planning`

### Task 3.3: Create "Plan with Bob" button and integration

**Files:**
- Create: `apps/web/src/components/planning/start-planning-button.tsx`
- Modify: `apps/web/src/app/(dashboard)/planning/page.tsx` (add button to header)
- Modify: `apps/web/src/app/(dashboard)/projects/[projectId]/page.tsx` (add button to header)

**Step 1:** Create the button component:

A client component that:
- Opens a dialog asking for goal description (textarea) and working directory (select from available repos)
- On submit, calls `trpc.planSession.create` then `trpc.planSession.start`
- Opens the chat panel (`useChatPanel().openPanel({ sessionId })`) with the planning session
- Shows the DraftPanel alongside

**Step 2:** Add to planning page header (next to existing "New work item" and "New project" buttons).

**Step 3:** Add to project page header.

### Task 3.4: Integrate DraftPanel into ChatPanel

When the chat panel is showing a planning session, display the DraftPanel below or beside the message stream.

**Files:**
- Modify: `apps/web/src/components/chat/chat-panel.tsx`

**Step 1:** Check if the active session has `sessionType: "planning"`. If so, render `DraftPanel` in a collapsible section above the input composer.

This requires extending `useChatSession` return to include `sessionData.sessionType` — the field is already on the `chatConversations` record, just needs to be surfaced.

### Verification (Batch 3)
```bash
pnpm --filter @bob/web typecheck
# Manual: click "Plan with Bob", start a planning session
# Manual: verify chat panel opens with planning agent
# Manual: verify draft panel shows alongside chat
```

---

## Batch 4: Planning Session Event Handling

### Task 4.1: Handle planning tool calls from agent output

When the planning agent calls `create_draft_task` etc., Bob needs to intercept those tool calls and execute them against the planSession router.

**Files:**
- Create: `apps/gateway/src/sessions/planningToolHandler.ts`

**Step 1:** Create a handler that:
- Listens for `tool_call` events from the session actor
- If the session is a planning session (`sessionType: "planning"`), intercepts planning tool calls
- Calls the corresponding tRPC procedure (createDraft, updateDraft, removeDraft, setDependency)
- Returns the result as a `tool_result` event back to the agent

The handler uses `mapPlanningToolCall` from `planningAgentTools.ts` to translate agent tool names to tRPC procedure calls.

### Task 4.2: List drafts tool response

When the agent calls `list_drafts`, query the planDrafts table and return the current draft list as a formatted tool result.

**Files:**
- Modify: `apps/gateway/src/sessions/planningToolHandler.ts`

**Step 1:** Add `list_drafts` to the tool handler:
- Query `planDrafts` for the session
- Format as a markdown table: `| # | Title | Kind | Priority | Blocked By |`
- Return as tool result

### Verification (Batch 4)
```bash
pnpm --filter @bob/gateway typecheck
pnpm --filter @bob/execution typecheck
# Manual: start planning session, describe a goal
# Manual: verify agent creates drafts that appear in the draft panel
# Manual: verify agent can list and update drafts
```

---

## Batch 5: Polish + Testing

### Task 5.1: Planning session list in sidebar

Show planning sessions separately from execution sessions.

**Files:**
- Modify: `apps/web/src/components/layout/sidebar-nav.tsx`

Add a "Plans" section or badge under the Planning nav item showing active planning sessions count.

### Task 5.2: Commit confirmation and redirect

After committing a plan, show a success screen with links to the created tasks.

**Files:**
- Modify: `apps/web/src/components/planning/draft-panel.tsx`

After `commitPlan` succeeds, show a toast with "Created N tasks" and list their identifiers as links.

### Task 5.3: Unit tests for planSession router

**Files:**
- Create: `packages/api/src/router/__tests__/planSession.test.ts`

Test:
- `create` — creates a chatConversation with sessionType "planning"
- `createDraft` — inserts a plan_drafts row
- `updateDraft` — updates fields
- `removeDraft` — deletes the row
- `setDependency` / `removeDependency` — manages links
- `commitPlan` — marks drafts as committed (mock the planning API call)

Follow the existing test pattern from `session.bootstrap-for-chat.test.ts` — mock the DB, create a caller with auth context.

### Task 5.4: Unit tests for planning agent tools

**Files:**
- Create: `apps/execution/src/planning/__tests__/planningAgentTools.test.ts`

Test:
- `buildPlanningPrompt` — returns string containing workspace/project context
- `mapPlanningToolCall` — maps each tool name to correct procedure + input

### Verification (Batch 5)
```bash
pnpm --filter @bob/api test -- planSession
pnpm --filter @bob/execution test -- planningAgentTools
pnpm --filter @bob/web typecheck
```

---

## Key Files Reference

### New files
| File | Batch | Purpose |
|------|-------|---------|
| `packages/api/src/router/planSession.ts` | 1 | Plan session + draft CRUD router |
| `apps/execution/src/planning/planningAgentTools.ts` | 2 | Tool definitions + prompt builder |
| `apps/execution/src/planning/startPlanningSession.ts` | 2 | Session start orchestrator |
| `apps/web/src/components/planning/draft-panel.tsx` | 3 | Draft tasks panel |
| `apps/web/src/app/(dashboard)/planning/review/[sessionId]/page.tsx` | 3 | Plan review page |
| `apps/web/src/components/planning/start-planning-button.tsx` | 3 | "Plan with Bob" trigger |
| `apps/gateway/src/sessions/planningToolHandler.ts` | 4 | Tool call interceptor |
| `packages/api/src/router/__tests__/planSession.test.ts` | 5 | Router tests |
| `apps/execution/src/planning/__tests__/planningAgentTools.test.ts` | 5 | Tool mapping tests |

### Modified files
| File | Batch | Change |
|------|-------|--------|
| `packages/db/src/schema.ts` | 1 | Add sessionType column, plan_drafts + plan_draft_dependencies tables |
| `packages/api/src/root.ts` | 1 | Register planSession router |
| `apps/web/src/components/chat/chat-panel.tsx` | 3 | Show draft panel for planning sessions |
| `apps/web/src/app/(dashboard)/planning/page.tsx` | 3 | Add "Plan with Bob" button |
| `apps/web/src/app/(dashboard)/projects/[projectId]/page.tsx` | 3 | Add "Plan with Bob" button |
| `apps/web/src/components/layout/sidebar-nav.tsx` | 5 | Planning sessions badge |

### Existing patterns to follow
- **tRPC router:** `packages/api/src/router/project.ts` — simple CRUD with protectedProcedure
- **Planning API calls:** `packages/api/src/router/planning.ts` lines 58-100 — planningMutation helper
- **Session creation:** `packages/api/src/router/session.ts` lines 234-259 — create procedure
- **Test setup:** `packages/api/src/router/__tests__/session.bootstrap-for-chat.test.ts` — DB mock + caller pattern
- **UI components:** `apps/web/src/components/work-items/create-work-item-dialog.tsx` — dialog + tRPC mutation pattern
