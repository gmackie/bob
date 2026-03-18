# Phase 3: The Cathedral — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Bob from a dashboard into an autonomous software delivery platform with real-time streaming, mission control, smart visual feedback, and layer automation.

**Architecture:** Five tracks building on the Phase 1-2 foundation. Real-time WebSocket events are the backbone — everything streams through session events. The mission control dashboard aggregates live state. Smart capture closes the visual feedback loop. Layer automation wires planning → execution → delivery into a single flow.

**Tech Stack:** Next.js 16, React 19, tRPC, WebSocket (existing gateway), Drizzle ORM, Playwright (for browser capture), xterm.js

---

## Dependency Graph

```
Track 9:  Planning Hub Completion ──────┐
Track 10: Mission Control Dashboard ────┤ (depends on Track 9)
Track 11: Real-Time Streaming ──────────┤ (independent, enables Track 12+13)
Track 12: Smart Screen Capture ─────────┤ (depends on Track 11)
Track 13: Layer Automation ─────────────┘ (depends on Track 9+11)
```

---

## Track 9: Planning Hub Completion

**Status:** Task 9.1 done (projects grid). 3 tasks remain.

### Task 9.1: Projects Grid Landing ✅ DONE
Already implemented — /planning is now a projects hub.

### Task 9.2: Project Detail with Board Default View

**Files:**
- Modify: `apps/web/src/app/(dashboard)/projects/[projectId]/page.tsx`
- Create: `apps/web/src/components/projects/project-board-view.tsx`
- Create: `apps/web/src/components/projects/project-list-view.tsx`

**Implementation:**
- Redesign project detail page with sub-tabs: Board | List | Requirements
- Board tab (default): render existing WorkItemBoard component filtered to this project
- List tab: filterable table of work items with sort by status/priority/updated
- Requirements tab: render RequirementsChecklist for the project's root epic (if one exists)
- Add "Create Work Item" button in the header
- Breadcrumbs: Projects > [Project Name]

### Task 9.3: Remove Chat from Sidebar Nav

**Files:**
- Modify: `apps/web/src/components/layout/sidebar-nav.tsx`
- Create: `apps/web/src/app/(dashboard)/chat/redirect.tsx` (or modify page.tsx to redirect)

**Implementation:**
- Remove "Chat" nav item from NAV_ITEMS array in sidebar-nav.tsx
- Add redirect from /chat to /planning (use Next.js redirect or client-side router.push)
- Chat is now only accessible via the ChatPanel side panel within tasks
- Update sidebar to: Planning | Pull Requests | System | Settings

### Task 9.4: Storybook Stories for Planning Hub

**Files:**
- Create: `apps/web/src/components/projects/planning-hub.stories.tsx`

**Implementation:**
- Projects grid story (multiple project cards)
- Project detail with board view story
- Project detail with list view story
- Empty project state story

---

## Track 10: Mission Control Dashboard

**What we build:** A live operations dashboard as the default view when a user has active agents. Shows agent status, live activity feed, project progress, and items needing attention.

### Task 10.1: Dashboard Layout Component

**Files:**
- Create: `apps/web/src/components/dashboard/mission-control.tsx`
- Create: `apps/web/src/components/dashboard/agent-status-bar.tsx`

**Implementation:**
- Top bar: agent status summary — "{N} agents running, {N} idle, {N} errored"
- Fetch via `trpc.instance.list` (already returns agent instances with status)
- Each active agent shows: a small pill with task identifier, status dot (running=blue pulse, idle=slate, error=rose), duration
- Color-coded: green bar if all healthy, amber if any idle, red if any errored

### Task 10.2: Live Activity Feed

**Files:**
- Create: `apps/web/src/components/dashboard/activity-feed.tsx`

**Implementation:**
- Center panel: scrolling feed of recent events across all projects
- Fetch from existing `activities` table via `trpc.activity.listByWorkItem` (need new procedure: `listRecent` across all work items for the user)
- Add tRPC procedure: `activity.listRecent` — returns latest 50 activities across all user's workspaces
- Each event: icon + "Agent completed WI-0043" + relative time + link to work item
- Auto-refresh every 5s (or real-time via WebSocket in Track 11)
- Event types: task_started, task_completed, task_failed, pr_created, pr_merged, build_passed, build_failed, deploy_healthy

### Task 10.3: Project Progress Rings

**Files:**
- Create: `apps/web/src/components/dashboard/project-progress.tsx`

**Implementation:**
- Left sidebar: list of projects with circular progress indicators
- Each project: name, progress ring (% of work items done), active task count
- Progress ring: SVG circle with stroke-dasharray based on completion percentage
- Primary color for progress, muted for remaining
- Click navigates to project detail page

### Task 10.4: Attention Items Panel

**Files:**
- Create: `apps/web/src/components/dashboard/attention-panel.tsx`

**Implementation:**
- Right sidebar: items that need human attention
- Categories: Failed tasks, PRs awaiting review, deployments awaiting approval, stale work items
- Fetch: combine queries from taskRun (failed), pullRequest (open + approved), forgeDeployments (awaiting approval)
- Each item: icon, title, action button ("Review PR", "Approve Deploy", "Retry Task")
- Badge count on each category header

### Task 10.5: Wire Dashboard into Navigation

**Files:**
- Modify: `apps/web/src/app/(dashboard)/planning/page.tsx`
- Create: `apps/web/src/components/dashboard/dashboard-or-projects.tsx`

**Implementation:**
- The /planning page now shows either Mission Control (if user has active agents/recent activity) or Projects Grid (if no activity)
- Logic: if `agentInstances.filter(a => a.status === "running").length > 0` OR `recentActivities.length > 0` → show dashboard
- Otherwise → show projects grid
- Toggle between views: "Dashboard" | "Projects" pills at the top

### Task 10.6: Storybook Stories for Mission Control

**Files:**
- Create: `apps/web/src/components/dashboard/mission-control.stories.tsx`

**Implementation:**
- Full mission control layout with all panels
- Agent status bar (running, idle, mixed states)
- Activity feed with various event types
- Project progress rings
- Attention panel with items

---

## Track 11: Real-Time Streaming Workspace

**What we build:** Extend the existing WebSocket session events to push file changes, build status, and deployment events to the workspace in real-time.

### Task 11.1: File Change Events

**Files:**
- Modify: `packages/execution/src/` — find the agent execution code that writes files
- Modify: `packages/api/src/router/filesystem.ts` — add event emission
- Modify: `apps/web/src/components/workspace/file-tree.tsx` — subscribe to events

**Implementation:**
- When an agent creates/modifies/deletes a file, emit a session event: `{ type: "file_change", payload: { path, action: "created"|"modified"|"deleted" } }`
- The file tree component subscribes to session events (via existing `getEvents` polling or WebSocket)
- On file_change event: invalidate the filesystem.list query for the affected directory
- This makes the file tree update automatically when the agent makes changes

### Task 11.2: Build/Deploy Status Events

**Files:**
- Modify: `packages/api/src/router/forgegraph.ts` — emit events on status changes
- Create: `apps/web/src/hooks/use-live-build-status.ts`

**Implementation:**
- When a build or deployment status changes (via updateBuildStatus, updateDeploymentStatus), emit an activity event
- Create a `useLiveBuildStatus` hook that subscribes to forge events for a given task/revision
- Returns current build status, deployment status, gate progression — all live
- Wire into ForgeGraphSection to replace the 30s polling with event-driven updates

### Task 11.3: Live Activity Stream Hook

**Files:**
- Create: `apps/web/src/hooks/use-live-activity.ts`

**Implementation:**
- Generic hook: `useLiveActivity(workspaceId)` — subscribes to all activities in a workspace
- Uses existing session event WebSocket infrastructure
- Returns a stream of activity events that components can subscribe to
- Powers both the mission control feed (Track 10) and the work item activity timeline

### Task 11.4: Workspace Event Integration

**Files:**
- Modify: `apps/web/src/components/workspace/workspace-layout.tsx`

**Implementation:**
- Wire file change events into the file tree (auto-refresh on agent writes)
- Wire build/deploy events into the ForgeGraph section (live status updates)
- Add a subtle notification indicator when new events arrive but the user is on a different tab
- "New changes" toast or badge that appears on the Content tab when file changes happen while viewing Capture or Revisions

---

## Track 12: Smart Screen Capture

**What we build:** Playwright live preview for browser targets, file-save-triggered capture for native apps.

### Task 12.1: Playwright Browser Preview

**Files:**
- Modify: `apps/web/src/app/api/capture/route.ts`
- Create: `packages/execution/src/capture/playwright-capture.ts`

**Implementation:**
- Replace the placeholder SVG with actual Playwright screenshot capture
- For browser targets: launch headless Chromium, navigate to URL, capture screenshot
- Reuse Playwright instance across captures (don't launch/close per capture)
- Return the actual screenshot as a PNG file
- Support viewport size parameter (default 1280x720)

### Task 12.2: File-Save Triggered Capture

**Files:**
- Modify: `apps/web/src/components/workspace/capture-panel.tsx`
- Create: `apps/web/src/hooks/use-file-save-trigger.ts`

**Implementation:**
- Subscribe to file_change events from Track 11
- When a file change is detected and auto-capture is enabled, wait 500ms (debounce) then trigger a capture
- This makes the capture panel update automatically when the agent saves a file
- Combined with the game window capture, this creates the "watch the agent fix the bug" experience

### Task 12.3: Capture Diff View

**Files:**
- Create: `apps/web/src/components/workspace/capture-diff.tsx`

**Implementation:**
- Side-by-side comparison of two captures (before/after)
- Slider to scrub between captures
- Highlight regions that changed (simple pixel diff)
- Useful for verifying visual changes ("did the spacing actually change?")

---

## Track 13: Layer Automation

**What we build:** The connective tissue that turns planning actions into execution. Drag a task to "Ready" → Bob starts working on it.

### Task 13.1: Task Status Change Triggers

**Files:**
- Modify: `packages/api/src/router/planning.ts` — the `updateTask` procedure
- Create: `packages/api/src/services/automation/task-trigger.ts`

**Implementation:**
- When a task's status changes to "in_progress" (or a new dispatch trigger status), check if auto-dispatch is enabled for the project
- If enabled: create a dispatch batch with this single task, assign an agent, start the session
- The trigger service: `onTaskStatusChange(taskId, oldStatus, newStatus)` — evaluates automation rules
- For now: simple rule — "when task moves to in_progress AND no active session exists, create one"

### Task 13.2: Automatic Branch + PR Creation

**Files:**
- Modify: `packages/execution/src/` — find where agent sessions start
- Create: `packages/api/src/services/automation/branch-automation.ts`

**Implementation:**
- When an agent session starts for a task, automatically:
  1. Create a git branch named `feature/{task-identifier}`
  2. Set the worktree to use this branch
  3. After agent completes: create a task-level PR automatically
- The branch automation service handles the git operations
- PR is created as "draft" — user can review and mark ready

### Task 13.3: CI/CD Pipeline Trigger

**Files:**
- Modify: `packages/api/src/router/forgegraph.ts`
- Create: `packages/api/src/services/automation/pipeline-trigger.ts`

**Implementation:**
- When a PR is created (from Task 13.2), trigger the CI pipeline
- Create a forge revision linked to the PR's head commit
- Update build status as CI progresses (via webhook or polling)
- When all gates pass: auto-update PR status to "ready for review"
- When gates fail: notify via activity feed, add comment to PR

### Task 13.4: Feature Branch Auto-Assembly

**Files:**
- Modify: `packages/api/src/router/featureBranch.ts`

**Implementation:**
- When all tasks in an epic are "done" AND all task PRs are merged into the feature branch:
  1. Auto-create the feature-level PR (feature branch → main)
  2. Run CI on the combined changeset
  3. Notify the user: "Feature 'Priority System' is ready for review"
- This completes the full automation loop: idea → tasks → agent work → task PRs → feature PR → review → ship

### Task 13.5: Automation Settings

**Files:**
- Create: `apps/web/src/components/projects/automation-settings.tsx`
- Modify: `packages/db/src/schema.ts` — add `projectSettings` table or extend projects table

**Implementation:**
- Per-project settings panel:
  - Auto-dispatch: on/off (trigger agent when task moves to in_progress)
  - Auto-branch: on/off (create branch + PR automatically)
  - Auto-feature-PR: on/off (combine task PRs when all done)
  - CI trigger: on/off (run CI on PR creation)
- Stored in project settings (new column or new table)
- Accessible from project detail page settings tab

---

## Implementation Order

**Phase 3A — Navigation + Dashboard (parallel):**
- Track 9: Planning Hub Completion (3 remaining tasks)
- Track 10: Mission Control Dashboard (6 tasks)

**Phase 3B — Real-Time (foundation for 3C):**
- Track 11: Real-Time Streaming (4 tasks)

**Phase 3C — Visual Feedback + Automation (parallel, after 3B):**
- Track 12: Smart Screen Capture (3 tasks)
- Track 13: Layer Automation (5 tasks)

**Total: 5 tracks, 21 tasks**

---

## Notes

- All components follow DESIGN.md (warm amber, theme tokens, font-display headings)
- All new features need both light and dark mode
- WebSocket events use the existing session event infrastructure — don't create a parallel system
- Automation should be opt-in per project, never surprising
- Each task verified with `pnpm typecheck` before committing
- Add Storybook stories for major new components
