# Dashboard and Planning Shell Design

**Date:** 2026-05-31
**Status:** Draft design
**Goal:** Define the product model for Bob's dashboard before continuing implementation. The app should feel like an operations console for planning, queueing, dispatching, and monitoring agent work, not a loose collection of dashboard widgets.

## Product Principles

1. **The left rail is navigation.** It should help the user switch between recent/history views, queues, sessions, projects, and selected details without losing shell context.
2. **The main workspace is the work surface.** It shows the dashboard, selected work item, selected planning session, or selected project configuration.
3. **The right rail is live work.** It should only show things currently in progress for the active mode.
4. **Capacity is first-class.** Codex and Cursor usage/capacity must be visible at the top of the dashboard and clickable for deeper provider/session details.
5. **Dashboard cards summarize; tables explain.** Center cards should show counts and urgency, not full task lists. Clicking a card opens a full table/detail page.
6. **Realtime state must be trusted.** Badges, statuses, and last-updated values in the rails should update live from session/task/project events.

## Shell Model

The app has one persistent shell with a mode switch in the top-left:

- `Tasks`
- `Planning`

The mode switch changes the left rail tabs and the default main workspace. The right rail remains a live status rail, scoped to the active mode.

The top-right settings control is global. It should allow:

- change workspace
- log out
- account settings
- provider settings
- app/device settings
- future settings surfaces

The selected workspace should remain visible near the top of the shell or in the settings trigger state so users always know which workspace they are operating.

## Tasks Mode

Tasks mode is for operating execution work.

### Left Rail Tabs

`Recent Outcomes`

- Shows previous execution outcomes using the same row pattern as the live rail.
- Includes completed, errored, cancelled, interrupted, and recently reviewed task sessions.
- Each row shows title/identifier, status badge, provider/agent marker where available, and last activity.
- Clicking a row opens a session-forward work item detail in the main workspace.

`Priority Queue`

- Shows a linear prioritized list of tasks.
- This is not a lane board.
- Primary ordering is priority, then queue order.
- Supports save queue, sort by priority, manual reorder, and dispatch/start controls.
- Clicking a row opens a task-forward work item detail in the main workspace.

### Default Main Workspace

The default main workspace is the Tasks dashboard.

Top section:

- Codex usage/capacity card
- Cursor usage/capacity card

Each provider card should show:

- current usage or remaining capacity
- active session count
- queued/starting count if known
- limit or throttle status
- recent failure/warning state

Clicking a provider opens a provider detail page/table with specific agents/sessions, completed tasks, failed tasks, and drilldowns into session output.

Center section:

- summary cards for operational lanes such as:
  - `Needs Attention`
  - `Starting Soon`
  - `Ready to Dispatch`
  - `Review Waiting`
  - `Blocked`

These cards show counts, urgency, and the top reason when useful. They do not list all tasks. Clicking a card opens a full table page for that lane.

Right rail:

- `Running Now`
- Only active execution sessions and agents.
- No completed work, no historical sessions.
- Clicking a row opens the active work item/session detail in the main workspace.

## Task Detail Views

Clicking from `Recent Outcomes` opens a session-forward detail:

- outcome summary
- provider/agent identity
- timeline/events
- readable output, not raw JSON
- artifacts
- validation/review state
- rerun/follow-up controls if applicable
- linked task/work item

Clicking from `Priority Queue` opens a task-forward detail:

- title, identifier, description
- priority and queue position
- dependencies/blockers
- project context
- dispatch/start controls
- linked sessions/runs if any
- artifacts and validation if available

Both detail types live inside the shell. The left rail stays visible for navigation.

## Planning Mode

Planning mode is for planning sessions and project management.

### Left Rail Tabs

`Recent Sessions`

- Shows planning sessions that are completed, stopped, errored, interrupted, or recently active.
- Each row shows title/goal, status badge, last activity, and whether it produced drafts/tasks.
- Clicking a row opens the planning session view in the main workspace.

`Projects`

- Shows project-management navigation.
- Clicking the tab opens the projects dashboard in the main workspace.
- Clicking a project opens that project's Bob configuration page in the main workspace.

### Default Main Workspace

The default main workspace is the Planning dashboard.

Center section:

- planning/project summary cards
- drafts awaiting commit
- plans needing user input
- projects with setup issues
- stale project sync warnings
- plan/project health summaries

Right rail:

- `Active Sessions`
- Only currently running, starting, provisioning, or awaiting-input planning sessions.
- Clicking a row opens the planning session view in the main workspace.

Planning session creation should be an action in Planning mode, not a large default dashboard card. Use a compact `+ Planning` or `New Planning Session` action near the mode/header controls. If a planning session is already active, it appears in the right rail.

## Projects Dashboard

The Projects tab in Planning mode opens a dense management dashboard/table.

Each project row should show:

- project name and key
- workspace
- configured directory/root path
- git provider and repo connection
- local git status
- current branch/default branch
- Linear project link/status
- Bob configuration status
- warnings for missing repo, missing Linear link, dirty workspace, stale sync, auth issue, or invalid directory

Clicking a project opens the project configuration page inside the shell.

The project configuration page manages:

- Bob project metadata
- workspace/project assignment
- local directory/root
- git provider and repo mapping
- Linear project mapping
- default planning settings
- execution settings
- secrets/env references where relevant
- validation/status checks

## Realtime Data Model

Left rail rows should be live projections, not static query results.

Every rail row should include:

- stable id
- title
- optional identifier
- status
- status tone
- last activity timestamp
- mode/type
- provider/agent marker where relevant
- destination target

Realtime behavior:

- Initial data loads from tRPC queries.
- Gateway/websocket events patch local state or invalidate relevant queries.
- If websocket disconnects, use short polling and show connection state.
- Status badges and last-updated text update from the same normalized model.

Events that should update the shell:

- session created
- session status changed
- session event appended
- task priority changed
- queue order changed
- task status changed
- work item dispatched
- planning session produced drafts/tasks
- project sync/git status changed
- provider capacity/limit changed

## Responsive Behavior

Web/tablet:

- persistent left rail
- main workspace to the right
- right live rail inside dashboard views
- selected detail replaces the dashboard workspace but keeps the left rail
- full table pages for lane-card drilldowns

Phone:

- left rail becomes a primary navigation screen or drawer
- right live rail becomes a tab/sheet
- lane-card drilldowns can use full-screen pages
- provider cards remain top-level on the dashboard

The information architecture should remain the same across web and mobile even when layout changes.

## Naming

Mode switch:

- `Tasks`
- `Planning`

Tasks mode left rail:

- `Recent Outcomes`
- `Priority Queue`

Tasks dashboard right rail:

- `Running Now`

Planning mode left rail:

- `Recent Sessions`
- `Projects`

Planning dashboard right rail:

- `Active Sessions`

Provider cards:

- `Codex`
- `Cursor`

## Initial Build Sequence

1. **Lock the shell state model.**
   - Add mode state: `tasks | planning`.
   - Add selected main workspace target: dashboard, work item, session, project, table lane.
   - Keep left rail persistent across selections.

2. **Refactor Tasks mode navigation.**
   - Rename existing `Active Agents` to `Recent Outcomes`.
   - Rename existing `Work Queue` to `Priority Queue`.
   - Make priority queue linear and ordered.
   - Route row clicks into main workspace detail instead of leaving the shell.

3. **Build Tasks dashboard summary.**
   - Add Codex/Cursor provider cards.
   - Replace dense pipeline task lists with summary cards.
   - Move only running execution sessions into the right rail.
   - Add full table drilldown routes/views for summary cards.

4. **Build Planning mode shell.**
   - Add `Recent Sessions` and `Projects` tabs.
   - Add planning dashboard center content.
   - Add active planning sessions right rail.
   - Move planning-session creation to a compact action.

5. **Build Projects dashboard and project detail.**
   - Add project status table.
   - Show directory, workspace, git, Linear, repo, and config status.
   - Open selected project configuration in the main workspace.

6. **Wire realtime rail updates.**
   - Normalize row models.
   - Subscribe/invalidate from gateway events.
   - Add polling fallback.
   - Verify badges/status/last-updated changes without manual refresh.

## Acceptance Criteria

- The dashboard is understandable without reading explanatory copy.
- The left rail is always navigation, never miscellaneous status.
- The right rail contains only current in-progress work for the active mode.
- `Recent Outcomes`, `Priority Queue`, `Recent Sessions`, and `Projects` have clear, distinct meanings.
- Clicking any rail row replaces the main workspace while keeping the shell.
- Codex and Cursor usage/capacity are visible at the top of the Tasks dashboard.
- Clicking Codex or Cursor opens provider detail with agent/session history.
- Center dashboard cards summarize operational states and open full table views.
- Planning sessions and project management live under Planning mode.
- Projects dashboard exposes directory, workspace, git, Linear, repo, and configuration status.
- Rail badges, statuses, and last-updated values update in realtime or via polling fallback.

## Open Questions

1. Should provider capacity cards live only on Tasks dashboard, or also appear in Planning mode when planning sessions consume the same providers?
2. Should `Recent Outcomes` include successful planning-generated tasks, or only execution sessions?
3. What is the source of truth for Codex and Cursor usage limits: provider API, local runner config, or Bob's session/capacity accounting?
4. Should lane-card table drilldowns be route-backed pages for deep links, or shell-local views with URL state?
5. Should project git status be refreshed automatically, manually, or both?
