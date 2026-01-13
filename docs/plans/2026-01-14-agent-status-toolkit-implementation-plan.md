# Agent Status Toolkit (Bob MCP) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Give OpenCode agents session-scoped MCP tools to report progress, manage PRs/tasks, and implement an “awaiting input” workflow that can be resolved via Kanbanger comments or Bob UI.

**Architecture:** Extend the existing `@bob/mcp-server` to expose session-scoped tools (session resolved from `BOB_SESSION_ID`). Add a workflow-state layer on top of existing session lifecycle (`chat_conversations.status`) with durable DB fields + `session_events` broadcasts. Implement the 30-minute awaiting-input timeout as a backend-managed mechanism, with resolution via webhook/UI.

**Tech Stack:** TypeScript, tRPC (`packages/api`), Drizzle schema (`packages/db`), Next.js UI (`apps/nextjs`), MCP TS SDK (`@modelcontextprotocol/sdk`).

---

## Guiding Principles / Constraints

- **Session-scoped by default:** Every MCP tool resolves `sessionId` from `process.env.BOB_SESSION_ID` (optionally allow override via tool args for debugging).
- **Two state layers (recommended):**
  - **Lifecycle status** (already exists): `chat_conversations.status` = `provisioning|starting|running|idle|stopping|stopped|error`.
  - **Workflow status** (new): `chat_conversations.workflowStatus` = `started|working|awaiting_input|blocked|awaiting_review|completed`.
    This avoids breaking existing UI logic and makes the new state machine explicit.
- **State machine (workflowStatus):**
  - `started → working`
  - `working → awaiting_input | blocked | awaiting_review | completed`
  - `awaiting_input → working`
  - `blocked → working`
  - `awaiting_review → working | completed`
- **Awaiting-input pattern:**
  - Stores question/options/default/expiry on the session.
  - Posts a single Kanbanger comment (if session has `kanbangerTaskId`).
  - After 30 minutes: auto-proceed with default action by injecting a message into the agent session.
- **Multi-MCP:** Agents will run with `bob-mcp` + `kanbanger-mcp` now; `control-panel-mcp` later.

---

## Phase 0 — Final Decisions + Scaffolding (pre-work)

### Task 0.1: Confirm workflow state model and naming (≤ 1h)

**Depends on:** none

**Decision points (recommendations in bold):**

- **Add `workflowStatus` column** vs reuse `chat_conversations.status`.
  - Recommended: add `workflowStatus`.
- Awaiting-input expiry runner location:
  - Option A (recommended): **Next.js route/cron-style runner** (easy to deploy + scale, explicit ownership).
  - Option B: gateway interval runner (fast locally, but gateway currently has TODO persistence and may not be the best “source of truth”).

**Output:** short ADR section at top of this plan (or inline notes) confirming decisions.

**Testing notes:** none.

---

## Phase 1 — Database Schema (workflow + awaiting-input fields)

### Task 1.1: Add workflow + awaiting-input columns to `chat_conversations` (1–2h)

**Depends on:** Task 0.1

**Files:**

- Modify: `packages/db/src/schema.ts`
- Create (recommended): `packages/db/drizzle/2026_01_14_agent_status_toolkit/migration.sql` (generated or hand-written)

**Drizzle schema changes (TypeScript):**

```ts
// packages/db/src/schema.ts
export const workflowStatusEnum = [
  "started",
  "working",
  "awaiting_input",
  "blocked",
  "awaiting_review",
  "completed",
] as const;
export type WorkflowStatus = (typeof workflowStatusEnum)[number];

export const chatConversations = pgTable("chat_conversations", (t) => ({
  // ...existing columns...

  // Workflow layer (new)
  workflowStatus: t.varchar({ length: 30 }).notNull().default("started"),
  statusMessage: t.text(),

  // Awaiting-input (new)
  awaitingInputQuestion: t.text(),
  awaitingInputOptions: t.json().$type<string[]>(),
  awaitingInputDefault: t.text(),
  awaitingInputExpiresAt: t.timestamp({ mode: "date", withTimezone: true }),
  awaitingInputResolvedAt: t.timestamp({ mode: "date", withTimezone: true }),
  awaitingInputResolution: t
    .json()
    .$type<{ type: "human" | "timeout"; value: string }>(),
}));
```

Notes:

- `awaitingInputResolution` is optional but makes audits/debugging easier.
- `awaitingInputOptions` stored as JSON simplifies tool schemas.

**SQL migration (exact):**

```sql
ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(30) NOT NULL DEFAULT 'started';

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS status_message TEXT;

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS awaiting_input_question TEXT;

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS awaiting_input_options JSONB;

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS awaiting_input_default TEXT;

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS awaiting_input_expires_at TIMESTAMPTZ;

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS awaiting_input_resolved_at TIMESTAMPTZ;

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS awaiting_input_resolution JSONB;
```

**Testing / verification:**

- Run: `pnpm -F @bob/db push`
- Run: `pnpm -F @bob/db typecheck`
- Spot check in DB (via Drizzle Studio): `pnpm -F @bob/db studio` and verify the new columns exist.

---

### Task 1.2: Add helpful indexes for workflow queries (1–2h)

**Depends on:** Task 1.1

**Files:**

- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/2026_01_14_agent_status_toolkit_indexes/migration.sql`

**Recommended indexes:**

- Sessions awaiting input (for runner): `(workflow_status, awaiting_input_expires_at)`
- Sessions by task: `(kanbanger_task_id)` already used; add if missing

**SQL migration (exact):**

```sql
CREATE INDEX IF NOT EXISTS chat_conversations_workflow_expires_idx
  ON chat_conversations (workflow_status, awaiting_input_expires_at);

CREATE INDEX IF NOT EXISTS chat_conversations_kanbanger_task_idx
  ON chat_conversations (kanbanger_task_id);
```

**Testing / verification:**

- Run: `pnpm -F @bob/db push`

---

## Phase 2 — API: Workflow State + Awaiting-Input Resolution

### Task 2.1: Create an API service for workflow updates (1–2h)

**Depends on:** Phase 1

**Files:**

- Create: `packages/api/src/services/sessions/workflowStatusService.ts`
- Modify: `packages/api/src/router/session.ts` (or add a new router `packages/api/src/router/agentStatus.ts` + register in `packages/api/src/root.ts`)

**Service responsibilities:**

- Validate allowed state transitions.
- Update `chat_conversations` fields (`workflowStatus`, `statusMessage`, awaiting-input fields).
- Emit a `session_events` entry with `eventType="state"` and a stable payload shape.
- Optionally post a Kanbanger comment via `addCommentToKanbangerIssue()` when transitioning to awaiting/block/review/completed.

**Key types + signatures:**

```ts
// packages/api/src/services/sessions/workflowStatusService.ts
import { z } from "zod/v4";

export const workflowStatusSchema = z.enum([
  "started",
  "working",
  "awaiting_input",
  "blocked",
  "awaiting_review",
  "completed",
]);

export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;

export interface ReportWorkflowStatusInput {
  sessionId: string;
  status: WorkflowStatus;
  message: string;
  details?: { phase?: string; progress?: string };
}

export async function reportWorkflowStatus(
  userId: string,
  input: ReportWorkflowStatusInput,
): Promise<void>;

export interface RequestInputInput {
  sessionId: string;
  question: string;
  options?: string[];
  defaultAction: string;
  timeoutMinutes?: number; // default 30
}

export async function requestInput(
  userId: string,
  input: RequestInputInput,
): Promise<{ expiresAt: Date }>; // for UI display

export interface ResolveAwaitingInputInput {
  sessionId: string;
  resolution: { type: "human" | "timeout"; value: string };
  clearQuestion?: boolean; // default true
}

export async function resolveAwaitingInput(
  userId: string,
  input: ResolveAwaitingInputInput,
): Promise<void>;
```

**Session event payload shape (recommended):**

```ts
// eventType: "state"
{
  type: "workflow_status",
  workflowStatus: "awaiting_input",
  message: "Need a decision on X",
  details: { phase: "Phase 2", progress: "2/5" },
  awaitingInput: {
    question: string,
    options?: string[],
    defaultAction: string,
    expiresAt?: string,
  } | null,
}
```

**Testing / verification:**

- Run: `pnpm -F @bob/api typecheck`
- Manual: call `session.recordEvent`/new endpoints through tRPC playground (or via MCP once Phase 3 lands) and confirm `apps/nextjs` chat view shows the `state` event.

---

### Task 2.2: Add tRPC endpoints for agent status tools (1–2h)

**Depends on:** Task 2.1

**Files:**

- Modify: `packages/api/src/router/session.ts` (recommended: colocate with session ops)

**Add procedures (recommended names):**

- `session.reportWorkflowStatus`
- `session.requestInput`
- `session.resolveAwaitingInput`

**Auth/permissions (recommended):**

- Use API keys with write permission for agent-triggered mutations.
- Keep UI access working.

Implementation approach:

- Add a helper middleware in `packages/api/src/trpc.ts`:
  - `writeCapableProcedure`: allows either authenticated user session OR API key with `write|admin`.
  - Use that for these procedures.

**Testing / verification:**

- Run: `pnpm -F @bob/api lint` and `pnpm -F @bob/api typecheck`
- Manual: call procedures with a `gmk_` API key (write) and ensure it succeeds.

---

### Task 2.3: Kanbanger webhook “awaiting input” resolution (1–2h)

**Depends on:** Task 2.1

**Files:**

- Modify: `apps/nextjs/src/app/api/webhooks/kanbanger/route.ts`
- Modify: `apps/nextjs/src/lib/tasks/taskExecutor.ts` (optional, if you want to reuse existing resume logic)

**Goal:** When a comment arrives on a linked Kanbanger task and the session is in `workflowStatus=awaiting_input` or `workflowStatus=blocked`, treat that comment as a response and transition back to `working`.

**Implementation notes:**

- Find session by `chat_conversations.kanbangerTaskId` (preferred) or via `task_runs.kanbangerIssueId`.
- If awaiting input:
  - call `session.resolveAwaitingInput({ resolution: { type: "human", value: comment.body } })`
  - inject comment into agent via existing gateway endpoint `POST /session/send` (see `packages/api/src/services/tasks/taskExecutor.ts` usage).

**Testing / verification:**

- Manual: send a synthetic Kanbanger webhook payload (locally) for comment.created and verify:
  - DB fields are cleared/resolved
  - agent receives injected message
  - UI updates

---

## Phase 3 — MCP Server: Tool Refactor + Session-Scoped Tools

### Task 3.1: Refactor MCP server tool registry into `src/tools/*` (1–2h)

**Depends on:** Phase 2 (for endpoints) but can start earlier

**Files:**

- Modify: `packages/mcp-server/src/index.ts`
- Create: `packages/mcp-server/src/tools/context.ts`
- Create: `packages/mcp-server/src/tools/status.ts`
- Create: `packages/mcp-server/src/tools/prs.ts`
- Create: `packages/mcp-server/src/tools/tasks.ts`
- Create: `packages/mcp-server/src/tools/trpc.ts` (shared `callTrpc`)
- Create: `packages/mcp-server/src/tools/session.ts` (shared `requireSessionId()`)

**Key code snippets:**

```ts
// packages/mcp-server/src/tools/session.ts
export function requireSessionId(args?: { session_id?: string }): string {
  const fromArgs = args?.session_id;
  const fromEnv = process.env.BOB_SESSION_ID;
  const sessionId = fromArgs ?? fromEnv;

  if (!sessionId)
    throw new Error(
      "Missing session id: set BOB_SESSION_ID or pass session_id",
    );
  return sessionId;
}
```

```ts
// packages/mcp-server/src/tools/trpc.ts
const API_URL = process.env.BOB_API_URL ?? "http://localhost:3000";
const API_KEY = process.env.BOB_API_KEY;

export async function callTrpc<T>(path: string, input?: unknown): Promise<T> {
  // existing implementation, but shared
}
```

**Testing / verification:**

- Run: `pnpm -F @bob/mcp-server typecheck`
- Run: `pnpm -F @bob/mcp-server lint`

---

### Task 3.2: Implement Status tools (`update_status`, `request_input`, `mark_blocked`, `submit_for_review`) (1–2h)

**Depends on:** Task 2.2 + Task 3.1

**Files:**

- Modify: `packages/mcp-server/src/tools/status.ts`

**Tool schemas (inputs):**

```ts
update_status({
  session_id?: string,
  status: "working" | "awaiting_input" | "blocked" | "awaiting_review" | "completed",
  message: string,
  details?: { phase?: string; progress?: string },
})

request_input({
  session_id?: string,
  question: string,
  options?: string[],
  default_action: string,
  timeout_minutes?: number,
})

mark_blocked({ session_id?: string, reason: string })

submit_for_review({ session_id?: string, pr_id: string, message?: string })
```

**Backend mapping:**

- `update_status` → `session.reportWorkflowStatus`
- `request_input` → `session.requestInput`
- `mark_blocked` → `session.reportWorkflowStatus({status:"blocked"})`
- `submit_for_review` → `session.reportWorkflowStatus({status:"awaiting_review"})` + optionally Kanbanger comment

**Testing / verification:**

- Manual: run MCP server locally with env vars:
  - `BOB_API_URL`, `BOB_API_KEY`, `BOB_SESSION_ID`
  - call tools and verify DB updates + UI renders.

---

### Task 3.3: Implement Context tools (`get_session`, `get_task_context`, `get_session_history`, `list_prs`) (1–2h)

**Depends on:** Task 3.1, and (for task context) Kanbanger router existing

**Files:**

- Modify: `packages/mcp-server/src/tools/context.ts`

**Implementation approach:**

- `get_session`: call `session.get` tRPC endpoint.
- `get_session_history`: call `session.getEvents` (limit/filter client-side).
- `list_prs`: call `pullRequest.listBySession`.
- `get_task_context`: if `session.kanbangerTaskId` is set, call `kanbanger.getTask` (via Bob API router) and `kanbanger.listComments`.

**Testing / verification:**

- Manual: ensure tool output is stable JSON (pretty printed).

---

### Task 3.4: Implement PR tools as thin wrappers over existing tRPC (1–2h)

**Depends on:** Task 3.1

**Files:**

- Modify: `packages/mcp-server/src/tools/prs.ts`

**Tools:**

- `create_pr(title, body, draft?)` → call `pullRequest.create` using session’s repo + branch context (see notes below)
- `update_pr(pr_id, {title?, body?, draft?})` → `pullRequest.update`
- `get_pr_status(pr_id)` → `pullRequest.get` + `pullRequest.refresh` (+ include checks/reviews if available from provider client)
- `merge_pr(pr_id, method?)` → `pullRequest.merge`

**Important note:** The current `pullRequest.create` requires `repositoryId` and `headBranch`.

- Recommended: `create_pr` MCP tool should derive:
  - `repositoryId` from `session.repositoryId`
  - `headBranch` from `session.gitBranch`
  - `kanbangerTaskId` from `session.kanbangerTaskId`

**Testing / verification:**

- Manual: create draft PR, confirm:
  - `chat_conversations.pullRequestId` is set (already done by `prService.createDraftPr`)
  - session emits a `state` event (already done by `gitRouter.pushAndCreatePr`, but PR router may need similar event emission if you want consistency).

---

### Task 3.5: Implement Task tools (`link_task`, `post_task_comment`, `complete_task`) (1–2h)

**Depends on:** Phase 2 + Task 3.1

**Files:**

- Modify: `packages/mcp-server/src/tools/tasks.ts`

**Tools:**

- `link_task(kanbanger_task_id)`
  - Update `chat_conversations.kanbangerTaskId`
  - Optionally create/update `worktree_links` entry
- `post_task_comment(body)`
  - Use `addCommentToKanbangerIssue()` via a new Bob API tRPC wrapper OR call existing `kanbanger.addComment` router
- `complete_task(summary)`
  - Transition `workflowStatus` to `completed`
  - If `task_runs` exists: mark it `completed` (existing `completeTask()` in task executor)
  - Post completion comment to Kanbanger with summary + PR URL if present

**Testing / verification:**

- Manual: link a task, post comment, complete and verify DB + Kanbanger.

---

## Phase 4 — Awaiting-Input Timeout Runner (Auto-proceed)

### Task 4.1: Implement an awaiting-input expiry runner (1–2h)

**Depends on:** Phase 2 (resolution functions) + Phase 3 (for event payload stability)

**Files (Option A — recommended):**

- Create: `apps/nextjs/src/app/api/cron/awaiting-input/route.ts`
- Create: `packages/api/src/services/sessions/awaitingInputRunner.ts`

**Runner algorithm (exact):**

1. Query sessions where:
   - `workflow_status = 'awaiting_input'`
   - `awaiting_input_expires_at <= now()`
   - `awaiting_input_resolved_at IS NULL`
2. For each:
   - set `awaiting_input_resolved_at = now()`
   - set `awaiting_input_resolution = { type: "timeout", value: awaiting_input_default }`
   - set `workflow_status = 'working'` (or keep awaiting_input but inject default; recommended: go to working)
   - inject a message into the agent via gateway `/session/send`:
     - `"No response received; proceeding with default: <default>"`

**Files (Option B — gateway interval runner):**

- Create: `apps/gateway/src/sessions/AwaitingInputScheduler.ts`
- Modify: `apps/gateway/src/index.ts` (wire scheduler)

**Testing / verification:**

- Manual: set awaiting-input with a 1-minute timeout and confirm auto-proceed fires.

---

### Task 4.2: Ensure Kanbanger comment resolution cancels auto-proceed (1–2h)

**Depends on:** Task 2.3 + Task 4.1

**Files:**

- Modify: `packages/api/src/services/sessions/workflowStatusService.ts`

**Behavior:**

- When resolving awaiting input via human comment or UI:
  - set `awaiting_input_resolved_at`
  - clear/retain question fields (recommended: keep for history but mark resolved)
  - ensure runner ignores resolved sessions

**Testing / verification:**

- Manual: set awaiting input, then comment; verify runner does not auto-respond.

---

## Phase 5 — Bob UI: Awaiting-Input Widget + Workflow Badges

### Task 5.1: Add workflowStatus display to session header (1–2h)

**Depends on:** Phase 1

**Files:**

- Modify: `apps/nextjs/src/app/chat/_components/session-header.tsx`

**Implementation notes:**

- Keep existing lifecycle badge (`running/idle/...`).
- Add a second badge for workflow (`working/awaiting_input/...`).
- Map:
  - `working` → neutral/blue
  - `awaiting_input` → amber
  - `blocked` → red
  - `awaiting_review` → purple
  - `completed` → green

**Testing / verification:**

- Run: `pnpm -F @bob/nextjs typecheck`
- Manual: confirm visuals for each workflow state.

---

### Task 5.2: Render “Awaiting input” UI in message stream (1–2h)

**Depends on:** Phase 2 (event payload)

**Files:**

- Modify: `apps/nextjs/src/app/chat/_components/message-stream.tsx`

**UI behavior:**

- When last known workflow state is `awaiting_input`:
  - Show question, options, default, expiry countdown.
  - Provide:
    - “Use default” button
    - “Respond” input + submit

**Action wiring:**

- Call new tRPC mutation: `session.resolveAwaitingInput({ resolution: { type: "human", value } })`.
- Also inject the response to agent via gateway `/session/send` (so agent receives it immediately).

**Testing / verification:**

- Manual: verify the UI can resolve awaiting input and transitions back to working.

---

## Phase 6 — `packages/bob-agent-toolkit`: Skills + Config Templates

### Task 6.1: Create toolkit package skeleton (1–2h)

**Depends on:** none

**Files:**

- Create: `packages/bob-agent-toolkit/package.json`
- Create: `packages/bob-agent-toolkit/skills/status-updates/README.md`
- Create: `packages/bob-agent-toolkit/skills/pr-workflow/README.md`
- Create: `packages/bob-agent-toolkit/skills/task-management/README.md`
- Create: `packages/bob-agent-toolkit/skills/awaiting-input/README.md`
- Create: `packages/bob-agent-toolkit/prompts/bob-persona.md`
- Create: `packages/bob-agent-toolkit/config/opencode.json.template`

**Content requirements:**

- Skills must explicitly instruct the agent to call `bob-mcp` tools at each state transition.
- `opencode.json.template` includes multiple MCP servers:

```json
{
  "mcpServers": {
    "bob": {
      "command": "npx",
      "args": ["@bob/mcp-server"],
      "env": {
        "BOB_API_URL": "https://<your-bob-host>",
        "BOB_API_KEY": "${BOB_API_KEY}",
        "BOB_SESSION_ID": "${BOB_SESSION_ID}"
      }
    },
    "kanbanger": {
      "command": "npx",
      "args": ["@tasks-gmac/mcp"],
      "env": { "KANBANGER_API_KEY": "${KANBANGER_API_KEY}" }
    }
  }
}
```

**Testing / verification:**

- Smoke test: ensure files render correctly in repo and are referenced by Bob’s docs.

---

## Phase 7 — End-to-End Verification Checklist

### Task 7.1: Manual end-to-end flow (1–2h)

**Depends on:** Phases 1–6

**Happy path:**

1. Start a session (task assignment or manual).
2. Agent calls `update_status("working")`.
3. Agent calls `request_input(...)` and UI shows the question.
4. Resolve via:
   - Kanbanger comment webhook, OR
   - Bob UI respond button.
5. Agent continues, creates PR, calls `submit_for_review`.
6. Human approves; agent merges PR (optional automated merge).
7. Agent calls `complete_task(summary)`.

**What to validate:**

- DB columns updated correctly.
- `session_events` show `state` entries for each transition.
- UI reflects workflow status promptly.
- Auto-proceed after timeout works and doesn’t fire if resolved.

**Commands:**

- `pnpm typecheck`
- `pnpm lint`

---

## Notes on Implementation Ordering / Dependencies

- You can implement Phase 3 (MCP refactor) in parallel with Phase 2, but the status tools won’t work until tRPC endpoints exist.
- UI work (Phase 5) depends on DB fields + event payload shape being stable.
- Awaiting-input runner (Phase 4) should be added after `request_input` and `resolveAwaitingInput` exist.

---

## Open Questions (track explicitly)

- Should MCP “status tools” also update `task_runs.status` (in addition to workflowStatus)? If yes, define mapping carefully.
- What is the canonical way to inject a message into the agent session outside of task unblock (`/session/send`)? Reuse `gatewayRequest(..., "/session/send", ...)` everywhere.
- Should PR creation emit a standardized `session_events` `state` event from `pullRequest.create` (similar to `git.pushAndCreatePr`)?
