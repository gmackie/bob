# Execution Review — Unified Pipeline View

## Summary

A new route (`/work-items/[id]/review`) that replaces the fragmented per-stage accordion with a single, cohesive pipeline view. Shows the full journey from agent completion through code review, CI gates, and environment promotions to production — answering two questions: "Is the code good?" and "Is it deployed safely?"

**Approach:** Web-first (mobile follows once mobile v2 stabilizes). New route and components — the existing workflow page stays untouched for idea/shape/plan stages. Pure frontend work; all backend data (ForgeGraph revisions, builds, deployments, pipeline state, artifacts) already flows end-to-end.

**Phases:** Two phases, split by user question:
- **Phase 1:** "Is the code good?" — Pipeline rail, code review gate, CI/test artifacts
- **Phase 2:** "Is it deployed safely?" — Deploy environment lanes, production approval gate, failure recovery

## Design References

Three HTML mockup files generated during the design consultation session:

- `/tmp/design-consultation-preview-1774556428.html` — Design system reference (fonts, colors, spacing, components, form factor mockups)
- `/tmp/design-consultation-deep-1774556428.html` — Deep product surface explorations (planning session, agent chat, dispatch, review/diff, deploy, mobile)
- `/tmp/design-execution-review-1774556428.html` — Execution review explorations (full pipeline, code review gate, CI/test artifacts, deploy progression, failure modes, mobile)

These should be copied to a permanent location before `/tmp` is cleared.

## Route & Layout

### New Route
`/work-items/[workItemId]/review` — accessible from the workflow page once a dispatch batch exists (Execute stage onward).

### Layout Structure
Three vertical zones:

1. **Pipeline Rail** (sticky top) — 10-node horizontal pipeline: Agent → Review → Build → Gates → Dev → Staging → Approve → Prod → Complete. Each node shows status (done/active/failed/pending/approval) and elapsed time. Clicking a node scrolls to its content section.

2. **Content Area** (scrollable) — Sections for each pipeline stage that has data. Sections appear/disappear based on pipeline progress.

3. **Context Sidebar** (right, collapsible) — Work item metadata, dispatch batch summary (X/Y tasks done, Z failed), artifact panel.

### Task Selector
When a batch has multiple dispatch items, a tab bar below the pipeline rail lets you switch between tasks: `Task 1: Extract interface ✓ | Task 2: Redis store ● | Task 3: Migration ✕`. An "All Tasks" tab shows the aggregate view. The pipeline rail reflects the selected task's state.

### Data Sources
- `trpc.dispatch.getBatch` — batch + all dispatch items with pipelineState
- `trpc.forgegraph.getRevision` — revision gates, linked builds, deployments, run events
- `trpc.forgegraph.listBuilds` — build status, duration, image digest
- `trpc.forgegraph.listDeployments` — environment status, pod readiness, timestamps
- `trpc.pullRequest.listBySession` — PRs created by the agent session
- `workItemArtifacts` query — code review decisions, test reports, build logs

No new API routers or database changes required.

## Phase 1: "Is the Code Good?"

### Pipeline Rail (`pipeline-rail.tsx`)
- Array of `PipelineNode` objects: `{name, status, elapsed?, detail?}`
- Status types: `done` (green ✓), `active` (amber pulse), `failed` (red ✕), `pending` (gray), `approval` (purple ⏸)
- Connected by lines colored by progression (done=green, active=gradient, pending=gray, failed=red)
- Sticky-positioned below page header
- Clickable nodes scroll-anchor to content sections

### Code Review Card (`code-review-card.tsx`)
- Sources: `workItemArtifacts` where `artifactType === "code_review"` and `isCurrent === true`
- Parses artifact JSON: `{decision: "approve"|"request_changes", summary, comments[]}`
- **Approved state:** Green border, decision badge, summary block, inline comments with:
  - File path + line reference + severity badge (critical/suggestion/nit)
  - Diff context snippet (added/removed lines)
  - Applied/acknowledged status per comment
  - Footer: comment counts, "View Full Diff" and "Open Session" links
- **Rejected state:** Red border, critical issue highlight, "Agent resumed with feedback" footer with spinning indicator and iteration count

### Gate Row (`gate-row.tsx`)
- Sources: ForgeGraph revision `gates` array `[{name, status, startedAt?, finishedAt?}]`
- Three connected gate nodes: Lint, Test, Build
- Each shows: status dot (passed/failed/running/pending), name, duration
- Connected by lines colored by progression

### Build Detail Card (`build-detail-card.tsx`)
- Sources: `forgeBuilds` via `trpc.forgegraph.listBuilds`
- Shows: commit hash, CI provider (Gitea Actions), duration, image digest, image size
- Linked artifact chips: Test Report, OCI Image, Build Log, Security Scan
- Chips are clickable — navigate to artifact or expand inline

### Test Report Viewer (`test-report-viewer.tsx`)
- Sources: `workItemArtifacts` where `artifactType === "test_report"`
- Summary stats grid: Passed (green), Failed (red), Skipped (gray), Duration
- Expandable test suites: suite name (file path), pass/fail/skip counts, duration
- Individual test cases within suites: status icon, test name, duration
- Failed tests show expected/received values inline

### Artifact Panel (`artifact-panel.tsx`)
- Sources: all `workItemArtifacts` for the work item
- Typed list with icon, name, type badge, producer label (bob/forgegraph/human/system), timestamp
- Artifact types: PR (📋), Build (🏗), Test Report (✅), Code Review (📋), Verification (🔒), Deployment (🚀), Doc (📄)
- Click: URL artifacts navigate, content artifacts expand inline
- Lives in the context sidebar

## Phase 2: "Is It Deployed Safely?"

### Environment Lanes (`environment-lanes.tsx`)
- Sources: `forgeDeployments` filtered by revision
- Three-column grid: Development, Staging, Production
- Each lane shows:
  - Top color bar (3px): green=healthy, amber=deploying, red=unhealthy, purple=awaiting approval, gray=pending
  - Status dot + label, pod readiness, deploy timestamp, commit hash
  - Progress bar during active rollouts
  - Contextual action buttons:
    - Staging healthy → "Promote to prod" button on prod lane
    - Unhealthy → "Rollback" + "Pod Logs" buttons
    - Deploying → progress indicator

### Approval Gate Card (`approval-gate-card.tsx`)
- Renders when `pipelineState === "awaiting_prod_approval"`
- Purple card with evidence checklist:
  - Test pass count (from test_report artifact)
  - Code review status (from code_review artifact)
  - Staging health duration (from deployment timestamp)
  - Security scan status (from verification artifact)
- Commit hash + image reference for what's being promoted
- Three buttons: Approve (`trpc.forgegraph.approveProdDeploy`), View Full Report, Reject

### Error Detail Card (`error-detail-card.tsx`)
- Renders contextually when `pipelineState` is a terminal failure state
- **Build failed (`build_failed`):** Error detail with test output, buttons: Retry Build (`trpc.dispatch.resetPipelineState`), Resume Agent, View Build Log, View Test Report
- **Deploy failed (`deploy_failed`):** Stack trace from pod logs, buttons: Rollback (`trpc.forgegraph.createDeployment` with `rollbackTargetId`), Pod Logs, Investigate, Retry Deploy
- **Review rejected (`review_failed`):** Shows code review card in rejected state with "agent fixing" spinner. No user action needed — pipeline auto-advances.

## Dispatch Table & Workflow Page Integration

### Dispatch Table (`dispatch-plan.tsx` — modify)
- "View"/"Watch" button links to `/work-items/[workItemId]/review?task=[itemId]`
- Pipeline cell keeps inline status (dot + label + timer) — full detail on review page
- "Approve Prod" stays as quick action, full evidence card on review page

### Workflow Page Entry Points (modify)
- `stage-execute.tsx`: "View Execution Review →" button once any item reaches `agent_complete`
- `stage-review.tsx`: Summary card + "Open Review Dashboard →" link (replaces full PR list)
- `stage-deploy.tsx`: Summary card + "View Deploy Status →" link (replaces full deploy status)

## File Inventory

### New Files (12)
```
apps/web/src/app/(dashboard)/work-items/[workItemId]/review/page.tsx
apps/web/src/components/review/review-page.tsx
apps/web/src/components/review/pipeline-rail.tsx
apps/web/src/components/review/task-selector.tsx
apps/web/src/components/review/code-review-card.tsx
apps/web/src/components/review/gate-row.tsx
apps/web/src/components/review/build-detail-card.tsx
apps/web/src/components/review/test-report-viewer.tsx
apps/web/src/components/review/artifact-panel.tsx
apps/web/src/components/review/environment-lanes.tsx
apps/web/src/components/review/approval-gate-card.tsx
apps/web/src/components/review/error-detail-card.tsx
```

### Modified Files (4)
```
apps/web/src/components/planning/dispatch-plan.tsx  — add review route links
apps/web/src/components/workflow/stage-execute.tsx   — add review page entry point
apps/web/src/components/workflow/stage-review.tsx    — replace PR list with summary + link
apps/web/src/components/workflow/stage-deploy.tsx    — replace deploy status with summary + link
```

### No Changes Needed
- No new API routers
- No database schema changes
- No new packages

## Design System Compliance

All components follow DESIGN.md:
- **Typography:** Satoshi for titles/headings, DM Sans for body/UI, JetBrains Mono for code/hashes/IDs
- **Colors:** Warm amber accent, warm gray neutrals, semantic colors per existing system
- **Spacing:** 4px base unit, comfortable density
- **Border radius:** sm:4px (badges), md:8px (buttons/inputs), lg:12px (cards/panels)
- **Motion:** Minimal-functional — pulse animation on active pipeline nodes, 150ms transitions on hovers

## Mobile (Future — After Mobile v2 Stabilizes)

The HTML mockups include phone-sized designs for:
- Pipeline status (compact dot row)
- Production approval gate (approve/reject buttons)
- Test report summary
- Build failed error card with retry
- Deploy environment summary

These will be implemented in `apps/mobile` as a separate effort once NativeWind rendering is stable and the web design is validated.

## Decisions Log

| Decision | Rationale |
|----------|-----------|
| New route vs. evolve existing stages | The pipeline view is fundamentally different from the accordion-of-stages — retrofitting would fight the design |
| Web-first, mobile follows | Mobile v2 is still in Phase 0 (NativeWind fix) — building shared primitives now would be premature |
| 2 phases split by user question | "Is the code good?" and "Is it deployed safely?" are the two questions — each phase delivers a complete answer |
| Pure frontend, no backend changes | All data already flows end-to-end via ForgeGraph — we just need UI to display it |
| Aggregate + per-task views | Multiple dispatch items need both an overview and drill-down — tab selector handles this |
