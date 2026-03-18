# TODOS

## Phase 3: The Cathedral

> Full plan: `docs/plans/2026-03-17-phase-3-cathedral-plan.md`

### Track 9: Planning Hub Completion

**Priority:** P0
- [x] Task 9.1: Projects grid landing page — **Completed:** 2026-03-17
- [ ] Task 9.2: Project detail with Board/List/Requirements sub-tabs
- [ ] Task 9.3: Remove Chat from sidebar nav, redirect /chat to /planning
- [ ] Task 9.4: Storybook stories for planning hub views

### Track 10: Mission Control Dashboard

**Priority:** P0
- [ ] Task 10.1: Dashboard layout + agent status bar (agent count, status pills)
- [ ] Task 10.2: Live activity feed (recent events across all projects)
  - Needs new tRPC procedure: `activity.listRecent`
- [ ] Task 10.3: Project progress rings (SVG circular progress indicators)
- [ ] Task 10.4: Attention items panel (failed tasks, PRs awaiting review, deploys awaiting approval)
- [ ] Task 10.5: Wire dashboard into /planning (show dashboard if active agents, otherwise projects grid)
- [ ] Task 10.6: Storybook stories for mission control

### Track 11: Real-Time Streaming Workspace

**Priority:** P0
- [ ] Task 11.1: File change events (agent file writes → session events → file tree auto-refresh)
- [ ] Task 11.2: Build/deploy status events (forge status changes → live UI updates)
- [ ] Task 11.3: Live activity stream hook (`useLiveActivity` subscribing to workspace events)
- [ ] Task 11.4: Workspace event integration (wire events into file tree, ForgeGraph, tab notifications)

### Track 12: Smart Screen Capture

**Priority:** P1
- [ ] Task 12.1: Playwright browser preview (replace placeholder SVG with real screenshots)
- [ ] Task 12.2: File-save triggered capture (auto-capture on agent file changes, debounced)
- [ ] Task 12.3: Capture diff view (side-by-side before/after with slider)

### Track 13: Layer Automation

**Priority:** P1
- [ ] Task 13.1: Task status change triggers (move to in_progress → auto-dispatch agent)
- [ ] Task 13.2: Automatic branch + PR creation (agent session → git branch → draft PR)
- [ ] Task 13.3: CI/CD pipeline trigger (PR created → forge revision → build status → gate checks)
- [ ] Task 13.4: Feature branch auto-assembly (all tasks done → create feature PR → notify)
- [ ] Task 13.5: Automation settings (per-project toggles: auto-dispatch, auto-branch, auto-PR, CI trigger)

---

## Deferred (P2)

### UI Polish
- [ ] Full diff rendering in PR detail page — needs diff parser library (e.g., diff2html)
- [ ] Mobile-responsive workspace layout — 3-panel doesn't collapse on small screens
- [ ] PR line-level comment threads — currently only review-level comments

### Infrastructure
- [ ] JJ split/rebase operations — only new/squash/describe implemented
- [ ] Real-time capture streaming via WebSocket (vs polling) — deferred in favor of smart capture triggers

### Testing
- [ ] Component tests for new UI (PR list, file tree, capture panel, revision graph, requirements)
- [ ] E2E tests for critical flows (create task → agent runs → PR → merge)

---

## Completed

- [x] Task 9.1: Projects grid landing page — **Completed:** 2026-03-17
- [x] Phase 2 feature implementation (8 tracks, 21 commits) — **Completed:** 2026-03-17
- [x] Router/API tests (31 tests) — **Completed:** 2026-03-17
- [x] Error boundaries on major sections — **Completed:** 2026-03-17
- [x] Auth checks on API routes — **Completed:** 2026-03-17
- [x] Database indexes on new table FK columns — **Completed:** 2026-03-17
- [x] Design system (DESIGN.md + theme tokens) — **Completed:** 2026-03-17
- [x] Storybook (75 stories across 22 groups) — **Completed:** 2026-03-17
- [x] UI refresh (50+ components migrated to theme tokens) — **Completed:** 2026-03-17
