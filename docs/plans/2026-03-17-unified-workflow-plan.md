# Unified Workflow Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the work item detail page into a single evolving view that guides work through 7 stages: Idea → Shape → Plan → Execute → Review → Deploy → Live. Each stage adds content to the page. Transitions are one-click actions.

**Architecture:** The existing work-item-detail page gets a pipeline indicator, stage-aware content sections, and transition action banners. Planning sessions (Idea→Shape→Plan) use the ChatPanel to generate artifacts. Execution sessions (Execute→Review→Deploy→Live) use the workspace, PRs, and ForgeGraph.

**Tech Stack:** React components, existing tRPC routers, existing ChatPanel, existing WorkItemBoard/ForgeGraph/FeatureBranchView

---

## Stage Model

```
STAGE         WORK ITEM KIND    STATUS          CONTENT SECTIONS
─────────     ──────────────    ──────────      ─────────────────
1. Idea       issue             backlog         Title + description only
2. Shape      issue → epic      todo            + Requirements checklist
3. Plan       epic              todo            + Child tasks mini-board
4. Execute    epic              in_progress     + Dispatch progress + agent status
5. Review     epic              in_review       + Two-tier PR view + CI pipeline
6. Deploy     epic              in_review       + Deployment cards + gate status
7. Live       epic              done            + Deployed badge + metrics
```

---

## Track 14: Pipeline Indicator + Stage Detection

### Task 14.1: Stage Detection Logic

**Files:**
- Create: `apps/web/src/lib/workflow/stage.ts`

**Implementation:**
- Function: `detectStage(workItem, childTasks, pullRequests, deployments) → Stage`
- Logic:
  - No requirements, no children → "idea"
  - Has requirements, no children → "shape"
  - Has children (tasks), none dispatched → "plan"
  - Has dispatched/running tasks → "execute"
  - All tasks done, PRs exist → "review"
  - Feature PR merged, deploying → "deploy"
  - Deployment healthy → "live"
- Returns: `{ stage, stageIndex, completedStages, nextAction }`
- Type: `Stage = "idea" | "shape" | "plan" | "execute" | "review" | "deploy" | "live"`

### Task 14.2: Pipeline Indicator Component

**Files:**
- Create: `apps/web/src/components/workflow/pipeline-indicator.tsx`

**Implementation:**
- Horizontal pipeline showing all 7 stages
- Each stage: dot + label
- Completed: emerald dot, emerald text
- Current: primary (amber) dot with pulse, primary text
- Future: muted dot, muted text
- Connecting lines between dots: emerald for completed, border for future
- Clickable dots scroll to that section (using `scrollIntoView`)
- Sticky at the top of the page (below breadcrumbs)

### Task 14.3: Stage Transition Banner Component

**Files:**
- Create: `apps/web/src/components/workflow/stage-transition.tsx`

**Implementation:**
- Renders at the bottom of the current stage's section
- Shows the next action: "Ready to shape? → Shape this idea with Bob"
- Each transition:
  - idea → shape: "Shape this idea with Bob" (opens ChatPanel with planning session)
  - shape → plan: "Break into tasks" (triggers task generation from requirements)
  - plan → execute: "Dispatch agents" (creates dispatch batch)
  - execute → review: "View PRs" (scrolls to PR section) — automatic, no button
  - review → deploy: "Merge & deploy" (merges feature PR)
  - deploy → live: automatic when deployment healthy
- Button style: full-width, primary, large, with arrow icon
- Below button: description of what happens next

---

## Track 15: Stage Content Sections

### Task 15.1: Idea Section

**Files:**
- Create: `apps/web/src/components/workflow/stage-idea.tsx`

**Implementation:**
- Shown when stage is "idea" or always as the first section
- Title (editable), description (editable), kind badge, project link
- Empty state prompt: "This is just an idea. Shape it into something actionable."
- "Shape with Bob →" transition banner

### Task 15.2: Shape Section (Requirements)

**Files:**
- Create: `apps/web/src/components/workflow/stage-shape.tsx`

**Implementation:**
- Wraps the existing RequirementsChecklist component
- Adds a header: "Requirements" with progress bar
- When this section appears, the ChatPanel auto-opens with a planning session prompt:
  "Let's shape this idea. I'll help you define requirements."
- As the agent creates requirements via MCP tool calls, they appear in real-time
- "Break into tasks →" transition banner at the bottom

### Task 15.3: Plan Section (Tasks)

**Files:**
- Create: `apps/web/src/components/workflow/stage-plan.tsx`

**Implementation:**
- Shows child tasks in a mini kanban board (reuse WorkItemBoard)
- "Create task" button for manual task creation
- "Auto-generate tasks from requirements" button (triggers agent)
- Each task card links to its own detail page
- Requirements-to-task linkage shown (which tasks cover which requirements)
- "Dispatch agents →" transition banner

### Task 15.4: Execute Section (Agent Progress)

**Files:**
- Create: `apps/web/src/components/workflow/stage-execute.tsx`

**Implementation:**
- Dispatch progress bar (X/Y tasks complete)
- Each task: status dot, title, agent assignment, branch, duration
- Click a task → opens its workspace page
- Live updates via useLiveActivity hook
- When all tasks complete → auto-transitions to review stage

### Task 15.5: Review Section (PRs + CI)

**Files:**
- Create: `apps/web/src/components/workflow/stage-review.tsx`

**Implementation:**
- Wraps existing FeatureBranchView (two-tier PR visualization)
- Shows task PRs (Tier 1) flowing into feature PR (Tier 2)
- CI pipeline status for each PR
- Review status (approved/changes requested)
- "Merge & deploy →" button when all approved and CI passing

### Task 15.6: Deploy Section

**Files:**
- Create: `apps/web/src/components/workflow/stage-deploy.tsx`

**Implementation:**
- Wraps existing DeploymentStatus component
- Shows deployment cards (staging, production)
- Gate progression visualization
- "Approve production deploy" button when staging is healthy
- Live status updates via useLiveBuildStatus hook

### Task 15.7: Live Section

**Files:**
- Create: `apps/web/src/components/workflow/stage-live.tsx`

**Implementation:**
- "Deployed" success banner with confetti-like accent
- Deployment summary: when deployed, by whom, duration
- Links to monitoring/logs
- "This feature is live" badge on the pipeline indicator

---

## Track 16: Unified Work Item Page

### Task 16.1: Rebuild Work Item Detail Page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/work-items/[workItemId]/page.tsx`
- Create: `apps/web/src/components/workflow/workflow-page.tsx`

**Implementation:**
- New WorkflowPage component that orchestrates all stages
- Detect current stage using detectStage()
- Render pipeline indicator (sticky)
- Render all completed + current stage sections
- Future stages not rendered (clean, not cluttered)
- Collapsible sections for completed stages (click pipeline dot to expand)
- ChatPanel integration: "Shape with Bob" opens panel with context

### Task 16.2: Planning Session Integration

**Files:**
- Modify: `apps/web/src/components/chat/chat-panel-provider.tsx`

**Implementation:**
- Add `openPlanningSession(workItemId, prompt)` method to ChatPanelProvider
- When called: creates a new planning session type conversation, opens the panel
- The planning session has access to the work item's data as context
- Agent can create requirements, create child tasks via MCP tool calls
- These appear on the work item page in real-time

### Task 16.3: Storybook Stories for Complete Workflow

**Files:**
- Create: `apps/web/src/components/workflow/workflow.stories.tsx`

**Implementation:**
- Story for each stage showing the accumulated page content
- "Idea" stage story (minimal page)
- "Shape" stage story (requirements populating)
- "Plan" stage story (tasks board visible)
- "Execute" stage story (dispatch progress)
- "Review" stage story (two-tier PRs)
- "Deploy" stage story (deployment cards)
- "Live" stage story (success state)

---

## Implementation Order

**Phase 4A (foundation):**
- Task 14.1: Stage detection logic
- Task 14.2: Pipeline indicator component
- Task 14.3: Stage transition banners

**Phase 4B (stage sections, parallel):**
- Tasks 15.1-15.7: All seven stage sections

**Phase 4C (integration):**
- Task 16.1: Rebuild work item detail page
- Task 16.2: Planning session integration
- Task 16.3: Storybook stories

**Total: 3 tracks, 13 tasks**
