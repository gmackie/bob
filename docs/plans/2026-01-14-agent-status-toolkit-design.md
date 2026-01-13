# Agent Status Toolkit Design — 2026-01-14

## Overview

Enable OpenCode agents to report progress and interact with Bob's infrastructure in real-time via MCP tools and composable skills. Agents can update status, manage PRs, interact with Kanbanger tasks, and handle the "awaiting input" pattern with auto-proceed defaults.

## Architecture

**Two packages working together:**

```
packages/mcp-server/          # Existing - extend with Bob tools
├── src/
│   ├── tools/
│   │   ├── status.ts         # update_status, request_input, mark_blocked
│   │   ├── tasks.ts          # get_task, link_task, complete_task
│   │   ├── prs.ts            # create_pr, update_pr, get_pr_status
│   │   └── context.ts        # get_session, get_task_context, list_prs
│   └── index.ts              # Server setup, tool registration

packages/bob-agent-toolkit/   # New - skills, prompts, config
├── skills/
│   ├── status-updates/       # When/how to report progress
│   ├── pr-workflow/          # PR creation and management
│   ├── task-management/      # Kanbanger interaction
│   └── awaiting-input/       # 30min timeout pattern
├── prompts/
│   └── bob-persona.md        # Base system prompt for Bob agent
└── config/
    └── opencode.json.template  # MCP server config for users
```

**Multi-MCP Architecture:**

The agent has access to multiple MCP servers:

| MCP Server          | Purpose                        | Source                               |
| ------------------- | ------------------------------ | ------------------------------------ |
| `bob-mcp`           | Status, sessions, PRs, context | `packages/mcp-server`                |
| `kanbanger-mcp`     | Task management, comments      | External (tasks.gmac.io)             |
| `control-panel-mcp` | Deployments, infrastructure    | `../control-panel/apps/mcp` (future) |

**Data flow:**

```
OpenCode Agent
    ↓ (uses skill instructions)
    ↓ (calls MCP tools)
Bob MCP Server
    ↓ (authenticated API calls)
Bob Backend (tRPC)
    ↓
Neon DB + Kanbanger API
```

## Session State Machine

```
┌─────────────┐
│   STARTED   │
└──────┬──────┘
       ↓
┌─────────────┐ ←─────────────────────────────────┐
│   WORKING   │ ←──────────────────────┐          │
└──────┬──────┘                        │          │
       │                               │          │
       ├───→ AWAITING_INPUT ───────────┘          │
       │     (timeout/response)                   │
       │                                          │
       ├───→ BLOCKED ──────────────────┘          │
       │     (human unblocks)                     │
       │                                          │
       └───→ AWAITING_REVIEW ─────────────────────┘
             (changes requested)
                    │
                    ↓ (approved + CI passes)
             ┌─────────────┐
             │  COMPLETED  │
             └─────────────┘
```

**Transitions:**

- `WORKING` → `AWAITING_INPUT` | `BLOCKED` | `AWAITING_REVIEW`
- `AWAITING_INPUT` → `WORKING` (only)
- `BLOCKED` → `WORKING` (only)
- `AWAITING_REVIEW` → `WORKING` | `COMPLETED`

**State Definitions:**

| State             | Behavior                             | Kanbanger                | Bob UI                 |
| ----------------- | ------------------------------------ | ------------------------ | ---------------------- |
| `WORKING`         | Normal progress                      | Silent                   | Shows activity         |
| `AWAITING_INPUT`  | Has question, auto-proceeds in 30min | Posts question + default | Prominent, respondable |
| `BLOCKED`         | Cannot continue without human        | Posts blocker            | Prominent, respondable |
| `AWAITING_REVIEW` | PR submitted, waiting for approval   | Posts PR link            | Shows review status    |
| `COMPLETED`       | PR merged or task done               | Posts summary            | Archived               |

## Database Changes

Add to `chat_conversations`:

```sql
ALTER TABLE chat_conversations ADD COLUMN status_message TEXT;
ALTER TABLE chat_conversations ADD COLUMN awaiting_input_question TEXT;
ALTER TABLE chat_conversations ADD COLUMN awaiting_input_default TEXT;
ALTER TABLE chat_conversations ADD COLUMN awaiting_input_expires_at TIMESTAMP;
```

## MCP Server Tools

All tools are session-scoped. Session ID injected via environment variable.

### Status Tools

```typescript
update_status(
  status: "working" | "awaiting_input" | "blocked" | "awaiting_review" | "completed",
  message: string,
  details?: { phase?: string, progress?: string }
)

request_input(
  question: string,
  options?: string[],
  default_action: string,
  timeout_minutes?: number  // Default 30
)

mark_blocked(reason: string)

submit_for_review(pr_id: string, message?: string)
```

### Context Tools

```typescript
get_session() → { id, status, task_id, pr_id, branch, history[] }

get_task_context() → { id, identifier, title, description, comments[], labels[] }

get_session_history(limit?: number) → { events[] }

list_prs(status?: "draft" | "open" | "merged") → { prs[] }
```

### PR Tools

```typescript
create_pr(title: string, body: string, draft?: boolean) → { pr_id, url, number }

update_pr(pr_id: string, { title?, body?, draft? })

get_pr_status(pr_id: string) → { status, checks, reviews[], comments[] }

merge_pr(pr_id: string, method?: "squash" | "merge" | "rebase")
```

### Task Tools

```typescript
link_task(kanbanger_task_id: string)

complete_task(summary: string)

post_task_comment(body: string)
```

## Session ID Injection

MCP server config includes session ID from environment:

```json
{
  "mcpServers": {
    "bob": {
      "command": "npx",
      "args": ["@bob/mcp-server"],
      "env": {
        "BOB_API_URL": "https://api.bob.app",
        "BOB_API_KEY": "${BOB_API_KEY}",
        "BOB_SESSION_ID": "${SESSION_ID}"
      }
    }
  }
}
```

## Skills Structure

### `bob/status-updates`

Instructs agent to:

- Call `update_status("working", message)` after significant steps
- Call `request_input(question, default)` when uncertain but can proceed
- Call `mark_blocked(reason)` only when truly stuck
- Post to Kanbanger on key moments only

### `bob/pr-workflow`

Instructs agent to:

- Create draft PR after first meaningful commit
- Update PR description as scope clarifies
- Call `submit_for_review(pr_id)` when ready
- Address review comments, transition back to working
- Call `merge_pr()` after approval + CI green

### `bob/task-management`

Instructs agent to:

- Check for linked task at session start
- Use task description/comments as requirements
- Call `post_task_comment()` for key updates only
- Call `complete_task(summary)` when PR merges

### `bob/awaiting-input`

Instructs agent to:

- Formulate question + default action for ambiguous decisions
- Call `request_input(question, options, default, 30)`
- Continue other work if possible while waiting
- After timeout or response, proceed accordingly
- Never escalate awaiting_input to blocked

## Kanbanger Integration

**When Bob posts comments:**

| Event           | Format                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Started         | "🤖 Bob started working on this task"                                                          |
| Awaiting Input  | "💭 Question: {question}\n\nI'll proceed with **{default}** in 30 minutes unless you respond." |
| Blocked         | "🚫 Blocked: {reason}\n\nI need your input to continue."                                       |
| PR Created      | "🔗 Draft PR opened: {url}"                                                                    |
| Awaiting Review | "👀 PR ready for review: {url}"                                                                |
| Completed       | "✅ Completed\n\n{summary}\n\nPR merged: {url}"                                                |

**Listening for responses:**

When `comment.created` webhook arrives on linked task:

1. Find session via `task_runs.kanbangerIssueId`
2. If session is `awaiting_input` or `blocked`:
   - Inject comment as user message to agent
   - Transition to `working`
   - Cancel timeout timer if applicable

## Implementation Phases

### Phase 1: MCP Server Foundation

- Extend `packages/mcp-server` with new tool structure
- Add status tools: `update_status`, `request_input`, `mark_blocked`
- Add context tools: `get_session`, `get_task_context`
- Add session ID injection from environment
- Database: add status columns to `chat_conversations`

### Phase 2: PR & Task Tools

- Add PR tools: `create_pr`, `update_pr`, `get_pr_status`, `submit_for_review`, `merge_pr`
- Add task tools: `link_task`, `complete_task`, `post_task_comment`, `list_prs`
- Wire tools to existing `prService` and `taskExecutor`

### Phase 3: Awaiting Input Flow

- Implement 30-minute timeout mechanism
- Add `awaiting_input_*` columns to schema
- Kanbanger webhook: detect response, inject to agent
- Bob UI: show awaiting input sessions, allow response

### Phase 4: bob-agent-toolkit Package

- Create `packages/bob-agent-toolkit`
- Write skills: `status-updates`, `pr-workflow`, `task-management`, `awaiting-input`
- Add `opencode.json.template` with multi-MCP config
- Add base prompts

### Phase 5: Integration Testing

- End-to-end: task → working → awaiting input → response → PR → review → merge
- Test timeout auto-proceed behavior
- Test response via Kanbanger vs Bob UI
