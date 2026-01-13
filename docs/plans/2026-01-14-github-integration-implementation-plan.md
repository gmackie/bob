# GitHub Integration Implementation Plan — 2026-01-14

## Design Unification

Replace legacy "linear-clone task sessions" with **SaaS-native architecture**:
- `chatConversations` = session record (already exists)
- `taskRuns` = durable lifecycle for Kanbanger assignments (assigned → running → blocked → merged/failed)
- `worktreeLinks` = lightweight cross-linking (worktree ↔ task, worktree ↔ PR)
- First-class `pull_requests` + `git_commits` tables for repo-centric history

Consolidate progress updates into one mechanism:
- `session_events` for realtime clients
- Kanbanger comments for external visibility
- Push notifications for mobile
- All driven from single "session state machine" service

---

## Phase 0 — Decisions + Scaffolding

### 0.1 Self-hosted Support Strategy
**Decision**: Support `github.com` + `gitlab.com` OAuth; self-hosted GitLab/Gitea via PAT connection flow.
**Later**: Admin-configured OAuth clients per instance URL (if needed).
**Complexity**: M

### 0.2 Background Job Runner
**MVP**: Webhook-first, minimal polling via Vercel Cron for backfill.
**Scale**: Add worker + Postgres-backed queue (pg-boss) for retries/DLQ.
**Complexity**: M/L

---

## Phase 1 — Database Schema

### 1.1 `git_provider_connections` (encrypted tokens)

```typescript
export const gitProviderConnections = pgTable("git_provider_connections", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
  provider: t.varchar({ length: 20 }).notNull(), // 'github' | 'gitlab' | 'gitea'
  instanceUrl: t.text(), // null for github.com/gitlab.com
  providerAccountId: t.text().notNull(),
  scopes: t.text(),
  accessTokenCiphertext: t.text().notNull(),
  accessTokenIv: t.text().notNull(),
  accessTokenTag: t.text().notNull(),
  refreshTokenCiphertext: t.text(),
  refreshTokenIv: t.text(),
  refreshTokenTag: t.text(),
  accessTokenExpiresAt: t.timestamp({ mode: "date", withTimezone: true }),
  refreshTokenExpiresAt: t.timestamp({ mode: "date", withTimezone: true }),
  revokedAt: t.timestamp({ mode: "date", withTimezone: true }),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
}));
// Unique: (userId, provider, instanceUrl, providerAccountId)
// Index: (userId, provider)
```
**Complexity**: M

### 1.2 `pull_requests`

```typescript
export const pullRequests = pgTable("pull_requests", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
  repositoryId: t.uuid().references(() => repositories.id, { onDelete: "set null" }),
  provider: t.varchar({ length: 20 }).notNull(),
  instanceUrl: t.text(),
  remoteOwner: t.text().notNull(),
  remoteName: t.text().notNull(),
  number: t.integer().notNull(),
  headBranch: t.text().notNull(),
  baseBranch: t.text().notNull(),
  title: t.text().notNull(),
  body: t.text(),
  status: t.varchar({ length: 20 }).notNull(), // 'draft' | 'open' | 'merged' | 'closed'
  url: t.text().notNull(),
  sessionId: t.uuid().references(() => chatConversations.id, { onDelete: "set null" }),
  kanbangerTaskId: t.text(),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  mergedAt: t.timestamp({ mode: "date", withTimezone: true }),
}));
// Unique: (provider, instanceUrl, remoteOwner, remoteName, number)
// Index: (repositoryId, updatedAt), (sessionId)
```
**Complexity**: M

### 1.3 `git_commits`

```typescript
export const gitCommits = pgTable("git_commits", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  repositoryId: t.uuid().references(() => repositories.id, { onDelete: "set null" }),
  provider: t.varchar({ length: 20 }).notNull(),
  instanceUrl: t.text(),
  remoteOwner: t.text().notNull(),
  remoteName: t.text().notNull(),
  sha: t.varchar({ length: 40 }).notNull(),
  message: t.text().notNull(),
  authorName: t.text(),
  authorEmail: t.text(),
  committedAt: t.timestamp({ mode: "date", withTimezone: true }).notNull(),
  pullRequestId: t.uuid().references(() => pullRequests.id, { onDelete: "set null" }),
  sessionId: t.uuid().references(() => chatConversations.id, { onDelete: "set null" }),
  isBobCommit: t.boolean().notNull().default(false),
}));
// Unique: (provider, instanceUrl, remoteOwner, remoteName, sha)
```
**Complexity**: M

### 1.4 `webhook_deliveries` (idempotency + audit)

```typescript
export const webhookDeliveries = pgTable("webhook_deliveries", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  provider: t.varchar({ length: 20 }).notNull(),
  deliveryId: t.text(), // X-GitHub-Delivery, X-Gitea-Delivery
  eventType: t.varchar({ length: 50 }).notNull(),
  action: t.varchar({ length: 50 }),
  signatureValid: t.boolean().notNull(),
  headers: t.json().$type<Record<string, string>>(),
  payload: t.json().$type<Record<string, unknown>>().notNull(),
  status: t.varchar({ length: 20 }).notNull().default("pending"), // 'pending' | 'processed' | 'failed'
  errorMessage: t.text(),
  retryCount: t.integer().notNull().default(0),
  nextRetryAt: t.timestamp({ mode: "date", withTimezone: true }),
  receivedAt: t.timestamp().defaultNow().notNull(),
}));
// Unique: (provider, deliveryId) where deliveryId is not null
```
**Complexity**: M

### 1.5 `task_runs` (Kanbanger execution tracking)

```typescript
export const taskRuns = pgTable("task_runs", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
  kanbangerWorkspaceId: t.text().notNull(),
  kanbangerIssueId: t.text().notNull(),
  kanbangerIssueIdentifier: t.text().notNull(),
  sessionId: t.uuid().references(() => chatConversations.id, { onDelete: "set null" }),
  repositoryId: t.uuid().references(() => repositories.id, { onDelete: "set null" }),
  worktreeId: t.uuid().references(() => worktrees.id, { onDelete: "set null" }),
  status: t.varchar({ length: 20 }).notNull(), // 'starting' | 'running' | 'blocked' | 'completed' | 'failed'
  blockedReason: t.text(),
  pullRequestId: t.uuid().references(() => pullRequests.id, { onDelete: "set null" }),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  completedAt: t.timestamp({ mode: "date", withTimezone: true }),
}));
```
**Complexity**: M

### 1.6 Modify `repositories`

Add columns:
- `remoteUrl`, `remoteProvider`, `remoteOwner`, `remoteName`, `remoteInstanceUrl`
- `gitProviderConnectionId` (nullable FK)

**Complexity**: S/M

---

## Phase 2 — Auth + Token Vault + Provider API

### 2.1 Better-auth Provider Expansion
**Files**: `packages/auth/src/index.ts`, `apps/nextjs/src/auth/server.ts`
- Add GitLab social provider (built-in)
- Gitea: use generic OAuth or defer to PAT flow
- Keep oAuthProxy + expo deep link flow
**Complexity**: M

### 2.2 Token Encryption (Vault)
**Create**: `packages/api/src/services/crypto/tokenVault.ts`
- AES-256-GCM with per-record random IV
- Store `(ciphertext, iv, tag)` in DB columns
- Master key from env: `GIT_TOKEN_ENCRYPTION_KEY`
- HKDF per-row key derivation: `HKDF(masterKey, salt=connectionId)`
**Complexity**: M

### 2.3 Provider Connection Service
**Create**:
- `packages/api/src/services/git/providerConnectionService.ts`
- `packages/api/src/services/git/providers/github.ts`
- `packages/api/src/services/git/providers/gitlab.ts`
- `packages/api/src/services/git/providers/gitea.ts`

Responsibilities:
- Load connection for `(userId, provider, instanceUrl)`
- Refresh token if `accessTokenExpiresAt < now + 5min`
- Normalize remote repo identity
**Complexity**: L

### 2.4 tRPC Router for Connections
**Create**: `packages/api/src/router/gitProviders.ts`
- `listConnections`, `connectPat`, `disconnect`, `setDefaultForRepo`, `testConnection`
**Complexity**: M

---

## Phase 3 — Webhooks Ingestion

### 3.1 Webhook Endpoints
**Create**:
- `apps/nextjs/src/app/api/webhooks/github/route.ts`
- `apps/nextjs/src/app/api/webhooks/gitlab/route.ts`
- `apps/nextjs/src/app/api/webhooks/gitea/route.ts`
- `apps/nextjs/src/app/api/webhooks/kanbanger/route.ts`

Each does:
- Read raw body, validate signature, extract delivery ID
- Write `webhook_deliveries` row (dedupe)
- Trigger processing
**Complexity**: M

### 3.2 Verification Strategy

| Provider | Header | Format |
|----------|--------|--------|
| GitHub | `X-Hub-Signature-256` | `sha256=<hex>` HMAC-SHA256 |
| GitLab | `X-Gitlab-Token` | Shared secret (constant-time compare) |
| Gitea | `X-Gitea-Signature` | `<hex>` HMAC-SHA256 (no prefix) |

**Complexity**: S

### 3.3 Processing Pipeline
**Create**: `packages/api/src/services/webhooks/processWebhook.ts`
- Parse → normalize → update domain tables
- Emit session events / notifications
- Idempotency via `(provider, deliveryId)`
**Complexity**: L

### 3.4 Backfill/Polling (Hybrid Sync)
**Create**: `apps/nextjs/src/app/api/cron/git-sync/route.ts`
- Poll provider API for repos with open PRs
- Catches missed webhooks
**Complexity**: M

---

## Phase 4 — PR Creation + Repo UI

### 4.1 PR Creation Service
**Create**: `packages/api/src/services/git/prService.ts`
- `createDraftPr({userId, repositoryId, sessionId, headBranch, baseBranch, title, body})`
- `updatePr`, `mergePr`
**Complexity**: M/L

### 4.2 tRPC Router for PRs
**Create**: `packages/api/src/router/pullRequest.ts`
- `listByRepository`, `listBySession`, `get`, `syncCommits`, `linkToKanbangerTask`
**Complexity**: M

### 4.3 Integrate PR Creation with Push
**Modify**: `packages/api/src/router/git.ts`
- Add `pushAndCreatePr` or extend `push`
- On success: create draft PR if none exists, emit session event
**Complexity**: M

### 4.4 Repo-centric UI
**Create**:
- `apps/nextjs/src/app/repositories/[repositoryId]/page.tsx`
- `apps/nextjs/src/app/repositories/[repositoryId]/_components/pr-timeline.tsx`
- `apps/nextjs/src/app/repositories/[repositoryId]/_components/commit-list.tsx`
**Complexity**: M/L

### 4.5 Session UI Enhancements
**Modify**: `apps/nextjs/src/app/chat/…`
- Show linked PR + task in session header
**Complexity**: S/M

---

## Phase 5 — Kanbanger Integration

### 5.1 Kanbanger Webhook Receiver
**Create**: `apps/nextjs/src/app/api/webhooks/kanbanger/route.ts`
- `task.assigned`: create `task_runs` + session + provision worktree
- `comment.created`: append reply to blocked session
**Complexity**: L

### 5.2 Task Executor Orchestration
**Create**: `packages/api/src/services/tasks/taskExecutor.ts`
- Ensure repo/worktree exists
- Create branch: `bob/{sessionIdShort}/{slug}`
- Start session, link `task_runs.sessionId`
**Complexity**: L

### 5.3 PR → Task Auto-create ("Enough Context")
**Create**:
- `packages/api/src/services/tasks/contextHeuristics.ts`
- `packages/api/src/services/tasks/taskAutoCreate.ts`

**3-Layer Gate**:
1. **Hard requirements**: repo + branch + non-trivial diff (>20 LOC or >2 files)
2. **Lifecycle signal**: first push OR PR exists
3. **Quality check**: title not generic, contains domain noun + action verb, summary has ≥2 bullets

**Complexity**: L

### 5.4 Task → PR Flow
- Executor starts session
- PR created on first push (Phase 4)
- Report PR to Kanbanger via `kanbanger.addComment`
**Complexity**: M

---

## Phase 6 — Mobile

### 6.1 Push Notification Infrastructure
**Recommended**: Expo Push Notifications

**Schema add**: `device_push_tokens`
```typescript
export const devicePushTokens = pgTable("device_push_tokens", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
  deviceType: t.varchar({ length: 20 }).notNull(),
  expoPushToken: t.text().notNull(),
  enabled: t.boolean().notNull().default(true),
  lastSeenAt: t.timestamp({ mode: "date", withTimezone: true }),
  createdAt: t.timestamp().defaultNow().notNull(),
}));
```

**Create**: `packages/api/src/services/notifications/push.ts`
- Send "blocked", "PR ready", "merged" notifications
**Complexity**: M

### 6.2 Deep Linking Scheme

| URL | Purpose |
|-----|---------|
| `bob://auth/callback?...` | OAuth callback |
| `bob://session/{sessionId}` | Open session |
| `bob://repo/{repositoryId}` | Open repo view |
| `bob://pr/{provider}/{owner}/{repo}/{number}` | Open PR |

**Implement in**: `apps/expo/app.json` + `apps/expo/src/utils/linking.ts`
**Complexity**: S

### 6.3 Offline Quick Replies
- Store drafts + queued sends in AsyncStorage
- Retry with backoff when online
- Idempotency via `clientInputId`
**Implement in**: `apps/expo/src/app/session/[id].tsx`
**Complexity**: M

---

## Key Technical Decisions

### Token Encryption at Rest
- AES-256-GCM with per-record random IV
- Per-row key derivation: `HKDF(masterKey, connectionId)`
- Master key from `GIT_TOKEN_ENCRYPTION_KEY` env var

### Token Refresh for Long-running Sessions
- Centralize in `providerConnectionService.ensureValidAccessToken()`
- Refresh if `accessTokenExpiresAt < now + 5min`
- GitHub OAuth tokens are long-lived (no refresh); GitLab supports refresh

### Webhook Verification
- GitHub: HMAC-SHA256 with `sha256=` prefix
- GitLab: Shared secret comparison
- Gitea: HMAC-SHA256 without prefix
- All use constant-time comparison

### SessionActor → Client PR Communication
- Emit system session event: `{ kind: "pr.created", pullRequestId, url, number, title }`
- Chat UI listens on existing event stream, updates header without polling

### PR/Commit Sync Strategy
- **Hybrid**: Webhooks primary (low latency), polling backfill (reliability)
- `webhook_deliveries` provides idempotency + observability

### "Enough Context" Detection
1. Hard: repo + branch + non-trivial diff
2. Signal: first push OR PR exists
3. Quality: title/summary pass validators (reject "WIP", require domain nouns)

---

## Dependency Graph

```
Phase 0 (Decisions)
    ↓
Phase 1 (Schema) ────────────────────────┐
    ↓                                    │
Phase 2 (Auth + Vault + Provider API) ←──┤
    ↓                                    │
Phase 3 (Webhooks) ←─────────────────────┤
    ↓                                    │
Phase 4 (PR Creation + Repo UI) ←────────┤
    ↓                                    │
Phase 5 (Kanbanger Integration) ←────────┘
    ↓
Phase 6 (Mobile)
```

Phases 2-5 can be partially parallelized once schema is in place.
