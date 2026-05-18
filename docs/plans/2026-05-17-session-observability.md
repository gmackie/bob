# Session Observability & Autonomous Dispatch Traceability

**Date:** 2026-05-17
**Status:** Complete (all 7 steps implemented)
**Goal:** Full end-to-end visibility into autonomous agent sessions — what's running, what finished, what failed, and why. Every session is either a planning session (generating work items) or an execution session tied to a work item.

## Problem

The autonomous dispatch pipeline works (98 GTM issues created, 20 executed via cursor-agent), but there is zero visibility:

1. **Nodes page** shows only `gmackie` (1 node). `hetzner-bob` exists in `workspaces` but is owned by `default-user`, not the logged-in user — invisible in the UI.
2. **Runs page** queries `agent_runs` table (7 old test entries). Real sessions live in `chat_conversations` (50+ runs today). The Runs page shows nothing.
3. **Recent Activity** queries `activities` (work_item_activities). Autonomous sessions don't write activity records. Empty.
4. **No graceful shutdown** — when `systemctl restart` kills the runner, sessions stay in `running`/`starting` forever. No retry, no timeout detection.
5. **No work item linkage** — autonomous sessions are inserted directly into `chat_conversations` with no `work_item_id`, making them invisible to work-item-centric views.

## Architecture (Current)

```
┌─────────────┐     WS      ┌──────────────────┐     DB      ┌──────────────┐
│ ooda-runner  │◄───────────►│ bob-ws-gateway   │◄───────────►│ PostgreSQL   │
│ (hetzner-bob)│  session_   │ (hetzner-master) │             │              │
│              │  available  │                  │             │ chat_conver- │
│ cursor/claude│  claimed    │ Dispatches       │             │ sations      │
│ agents       │  status     │ pending sessions │             │ session_     │
│              │  events     │ on daemon hello  │             │ events       │
└─────────────┘             └──────────────────┘             │ agent_runs   │
                                                              │ work_items   │
┌─────────────┐                                               │ activities   │
│ Blder UI    │◄── tRPC ── queries agent_runs, activities ───►└──────────────┘
│ (bob.blder. │    (both tables empty for autonomous work)
│  bot)       │
└─────────────┘
```

### Two data paths, zero overlap

| What happens | Where it's stored | What the UI queries |
|---|---|---|
| Session created | `chat_conversations` | `agent_runs` (different table) |
| Session state changes | `session_events` | `activities` (different table) |
| Session output | `session_events.output_chunk` | Not surfaced |
| Node heartbeat | WS `hello_ok` only | `workspaces.last_heartbeat` (not updated by ooda-runner) |
| BizPulse report | External POST | Not surfaced |

## Design

### Principle: Sessions ARE runs

Stop maintaining two parallel tracking systems. `chat_conversations` already has the session lifecycle. Instead of writing to `agent_runs` separately, make the Runs page query `chat_conversations` directly (or bridge the two at write time).

**Decision: Bridge at write time.** When the gateway processes session status changes, also write to `agent_runs` and `activities`. This keeps the existing UI components working without rewriting every query.

### Principle: Every session has a work item

Enforce that sessions are always one of:
- **Planning sessions** (`sessionType = 'planning'`) — research/strategy that produces work items
- **Execution sessions** (`sessionType = 'execution'`) — must have a `workItemId`

For autonomous dispatch, this means: before creating execution sessions, first create or find the matching work item in Bob's `work_items` table (synced from Linear or created inline).

## Implementation Steps

### Step 1: Fix Node Registration (hetzner-bob visible in UI)

**Files:** `apps/bob-ws-gateway/src/relay.ts`, DB migration

1. Add `hetzner-bob` workspace to Graham's membership: `INSERT INTO workspace_members` with Graham's user ID
2. Update the ws-gateway to write `last_heartbeat` on the workspace when a daemon sends `hello` — currently only verified against `user` auth, doesn't update the workspace heartbeat
3. The ooda-runner already sends `hello` with `workspaceId` — use that to identify and update the workspace

**Result:** hetzner-bob appears on the Nodes page with a green dot and "just now" heartbeat.

### Step 2: Bridge Sessions → Agent Runs

**Files:** `apps/bob-ws-gateway/src/relay.ts`

When the gateway handles `session_claimed` / `session_status` messages from daemons:

1. On `session_claimed` → create an `agent_runs` row (`status: 'running'`, `started_at: now()`)
2. On `session_status: completed` → update `agent_runs` to `completed`, set `completed_at`, write `summary` JSON
3. On `session_status: error` → update `agent_runs` to `failed`, write error to `summary`

Map from `chat_conversations` to `agent_runs`:
- `work_item_id` ← `chat_conversations.work_item_id` (or session title as fallback for planning sessions)
- `workspace_id` ← from the daemon's workspace
- `agent_type` ← `chat_conversations.agent_type`
- `agent_config` ← `chat_conversations.persona_metadata`

**Result:** Runs page shows all autonomous sessions with correct status, duration, and agent type.

### Step 3: Bridge Sessions → Activities

**Files:** `apps/bob-ws-gateway/src/relay.ts`

When session status changes, also write to the `activities` table:

1. `status_changed` activity when session transitions (pending → running → completed/failed)
2. Link to `work_item_id` so the activity feed shows the work item context

Activity schema: `{ workItemId, type: 'status_changed', fromValue, toValue, createdAt }`

**Result:** Recent Activity feed populates with session lifecycle events.

### Step 4: Work Item Creation for Autonomous Sessions

**Files:** `apps/bob-ws-gateway/src/relay.ts` or new dispatch helper

When creating execution sessions (like the GTM batch), ensure each session has a corresponding `work_items` row:

1. For Linear-sourced issues: sync the Linear issue to `work_items` before creating the session
2. For inline/manual sessions: create a work item with the session title

Add a `dispatch.createBatch` tRPC endpoint that:
- Takes a list of Linear issue IDs (or inline task descriptions)
- Creates/syncs `work_items` for each
- Creates `chat_conversations` with `workItemId` set
- Returns a batch ID for tracking

**Result:** Every execution session is linked to a work item. Planning sessions generate work items as output.

### Step 5: Graceful Shutdown & Retry

**Files:** `apps/ooda-runner/src/bob-gateway.ts`

1. **On SIGTERM:** Before killing agent processes, send `session_status: interrupted` for each active session
2. **Gateway handles `interrupted`:** Sets `chat_conversations.status = 'interrupted'`, `agent_runs.status = 'failed'` with summary `{ reason: 'interrupted', retryable: true }`
3. **On reconnect:** Gateway sends `interrupted` sessions back as `session_available` (same as pending recovery) — effectively auto-retry
4. **Max retries:** Add `retry_count` column to `chat_conversations`. Gateway skips sessions with retry_count >= 3
5. **Timeout detection:** Gateway runs a periodic sweep (every 60s) — any session in `running` state for > 35 minutes (agent timeout is 30min) gets marked `failed` with `{ reason: 'timeout' }`

**Result:** Service restarts don't leave zombie sessions. Failed sessions auto-retry up to 3 times.

### Step 6: Node Detail Page (click into hetzner-bob)

**Files:** `apps/bob/src/app/(dashboard)/nodes/[machineId]/page.tsx`

The page already exists but needs data. Add a `workspace.getByMachineId` or enhance existing query to return:

1. Node status (online/offline based on heartbeat)
2. Active sessions (running `chat_conversations` for this workspace)
3. Recent completed/failed sessions (last 20)
4. Agent capacity (max concurrent from config)
5. Agent types available (from runner registration)

Wire the existing `session_events` data to show real-time output for running sessions.

**Result:** Click hetzner-bob → see 2 agents running, 16 completed, 4 failed, with drill-down to each session's output.

### Step 7: Session Detail View

**Files:** `apps/bob/src/app/(dashboard)/runs/[runId]/page.tsx`

The page exists but queries `agentRun.get`. Enhance to also show:

1. Session events timeline (from `session_events`)
2. Agent output (stdout/stderr chunks)
3. Error details if failed
4. BizPulse report status (from persona_metadata)
5. Work item link
6. Retry button (sets status back to pending)

## Migration / DB Changes

```sql
-- 1. Fix hetzner-bob workspace membership
INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES ('8f495e47-8638-453e-bf38-aa2d948585fe', 'tkE66fMc4mevdYYjtq78ALErJ7QnhAge', 'owner')
ON CONFLICT DO NOTHING;

-- 2. Add retry tracking to chat_conversations
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS interrupted_at timestamp with time zone;

-- 3. Add session_id FK to agent_runs for bridging
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES chat_conversations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS agent_runs_session_idx ON agent_runs(session_id);

-- 4. Add interrupted to agent_run_status enum
ALTER TYPE agent_run_status ADD VALUE IF NOT EXISTS 'interrupted' AFTER 'failed';
```

## Sequence (priority order)

1. **Step 1** — Fix node registration (5 min, DB + one gateway line) → hetzner-bob visible
2. **Step 2** — Bridge sessions → agent_runs (30 min, gateway relay changes) → Runs page works
3. **Step 5** — Graceful shutdown + retry (30 min, runner + gateway) → no more zombie sessions
4. **Step 3** — Bridge sessions → activities (15 min, gateway) → Activity feed works
5. **Step 4** — Work item creation for dispatch (45 min, new endpoint) → full traceability
6. **Step 6** — Node detail page (30 min, UI) → click into nodes
7. **Step 7** — Session detail view (30 min, UI) → drill into individual runs

Total: ~3 hours of implementation. Steps 1-3 are the critical path.

## Out of Scope

- Linear webhook for real-time issue sync (can be added later)
- BizPulse dashboard integration (BizPulse already receives reports)
- Multi-workspace dispatch (only one workspace per runner for now)
- Cost tracking / token counting per session (future enhancement)
