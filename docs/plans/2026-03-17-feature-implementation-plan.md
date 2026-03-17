# Bob Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the 8 remaining features designed in Storybook stories — from PR review UI through screen capture — wiring up the existing data layer to polished frontend components.

**Architecture:** Each feature is a self-contained track that adds UI components, tRPC queries where needed, and schema extensions only when the existing model can't support the feature. Tracks are ordered by dependency — later tracks build on UI patterns and data established by earlier ones.

**Tech Stack:** Next.js 16, React 19, Tailwind 4, tRPC, Drizzle ORM (SQLite), Storybook 10, Radix UI

---

## Dependency Graph

```
Track 1: PR Review UI ─────────────┐
Track 2: Work Item Detail Upgrade ──┤
Track 3: Workspace File Tree ───────┤──→ Track 6: Two-Tier PRs
Track 4: Image Attachments ─────────┤──→ Track 7: Screen Capture
Track 5: BRD/Requirements ─────────┘──→ Track 8: Change Sets (JJ)
```

Tracks 1-5 are independent and can be built in parallel.
Tracks 6-8 depend on earlier tracks.

---

## Track 1: PR Review UI

**What exists:** `pullRequests` table, `pullRequest` tRPC router (get, list, create, update), `forgeBuilds`, `forgeDeployments` tables. No PR-specific UI components.

**What we build:** PR list page, PR detail page with diff view, CI pipeline status, review section.

### Task 1.1: PR List Component

**Files:**
- Create: `apps/web/src/components/pull-requests/pr-list.tsx`
- Create: `apps/web/src/components/pull-requests/pr-list-item.tsx`

**Implementation:**
- Fetch PRs via `trpc.pullRequest.listByRepository`
- Render each PR as a card showing: number, title, branch, author, status, CI check indicator
- CI status derived from latest `forgeBuild` linked through `forgeRevision`
- Link to PR detail page

### Task 1.2: PR Detail Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/pull-requests/[prId]/page.tsx`
- Create: `apps/web/src/components/pull-requests/pr-header.tsx`
- Create: `apps/web/src/components/pull-requests/ci-pipeline.tsx`
- Create: `apps/web/src/components/pull-requests/pr-diff-view.tsx`

**Implementation:**
- Header: PR number, title, branch → base, open/merged status, author, file count, additions/deletions
- CI Pipeline: fetch `forgeBuilds` for the PR's revision, render as checklist (Lint, Test, Build, Deploy) with pass/fail/running status
- Diff view: show changed files list with add/delete counts. Full diff rendering is future work — start with file list + stats.

### Task 1.3: PR Review Section

**Files:**
- Create: `apps/web/src/components/pull-requests/pr-review.tsx`
- Modify: `packages/db/src/schema.ts` — add `prReviews` table (prId, userId, status: "approved"|"changes_requested"|"commented", body, createdAt)
- Modify: `packages/api/src/router/pullRequest.ts` — add `addReview`, `listReviews` procedures

**Implementation:**
- Review cards showing reviewer name, status (approved/changes_requested), comment body
- "Merge" and "Squash and merge" buttons that call `trpc.pullRequest.update` with status "merged"
- Add review form with approve/request changes radio + comment textarea

### Task 1.4: Add PR Navigation

**Files:**
- Modify: `apps/web/src/components/layout/sidebar-nav.tsx` — add "Pull Requests" nav item
- Create: `apps/web/src/app/(dashboard)/pull-requests/page.tsx` — PR list page

**Verification:** Navigate to /pull-requests, see list of PRs. Click one, see detail with CI status and review section.

---

## Track 2: Work Item Detail Upgrade

**What exists:** Work item detail page with title, description, status, comments, and basic artifact links. `workItemArtifacts` table with type, url, metadata fields.

**What we build:** Rich artifact cards (build output, test results, deployments), embedded ForgeGraph section, activity timeline.

### Task 2.1: Artifact Cards Component

**Files:**
- Create: `apps/web/src/components/work-items/artifact-card.tsx`
- Modify: `apps/web/src/components/work-items/work-item-detail-interactive.tsx`

**Implementation:**
- Replace simple artifact links with rich cards showing: icon, role label, title, detail line
- Map artifact types to icons and colors (CHANGE_SET → 🔀, PR → 📋, BUILD → 🏗️, TEST → ✅, DEPLOY → 🚀)
- Grid layout, 2 columns on desktop

### Task 2.2: Enhance ForgeGraph Section

**Files:**
- Modify: `apps/web/src/components/work-items/work-item-detail-interactive.tsx` (ForgeGraphSection)

**Implementation:**
- Already fetches revisions, builds, deployments via tRPC
- Add gate decision card component (already exists as `GateDecisionCard`)
- Show deployment status cards in a 2-column grid (staging + production)
- Add "View PR" link when pullRequestId exists on taskRun

### Task 2.3: Activity Timeline

**Files:**
- Create: `apps/web/src/components/work-items/activity-timeline.tsx`
- Modify: `apps/web/src/components/work-items/work-item-detail-interactive.tsx`

**Implementation:**
- Fetch activities via the existing `activities` table (workItemId, type, details, createdAt)
- Render as vertical timeline with colored dots per event type (status_change → amber, comment → default, build_started → blue, build_passed → emerald, build_failed → rose, deploy → emerald)
- Show latest 10 activities, "Show all" link

**Verification:** Open any task work item, see rich artifact cards, build/deploy status, and activity timeline.

---

## Track 3: Workspace File Tree + Embedded Terminal

**What exists:** Workspace page with metadata cards, run history, session links. Terminal component (xterm.js) in `apps/web/src/components/dashboard/Terminal.tsx`. `filesystem` tRPC router with `list`, `delete`, `search`. No file tree component.

**What we build:** File tree sidebar, embedded terminal panel, git status indicators.

### Task 3.1: File Tree Component

**Files:**
- Create: `apps/web/src/components/workspace/file-tree.tsx`
- Create: `apps/web/src/components/workspace/file-tree-item.tsx`

**Implementation:**
- Fetch directory listing via `trpc.filesystem.list` (already returns path, name, isDirectory, size)
- Recursive tree with expand/collapse for directories
- File icons based on extension (.tsx → React, .ts → TypeScript, .css → style, etc.)
- Click file → future: open in editor/diff view. For now: copy path.

### Task 3.2: Git Status Indicators on File Tree

**Files:**
- Modify: `packages/api/src/router/filesystem.ts` — add `gitStatus` procedure
- Modify: `apps/web/src/components/workspace/file-tree-item.tsx`

**Implementation:**
- New tRPC procedure: run `git status --porcelain` on the workspace path, parse output
- Return array of `{ file, status: "M"|"A"|"D"|"??" }`
- File tree items show colored dot: green (added), amber (modified), red (deleted), gray (untracked)

### Task 3.3: Embedded Terminal in Workspace

**Files:**
- Modify: `apps/web/src/app/(dashboard)/work-items/[workItemId]/workspace/page.tsx`

**Implementation:**
- Import existing `TerminalComponent` from `~/components/dashboard/Terminal.tsx`
- Render in a resizable bottom panel (collapsible, default 300px height)
- Connect to the workspace's active session via existing websocket infrastructure
- Show connection status indicator (green/red dot)

### Task 3.4: Workspace Layout — Split View

**Files:**
- Modify: `apps/web/src/app/(dashboard)/work-items/[workItemId]/workspace/page.tsx`

**Implementation:**
- 3-panel layout: file tree (left, 240px), main content (center, flex), terminal (bottom, resizable)
- Main content shows: task context header, artifact cards, chat messages
- File tree shows workspace worktree files with git status
- Terminal shows live agent output or user terminal

**Verification:** Open a task workspace, see file tree on left with git status dots, main content in center, terminal at bottom.

---

## Track 4: Image Attachments in Chat

**What exists:** Chat with text messages and MCP tool call blocks. `chatMessages` table with role and content fields. No image support.

**What we build:** Image message rendering, image upload button, image display in chat stream.

### Task 4.1: Image Message Schema

**Files:**
- Modify: `packages/db/src/schema.ts` — add `chatAttachments` table (messageId, type: "image"|"file", url, filename, mimeType, width, height, sizeBytes, createdAt)

**Implementation:**
- New table linked to chatMessages via messageId
- URL points to stored file (local filesystem or object storage)
- Width/height for image layout

### Task 4.2: Image Upload API

**Files:**
- Create: `apps/web/src/app/api/upload/route.ts` — Next.js API route for file upload
- Modify: `packages/api/src/router/chat.ts` — add `attachImage` procedure

**Implementation:**
- API route accepts multipart form data, saves to `public/uploads/chat/` (or configurable path)
- Returns URL, dimensions, file size
- tRPC procedure creates chatAttachment record linked to a message

### Task 4.3: Image Message Component

**Files:**
- Create: `apps/web/src/app/(dashboard)/chat/_components/image-message.tsx`
- Modify: `apps/web/src/app/(dashboard)/chat/_components/message-stream.tsx`

**Implementation:**
- ImageMessage component renders image with border radius, click to expand, caption
- Message parser checks for attachments and renders ImageMessage components inline
- Responsive sizing: max 400px width in chat, full size in lightbox

### Task 4.4: Image Upload Button in Composer

**Files:**
- Modify: `apps/web/src/app/(dashboard)/chat/_components/input-composer.tsx`

**Implementation:**
- Add paperclip/image icon button next to send button
- Click opens file picker (accept="image/*")
- Selected image uploads via the API route, then attaches to the next message
- Show image preview thumbnail before sending

**Verification:** Upload an image in chat, see it rendered inline. Bob agent responses can also include images (from screen capture).

---

## Track 5: BRD / Requirements Model

**What exists:** Work items with free-form description. Parent/child hierarchy. No formal requirements model.

**What we build:** Requirements table linked to epics, categorized by layer, trackable per-task.

### Task 5.1: Requirements Schema

**Files:**
- Modify: `packages/db/src/schema.ts` — add `requirements` table (id, workItemId, category: "data"|"api"|"ui"|"infra"|"test", description, status: "pending"|"in_progress"|"done", linkedTaskId, sortOrder, createdAt)

**Implementation:**
- Requirements belong to a work item (typically an epic)
- Each requirement can be linked to the task that implements it
- Category for grouping in the BRD view
- Status tracks independently from task status

### Task 5.2: Requirements tRPC Router

**Files:**
- Create: `packages/api/src/router/requirement.ts`
- Modify: `packages/api/src/root.ts` — register router

**Implementation:**
- Procedures: `list` (by workItemId), `create`, `update`, `delete`, `bulkCreate`, `linkToTask`
- `list` returns requirements grouped by category with completion counts

### Task 5.3: Requirements UI Component

**Files:**
- Create: `apps/web/src/components/work-items/requirements-checklist.tsx`
- Modify: `apps/web/src/components/work-items/work-item-detail-interactive.tsx`

**Implementation:**
- Requirements grouped by category header (DATA LAYER, API LAYER, UI LAYER, etc.)
- Each requirement: checkbox, description text, linked task badge, status indicator
- Progress bar at top showing X/Y complete
- "Add requirement" inline form at bottom of each category
- Only shown on epic and issue work items (not tasks)

### Task 5.4: Auto-Link Requirements to Tasks

**Files:**
- Modify: `packages/api/src/router/requirement.ts` — add `autoLink` procedure

**Implementation:**
- When tasks are created as children of an epic, scan requirement descriptions for keyword matches
- Suggest links (not auto-apply) — UI shows "Link to WI-0043?" buttons
- When a task completes, auto-mark linked requirement as done

**Verification:** Open an epic work item, see requirements grouped by category with progress bar. Link requirements to child tasks, see them checked off as tasks complete.

---

## Track 6: Two-Tier PR Model

**Depends on:** Track 1 (PR Review UI)

**What exists:** Task-level PRs linked to planning items. No feature branch or aggregation concept.

**What we build:** Feature branch management, PR aggregation view, merge-to-main workflow.

### Task 6.1: Feature Branch Schema

**Files:**
- Modify: `packages/db/src/schema.ts` — add `featureBranches` table (id, workItemId, repositoryId, branchName, baseBranch, status: "active"|"ready"|"merged"|"abandoned", createdAt)
- Modify: `packages/db/src/schema.ts` — add `featureBranchTaskPRs` junction (featureBranchId, pullRequestId, mergedAt)

**Implementation:**
- Feature branch belongs to an epic/issue work item
- Links to multiple task-level PRs
- Tracks which task PRs have been merged into the feature branch

### Task 6.2: Feature Branch tRPC Router

**Files:**
- Create: `packages/api/src/router/featureBranch.ts`
- Modify: `packages/api/src/root.ts`

**Implementation:**
- Procedures: `create`, `get`, `list`, `addTaskPR`, `createFeaturePR`, `merge`
- `createFeaturePR` creates a PR from feature branch → main, linking all included task PRs
- `merge` merges the feature PR and updates status

### Task 6.3: Feature Branch UI

**Files:**
- Create: `apps/web/src/components/pull-requests/feature-branch-view.tsx`
- Modify: Work item detail to show feature branch section for epics

**Implementation:**
- Two-tier visual: task PR cards (Tier 1) flowing into feature PR card (Tier 2)
- Each task PR shows: number, title, CI status, merge status
- Feature PR shows: combined stats, CI pipeline, review status, merge button
- Shown on epic work item detail page

**Verification:** Create a feature branch for an epic. Task PRs merge into it. Create feature PR to main. Merge to main.

---

## Track 7: Screen Capture Integration

**Depends on:** Track 4 (Image Attachments)

**What exists:** Nothing — this is entirely new.

**What we build:** Screen capture service, capture panel UI, auto-capture, capture-to-chat pipeline.

### Task 7.1: Screen Capture Backend

**Files:**
- Create: `apps/web/src/app/api/capture/route.ts`
- Create: `packages/execution/src/capture/screen-capture.ts`

**Implementation:**
- API route triggers a screen capture of a specified target window
- Uses system screenshot tools (screencapture on macOS, or headless browser for web targets)
- Saves to uploads directory, returns URL + dimensions
- For web targets: use Playwright to capture specific URLs
- For native apps: use system-level screen capture (macOS `screencapture -l <windowId>`)

### Task 7.2: Capture Target Management

**Files:**
- Create: `apps/web/src/components/workspace/capture-targets.tsx`
- Create: `packages/api/src/router/capture.ts`

**Implementation:**
- List available capture targets (running windows/processes)
- tRPC procedure: `listTargets` returns [{id, name, app, bounds}]
- UI: dropdown selector with target name, app icon, "connected" status
- Support types: browser (URL-based), native (window ID-based), terminal (session-based)

### Task 7.3: Capture Panel Component

**Files:**
- Create: `apps/web/src/components/workspace/capture-panel.tsx`
- Create: `apps/web/src/components/workspace/capture-toolbar.tsx`
- Create: `apps/web/src/components/workspace/capture-history.tsx`

**Implementation:**
- CapturePanel: shows the latest capture image, full-bleed in the panel
- CaptureToolbar: target selector, "Capture Now" button, auto-capture interval dropdown (off/5s/10s/30s)
- CaptureHistory: thumbnail strip at bottom showing recent captures, click to view
- Auto-capture: setInterval that triggers capture API and appends to history
- "Send to chat" button on each capture

### Task 7.4: Integrate Capture with Workspace

**Files:**
- Modify: `apps/web/src/app/(dashboard)/work-items/[workItemId]/workspace/page.tsx`

**Implementation:**
- Add capture panel as a toggleable side panel or tab in the workspace
- Layout: file tree (left) + main content with tabs (Chat | Terminal | Capture)
- Captures automatically feed into the chat session as image attachments
- Agent can request captures via MCP tool call

**Verification:** Open workspace, select a capture target (browser or app window), see live captures. Send capture to chat. Agent responds referencing the visual content.

---

## Track 8: Change Sets (JJ Integration)

**Depends on:** Track 1 (PR Review UI), Track 3 (Workspace)

**What exists:** `forgeRevisions` table with `revId` field (comment says "commit SHA or JJ changeset ID"). Git operations via tRPC.

**What we build:** JJ changeset operations, revision graph visualization, split/squash/rebase actions.

### Task 8.1: JJ Backend Integration

**Files:**
- Create: `packages/execution/src/vcs/jj-client.ts`
- Modify: `packages/api/src/router/git.ts` — add JJ-specific procedures

**Implementation:**
- JJ client: wraps `jj` CLI commands (log, diff, new, squash, split, rebase, describe)
- Detect VCS type per repository (git vs jj) — check for `.jj/` directory
- tRPC procedures: `jj.log`, `jj.diff`, `jj.new`, `jj.squash`, `jj.describe`, `jj.rebase`

### Task 8.2: Revision Graph Component

**Files:**
- Create: `apps/web/src/components/workspace/revision-graph.tsx`
- Create: `apps/web/src/components/workspace/revision-node.tsx`

**Implementation:**
- Fetch revision log via `trpc.git.jj.log` (or `forgeRevisions` for git repos)
- Render as vertical graph with connected nodes
- Each node: revision ID, description, branch, author, age
- Working copy highlighted with primary color + "working copy" badge
- Immutable revisions shown with muted styling

### Task 8.3: Changeset Actions

**Files:**
- Create: `apps/web/src/components/workspace/changeset-actions.tsx`

**Implementation:**
- Action buttons: New, Squash, Split, Rebase, Describe
- Each action calls the corresponding tRPC procedure
- "New" creates a new empty changeset on top of working copy
- "Squash" combines working copy into parent
- "Describe" opens inline editor for changeset description
- After action: refresh revision graph

### Task 8.4: Integrate with Workspace

**Files:**
- Modify: `apps/web/src/app/(dashboard)/work-items/[workItemId]/workspace/page.tsx`

**Implementation:**
- Add "Revisions" tab in workspace alongside Chat/Terminal/Capture
- Show revision graph for the task's worktree
- Changeset actions at bottom of graph
- Link revisions to ForgeGraph builds/deployments

**Verification:** Open task workspace, switch to Revisions tab. See JJ revision graph. Create new changeset, squash, describe. See revision linked to builds.

---

## Implementation Order (Recommended)

**Phase 1 — Foundation (parallel, ~2-3 days each):**
- Track 1: PR Review UI
- Track 2: Work Item Detail Upgrade
- Track 3: Workspace File Tree + Terminal
- Track 4: Image Attachments
- Track 5: BRD/Requirements

**Phase 2 — Integration (~2-3 days each):**
- Track 6: Two-Tier PRs (after Track 1)
- Track 7: Screen Capture (after Track 4)
- Track 8: Change Sets (after Track 1 + 3)

**Total: 8 tracks, 29 tasks, ~3-4 weeks if done sequentially, ~2 weeks with parallel execution.**

---

## Notes

- All new components should follow DESIGN.md (warm amber, Satoshi/DM Sans/JetBrains Mono, theme tokens)
- All new pages need both light and dark mode support
- Add Storybook stories for any new reusable components
- Schema changes require `pnpm db:push` to apply
- Each task should be verified with `pnpm typecheck` before committing
