# linear-clone Task Integration (Bob) — Design + Implementation Plan (2026-01-13)

## Phase 2 — Bob Changes

### 2.1 Webhook receiver (linear-clone → Bob)

**Goal:** Accept `task.assigned` events from linear-clone and start an execution session.

**Endpoint**

- Add: `backend/src/routes/linear-task-webhooks.ts`
- Mount from: `backend/src/server.ts`
  - `app.use('/api/webhooks', createLinearTaskWebhookRoutes(...))`

Route(s):

- `POST /api/webhooks/task-assigned`
  - Receives `event: task.assigned` payload.

**Security**

- Verify HMAC signature if provided.
- Environment variables:
  - `LINEAR_CLONE_WEBHOOK_SECRET` (shared secret configured in linear-clone outbound webhook settings)

Signature verification (match linear-clone conventions):

- Header: `X-Webhook-Signature: sha256=<hex>`
- Header: `X-Webhook-Timestamp: <iso-string>`
- Signature input (MVP): `HMAC_SHA256(secret, rawBody)`
  - If linear-clone includes timestamp in signature later, update to: `HMAC_SHA256(secret, timestamp + '.' + rawBody)`.

Implementation notes:
- Use `express.raw({ type: 'application/json' })` for this route so you can compute HMAC over the exact raw bytes.
- Fallback (dev): allow unsigned requests if `LINEAR_CLONE_WEBHOOK_SECRET` is unset.

**Validation**

- Validate minimal shape using zod (or manual):
  - `task.id`, `task.identifier`, `project.repositoryUrl`, `workspaceId`, `assignee.isAgent === true`
- Reject non-agent assignments (Bob should ignore tasks not targeted to Bob).

**Complexity:** M

**Dependencies:** DB schema (2.2)

---

### 2.2 Database schema additions (SQLite)

**Goal:** Persist the link between linear-clone tasks and Bob execution sessions, including progress history.

**Migration**

- Add: `backend/src/database/migrations/011_linear_task_sessions.ts`
  - Follow existing numbered migration pattern (`010_api_keys.ts`).

Tables:

```sql
CREATE TABLE IF NOT EXISTS task_sessions (
  id TEXT PRIMARY KEY,
  linear_task_id TEXT NOT NULL,
  linear_workspace_id TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  branch TEXT,
  status TEXT NOT NULL, -- starting|running|completed|failed|blocked
  container_id TEXT,
  instance_id TEXT,
  opencode_session_id TEXT,
  agent_session_url TEXT,
  pr_url TEXT,
  error TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_sessions_linear_task_id ON task_sessions(linear_task_id);
CREATE INDEX IF NOT EXISTS idx_task_sessions_status ON task_sessions(status);

CREATE TABLE IF NOT EXISTS session_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES task_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_progress_session_id ON session_progress(session_id);
```

**ID strategy**

- Use a stable opaque string for `task_sessions.id`:
  - e.g. `sess_<random>` or reuse OpenCode session id if available.

**Complexity:** S

**Dependencies:** none

---

### 2.3 Task executor service (container spawning + state tracking)

**Goal:** Turn a `task.assigned` webhook into an active execution session and keep `task_sessions` updated.

**Leverage what exists**

Bob already has strong primitives:

- Git/worktrees: `backend/src/services/git.ts`
- Agent lifecycle: `backend/src/services/agent.ts` + `backend/src/services/agent-auth.ts`
- Docker-based agent containers (Gateway): `apps/gateway/src/index.ts` (`ensureContainer`, session proxy)

**Recommended MVP design (single clear path)**

- Implement `TaskExecutor` in the backend that:
  1. Ensures the repository exists in Bob and is cloned.
  2. Creates a dedicated worktree/branch for the task.
  3. Starts an OpenCode agent session using the existing Gateway session system.
  4. Writes status + progress into `task_sessions` and `session_progress`.

**Where to implement**

- Add: `backend/src/services/linear-task-executor.ts`
- Add: `backend/src/services/task-sessions.ts` (thin DB access layer)
- Modify: `backend/src/server.ts`
  - Construct and inject executor into webhook route.

**Branch naming**

- Deterministic and collision-safe:
  - `bob/<projectKey>-<number>-<slug>` (e.g. `bob/PROJ-123-add-user-auth`)

**Execution lifecycle (MVP)**

1. On webhook:
   - Create `task_sessions` row:
     - `status = 'starting'`
     - store `repo_url`, `linear_task_id`, `linear_workspace_id`, `branch`
   - Immediately respond `202 Accepted` to linear-clone.
2. Async background job (in-process for MVP):
   - Ensure repo exists (clone if missing).
   - Create worktree + checkout branch.
   - Start OpenCode session:
     - Option A (preferred): call Gateway to create a session (agentType=`opencode`, cwd=worktree path).
     - Option B: start a local opencode process via existing AgentService if Gateway isn’t in the deployment.
   - Update `task_sessions`:
     - `status = 'running'`
     - `opencode_session_id = ...`
     - `agent_session_url = https://bob.internal/#/tasks/<sessionId>`
   - Post initial progress update back to linear-clone (Phase 2.4).

**State transitions**

| From | To | Trigger |
|------|----|---------|
| starting | running | OpenCode session established |
| running | blocked | missing secrets, failing CI prerequisites, human input needed |
| running | completed | PR merged / task done |
| running | failed | unrecoverable error |

**Concurrency control**

- Enforce “one session per linear task”:
  - Unique by `linear_task_id` where `status IN ('starting','running')`.
  - If webhook duplicates arrive, return the existing session id.

**Complexity:** L

**Dependencies:** 2.2 (DB)

---

### 2.4 API client (Bob → linear-clone progress updates)

**Goal:** Post structured updates to `task.updateFromAgent` with API key auth.

**Where to implement**

- Add: `backend/src/services/linear-clone-client.ts`

**Configuration**

- `LINEAR_CLONE_BASE_URL=https://linear-clone.internal`
- `LINEAR_CLONE_API_KEY=lc_...`

**Client methods**

- `postProgress({ taskId, summary, agentSessionId, agentSessionUrl })`
- `postBlocked({ taskId, summary, agentSessionId })`
- `postCompleted({ taskId, summary, prUrl, agentSessionId })`

**Implementation notes**

- Use `fetch` with:
  - `X-API-Key: <key>`
  - `Content-Type: application/json`
- Timeout: 10–30s.
- Retries: exponential backoff for 5xx/timeouts (but not for 4xx).

**Complexity:** M

**Dependencies:** none (can stub early)

---

### 2.5 API endpoints for session visibility (Bob UI)

**Goal:** Allow users and linear-clone to deep-link to a session detail page in Bob.

**Backend endpoints**

- Add: `backend/src/routes/task-sessions.ts`
  - `GET /api/task-sessions?status=running&limit=50`
  - `GET /api/task-sessions/:id`
  - `GET /api/task-sessions/:id/progress?limit=200`

**Complexity:** M

**Dependencies:** 2.2

---

### 2.6 Session detail UI (drill-down)

**Goal:** A stable URL that shows:
- task metadata (identifier/title)
- current status
- progress feed
- links: repo, branch, PR, OpenCode session

**Recommended placement (reuse existing frontend)**

Bob’s primary UI is the Vite React app:
- Router: `frontend/src/App.tsx`

**Where to implement**

- Modify: `frontend/src/App.tsx`
  - Add routes:
    - `/tasks/:sessionId`
    - optionally `/tasks` list
- Add: `frontend/src/components/TaskSessions/TaskSessionsList.tsx`
- Add: `frontend/src/components/TaskSessions/TaskSessionDetail.tsx`
- Add: `frontend/src/api.ts`
  - Add client methods calling the new backend endpoints.

**Deep link format (what gets stored in linear-clone)**

- `agentSessionUrl`: `https://bob.internal/tasks/<sessionId>` (or `https://bob.internal/#/tasks/<sessionId>` depending on router setup)

**Complexity:** M

**Dependencies:** 2.5

---

## Phase 2 task breakdown + dependencies

| Task | Description | Files | Depends on | Complexity |
|------|-------------|-------|------------|------------|
| 2.1 | Webhook receiver + signature verify | `backend/src/routes/linear-task-webhooks.ts`, `backend/src/server.ts` | 2.2 | M |
| 2.2 | SQLite migrations for task sessions | `backend/src/database/migrations/011_linear_task_sessions.ts` | — | S |
| 2.3 | TaskExecutor orchestration | `backend/src/services/linear-task-executor.ts` | 2.2, 2.4 | L |
| 2.4 | linear-clone API client | `backend/src/services/linear-clone-client.ts` | — | M |
| 2.5 | Backend API for UI session visibility | `backend/src/routes/task-sessions.ts` | 2.2 | M |
| 2.6 | Frontend session detail pages | `frontend/src/App.tsx`, `frontend/src/components/TaskSessions/*` | 2.5 | M |

---

## Operational notes (MVP)

- Webhook receiver should be fast and return `202` quickly; do heavy work async.
- For MVP, in-process background jobs are acceptable; revisit a queue only if:
  - multiple hosts, need persistence across restarts, or tasks regularly exceed process lifetime.
- Store enough metadata in `task_sessions` to allow manual recovery (repo/worktree/branch/sessionId).
