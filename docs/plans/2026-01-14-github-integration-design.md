# GitHub Integration Design (Bob) — 2026-01-14

## Overview

Enable OAuth login via GitHub, GitLab, and Gitea. Track PRs and commits created by Bob in Postgres for display in web/mobile apps. Integrate with Kanbanger for task management.

## Authentication

### OAuth Providers (via better-auth)

- **GitHub** - covers github.com repos
- **GitLab** - covers gitlab.com + self-hosted GitLab  
- **Gitea** - covers self-hosted Gitea instances

### Scopes Required

| Provider | Scopes |
|----------|--------|
| GitHub | `repo`, `read:user`, `user:email` |
| GitLab | `api`, `read_user`, `read_repository`, `write_repository` |
| Gitea | `repo`, `user` |

### Mobile OAuth Flow

Single OAuth app per provider with web proxy redirect:

1. Mobile app opens system browser to `https://bob.app/api/auth/{provider}`
2. State parameter includes `mobile=true` flag
3. After OAuth completes, server detects mobile flag
4. Server responds with redirect to `bob://auth/callback?code=...`
5. Mobile browser hands off to Bob app via deep link

This avoids needing separate OAuth apps for web vs mobile.

## Data Model

### New Tables

```sql
-- Link user accounts to git hosts
git_providers (
  id UUID PRIMARY KEY,
  user_id TEXT REFERENCES user(id),
  provider VARCHAR(20) NOT NULL, -- 'github' | 'gitlab' | 'gitea'
  provider_account_id TEXT NOT NULL,
  access_token TEXT NOT NULL, -- encrypted
  refresh_token TEXT, -- encrypted
  instance_url TEXT, -- null for github.com/gitlab.com, set for self-hosted
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(user_id, provider, instance_url)
)

-- PR tracking with session/task links
pull_requests (
  id UUID PRIMARY KEY,
  repository_id UUID REFERENCES repositories(id),
  session_id UUID REFERENCES chat_conversations(id), -- nullable
  kanbanger_task_id TEXT, -- auto-created or pre-existing
  pr_number INTEGER NOT NULL,
  branch TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  status VARCHAR(20) NOT NULL, -- 'draft' | 'open' | 'merged' | 'closed'
  remote_url TEXT NOT NULL,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  merged_at TIMESTAMP
)

-- Commit history with Bob attribution
commits (
  id UUID PRIMARY KEY,
  repository_id UUID REFERENCES repositories(id),
  pull_request_id UUID REFERENCES pull_requests(id), -- nullable
  sha VARCHAR(40) NOT NULL UNIQUE,
  message TEXT NOT NULL,
  author_name TEXT,
  author_email TEXT,
  is_bob_commit BOOLEAN DEFAULT false,
  session_id UUID REFERENCES chat_conversations(id), -- nullable
  committed_at TIMESTAMP
)
```

### Modify Existing Tables

```sql
-- repositories: add remote tracking
ALTER TABLE repositories ADD COLUMN git_provider_id UUID REFERENCES git_providers(id);
ALTER TABLE repositories ADD COLUMN remote_owner TEXT;
ALTER TABLE repositories ADD COLUMN remote_name TEXT;
ALTER TABLE repositories ADD COLUMN remote_url TEXT;

-- chat_conversations: add PR/task linking
ALTER TABLE chat_conversations ADD COLUMN git_branch TEXT;
ALTER TABLE chat_conversations ADD COLUMN pull_request_id UUID REFERENCES pull_requests(id);
ALTER TABLE chat_conversations ADD COLUMN kanbanger_task_id TEXT;
ALTER TABLE chat_conversations ADD COLUMN blocked_reason TEXT;
```

## Branch Naming Convention

Format: `bob/{session-short-id}/{slugified-prompt}`

Example: `bob/a1b2c3/add-user-authentication`

Short ID keeps it readable, slug gives context in git log.

## PR Lifecycle Flows

### Flow A: User Starts Chat Directly

1. User opens Bob, starts chatting
2. Bob makes changes, commits locally
3. On first push: Bob creates draft PR via git provider API
4. Insert `pull_requests` row with `session_id` linked
5. As work progresses, Bob recognizes coherent feature
6. Bob creates Kanbanger task with meaningful title/summary
7. CI passes + Greptile approves → auto-merge
8. Update `pull_requests.status = 'merged'`

### Flow B: Kanbanger Task Assigned to Bob

1. Webhook received from Kanbanger (`task.assigned`)
2. Bob creates session, links `kanbanger_task_id` upfront
3. Bob works, commits, creates draft PR
4. Insert `pull_requests` row with both `session_id` and `kanbanger_task_id`
5. Post progress updates to Kanbanger
6. CI passes + Greptile approves → auto-merge

### Commit Tracking

After each push:
1. Fetch commit list for branch via git provider API
2. Upsert `commits` rows
3. Mark `is_bob_commit=true` for commits from Bob session
4. Non-Bob commits on same branch get `is_bob_commit=false`

## UI: Repo View (Commit History)

Primary view for understanding what happened to code.

```
Repository: acme/backend
Branch: main (default) [dropdown]

PR #47: Add user authentication (merged 2h ago)
├── Prompt: "Add JWT-based auth with refresh tokens"
├── Status: ✅ Merged │ Files: +342 -28 │ 4 commits
├── Task: ACME-123 (link to Kanbanger)
└── [Expand commits]
    ├── a1b2c3 "feat: add auth middleware" (Bob)
    ├── d4e5f6 "feat: add login endpoint" (Bob)
    └── ...

PR #45: Fix pagination bug (merged 1d ago)
├── Prompt: "The /users endpoint returns wrong count"
└── ...

Commits not in PRs:
├── m3n4o5 "chore: update deps" (manual)
```

**Filtering options:**
- All commits vs Bob commits only
- By date range
- By PR status (open/merged/closed)

## UI: Active Sessions (Web + Mobile)

```
Active Sessions (2)

Session: "Add OAuth login flow"
├── Status: 🟢 Running │ Repo: acme/backend
├── Branch: bob/a1b2c3/add-oauth-login
├── Task: ACME-156 (linked)
├── Last activity: 2m ago
└── [Open Chat] [Stop]

Session: "Fix memory leak in worker"
├── Status: 🟡 Blocked - Needs input
├── Question: "Should I use WeakMap or manual cleanup?"
└── [Reply] [Open Chat]
```

## Mobile Experience

**Scope:** Light interaction (not full chat parity)

**Features:**
- Push notifications for "Blocked - Needs input" status
- Quick reply inline for blocked sessions
- PR approval actions (approve/request changes)
- View-only for chat history

**Notification Flow (Blocked Sessions):**

1. Bob hits decision point, sets `status = 'blocked'`, `blocked_reason = '...'`
2. Bob posts comment to Kanbanger task
3. If user has Bob push notifications enabled → send push
4. User replies via Bob app or Kanbanger comment
5. Bob receives reply, resumes work

Users who use Kanbanger can mute Bob notifications and just see updates there.

## Integration with Existing Infrastructure

### Gateway Enhancements

SessionActor gains new callbacks:
- `onPRCreated(prId, prUrl)`
- `onTaskCreated(taskId)`
- `onBlocked(reason)`

Gateway calls backend services (which have OAuth tokens) for git provider APIs.

### New Services

```
packages/api/src/services/git-provider.ts
├── createPullRequest(userId, repoId, branch, title, body)
├── getPullRequest(userId, repoId, prNumber)
├── listCommits(userId, repoId, branch)
├── mergePullRequest(userId, repoId, prNumber)
└── (handles GitHub/GitLab/Gitea API differences internally)

packages/api/src/services/pr-tracker.ts
├── trackPR(sessionId, prData)
├── syncCommits(repoId, branch)
├── linkToTask(prId, taskId)
└── updatePRStatus(prId, status)
```

### Webhook Receivers

```
POST /api/webhooks/github   - PR merged/closed, push events
POST /api/webhooks/gitlab   - same
POST /api/webhooks/gitea    - same
POST /api/webhooks/kanbanger - task.assigned, comment.created
```

## Implementation Phases

### Phase 1: OAuth + Git Provider Foundation
- Add GitHub/GitLab/Gitea OAuth to better-auth
- Create `git_providers` table
- Mobile redirect handling
- Git provider service (API abstraction)

### Phase 2: PR Tracking
- Create `pull_requests`, `commits` tables
- Modify `repositories`, `chat_conversations`
- PR creation on first push
- Commit sync after push

### Phase 3: Kanbanger Integration
- Auto-create task when PR has enough context
- Link existing tasks to sessions/PRs
- Blocked session → Kanbanger comment
- Webhook receiver for task.assigned, comment.created

### Phase 4: UI
- Repo commit history view (web)
- Active sessions list (web)
- Mobile app: sessions, quick reply, PR actions

### Phase 5: Webhooks + Auto-merge
- Git provider webhooks for PR status changes
- Update local state on merge/close
- Greptile integration for auto-merge trigger
