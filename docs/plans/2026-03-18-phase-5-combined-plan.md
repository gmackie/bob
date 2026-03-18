# Phase 5: Workflow Completion + Skill Integration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the unified workflow pipeline (planning sessions, Bob Thinking indicator, time-travel, mobile swipe) and build the skill integration layer (skill registry, skill execution visibility in chat, agent routing, floating capture widget).

**Architecture:** Two tracks running in parallel. Track A finishes the workflow page with planning session integration and the three CEO-approved expansions. Track B builds the skill layer — a registry of available skills, visible skill execution blocks in chat, and agent-to-skill routing.

**Tech Stack:** React, tRPC, existing ChatPanel/ChatPanelProvider, existing session events WebSocket, Storybook

---

## Track A: Workflow Completion

### Task A.1: Planning Session Integration

**Files:**
- Modify: `apps/web/src/components/chat/chat-panel-provider.tsx`
- Modify: `apps/web/src/components/workflow/workflow-page.tsx`

**Implementation:**
- Add `openPlanningSession(workItemId, prompt)` to ChatPanelProvider
- When called: creates a planning-type conversation via `trpc.chat.createConversation` with `sessionType: "planning"` and the workItemId
- Opens the ChatPanel with this session
- The agent receives context: work item title, description, existing requirements
- Wire the "Shape with Bob" transition in WorkflowPage to call this method
- Planning session prompt: "Let's shape this idea into requirements. Tell me about [title]."

### Task A.2: Bob Thinking Indicator

**Files:**
- Create: `apps/web/src/components/workflow/bob-thinking.tsx`
- Modify: `apps/web/src/components/workflow/workflow-page.tsx`

**Implementation:**
- Component that shows when an agent is actively working on this work item
- Renders between the pipeline indicator and the current stage section
- States:
  - Idle: not rendered
  - Thinking: "Bob is analyzing..." with subtle pulse animation on the pipeline
  - Shaping: "Bob is defining requirements..." with requirements materializing below
  - Planning: "Bob is breaking this into tasks..." with task list appearing
  - Executing: "Bob is working on {N} tasks..." with progress
- Detection: poll session status via `trpc.session.get` or subscribe to session events
- The indicator pulses the pipeline dots while active
- Smooth appear/disappear transition (200ms fade)

### Task A.3: Time-Travel Stage Snapshots

**Files:**
- Create: `apps/web/src/lib/workflow/stage-snapshot.ts`
- Modify: `packages/db/src/schema.ts` — add `workItemSnapshots` table
- Create: `packages/api/src/router/snapshot.ts`
- Modify: `apps/web/src/components/workflow/pipeline-indicator.tsx`

**Implementation:**
- When a work item transitions between stages, save a snapshot:
  ```
  workItemSnapshots table:
  - id, workItemId, stage, data (jsonb), createdAt
  ```
  - `data` contains: title, description, requirements, child tasks, PRs, deployments at that point
- Snapshot tRPC: `create` (on stage transition), `list` (by workItemId), `get` (by id)
- Pipeline indicator: clicking a completed stage shows the snapshot data instead of current data
- Small "time travel" icon on completed dots
- Banner: "Viewing snapshot from Shape stage (Mar 17)" with "Back to current" button

### Task A.4: Mobile Swipe Flow

**Files:**
- Create: `apps/web/src/components/workflow/workflow-mobile.tsx`
- Modify: `apps/web/src/components/workflow/workflow-page.tsx`

**Implementation:**
- Detect mobile viewport (< 768px)
- On mobile: render stages as swipeable cards instead of vertical scroll
- Each card is one stage section (using the existing stage components)
- Swipe right: advance to next stage (if transition available)
- Swipe left: go back to previous stage
- Bottom dots indicator (like a carousel)
- The transition banner becomes a swipe-up gesture or bottom button
- Use CSS scroll-snap for native feel (no heavy swipe library)

### Task A.5: Workflow Storybook Stories

**Files:**
- Create: `apps/web/src/components/workflow/workflow.stories.tsx`

**Implementation:**
- 7 stories, one per stage, showing the full page at each point
- "Bob Thinking" story showing the indicator in various states
- "Time Travel" story showing a snapshot overlay
- "Mobile Swipe" story at mobile viewport

---

## Track B: Skill Integration

### Task B.1: Skill Registry Schema + API

**Files:**
- Modify: `packages/db/src/schema.ts` — add `skills` and `skillExecutions` tables
- Create: `packages/api/src/router/skill.ts`

**Implementation:**
- `skills` table: id, name, slug, description, category (planning/execution/review/deploy/ops), source (builtin/gstack/custom), version, configSchema (jsonb), createdAt
- `skillExecutions` table: id, sessionId, skillSlug, workItemId, status (running/completed/failed), input (jsonb), output (jsonb), durationMs, startedAt, completedAt
- tRPC router:
  - `list` — all available skills, grouped by category
  - `getExecution` — single execution by id
  - `listExecutions` — executions for a session or work item
  - `recordExecution` — called by agents to log skill usage

### Task B.2: Skill Execution Block in Chat

**Files:**
- Create: `apps/web/src/app/(dashboard)/chat/_components/skill-execution-block.tsx`
- Modify: `apps/web/src/app/(dashboard)/chat/_components/message-stream.tsx`

**Implementation:**
- SkillExecutionBlock component showing:
  - Skill name with icon (e.g., "/review")
  - Status: running (blue pulse), completed (emerald), failed (rose)
  - Summary output (key findings, actions taken)
  - Duration
  - Expandable: click to see full input/output
  - Visually distinct from MCP tool calls — skill blocks are larger, more prominent, with colored left-border by category
- Message parser: detect `skill_start` and `skill_complete` event types in session events
- Render SkillExecutionBlock inline in the message stream

### Task B.3: Skill-to-Stage Mapping UI

**Files:**
- Create: `apps/web/src/components/workflow/stage-skills.tsx`
- Modify: `apps/web/src/components/projects/automation-settings.tsx`

**Implementation:**
- Each workflow stage has default skills (from the vision doc mapping)
- In the automation settings, add a "Skills" section per stage:
  - Shows default skills with toggles (enable/disable)
  - "Add custom skill" dropdown
  - Drag to reorder skill execution order
- StageSkills component renders on each stage section showing which skills are active
- Small skill badges on the pipeline indicator (e.g., "/review" badge on the Review dot)

### Task B.4: Agent Capability Profiles

**Files:**
- Modify: `packages/db/src/schema.ts` — extend `agentInstances` or add `agentProfiles` table
- Create: `packages/api/src/services/automation/agent-router.ts`

**Implementation:**
- Agent profiles define: which MCP servers available, which skills installed, language expertise, specialties
- Agent router service: `selectBestAgent(task)` → scores agents by:
  - Skill match: does the agent have the skills this task needs?
  - MCP match: does the agent have the required MCP servers?
  - Language match: is the agent experienced with this repo's language?
  - Availability: is the agent idle?
- Returns ranked list of agents with scores
- Used by the dispatch system when auto-dispatching tasks

### Task B.5: Floating Capture Widget

**Files:**
- Create: `apps/web/src/components/capture/floating-capture.tsx`
- Modify: `apps/web/src/app/(dashboard)/layout.tsx`

**Implementation:**
- Small floating button (bottom-right corner, above theme toggle)
- Click opens a compact capture menu:
  - "Screenshot" — capture current browser tab
  - "Window" — capture a specific window
  - "Paste to chat" — attach capture to current chat session
  - "Attach to work item" — attach to a specific work item as artifact
- Available on ALL pages (not just workspace)
- Captures saved to /uploads/captures/ with metadata
- Recent captures accessible from the button (last 5 thumbnails)

### Task B.6: Skill Execution Tracking Dashboard

**Files:**
- Create: `apps/web/src/components/dashboard/skill-usage.tsx`
- Modify: `apps/web/src/components/dashboard/mission-control.tsx`

**Implementation:**
- New panel on Mission Control: "Skill Usage"
- Shows: most used skills, success rates, average duration
- Timeline: skill executions over time (sparkline chart)
- Per-skill breakdown: /review used 14 times, avg 12s, 92% clean
- Helps users understand how agents are working

### Task B.7: Storybook Stories for Skills

**Files:**
- Create: `apps/web/src/components/chat/skill-stories.tsx`
- Create: `apps/web/src/components/capture/capture-stories.tsx`

**Implementation:**
- Skill execution block stories (running, completed, failed states)
- Skill-to-stage mapping story
- Floating capture widget story
- Skill usage dashboard story
- Agent capability profile story

---

## Implementation Order

**Phase 5A (parallel):**
- Tasks A.1 + A.2 (planning session + Bob Thinking)
- Tasks B.1 + B.2 (skill registry + chat blocks)

**Phase 5B (parallel):**
- Tasks A.3 + A.4 (time travel + mobile swipe)
- Tasks B.3 + B.4 (skill mapping + agent routing)

**Phase 5C (integration):**
- Task A.5 (workflow stories)
- Tasks B.5 + B.6 + B.7 (floating capture + dashboard + stories)

**Total: 2 tracks, 12 tasks**

---

## Expansion: Skills as Universal Protocol

### Task E.1: Skill Composability (Nested Execution Trees)

**Files:**
- Modify: `packages/db/src/schema.ts` — add `parentExecutionId` to skillExecutions
- Modify: `apps/web/src/app/(dashboard)/chat/_components/skill-execution-block.tsx`

**Implementation:**
- Skills can call other skills. Each execution records its parentExecutionId.
- Chat UI renders nested skill blocks: /ship contains /review which contains /qa.
- Expandable tree: collapsed shows top-level skill, expand shows children.
- Depth indicator: left-border indentation per nesting level.

### Task E.2: Human-as-Skill (Decision Gates)

**Files:**
- Create: `apps/web/src/components/workflow/human-gate.tsx`
- Modify: `packages/api/src/router/skill.ts` — add `requestHumanInput` procedure

**Implementation:**
- When an agent hits a decision point, it invokes a "human_review" skill.
- This pauses execution and presents a structured prompt to the user.
- The prompt appears both in chat AND as a notification on the work item page.
- User responds with a choice. Agent resumes with the decision.
- Schema: add `awaitingInput` fields to skillExecutions (question, options, response, respondedAt).

### Task E.3: Turn-Level Checkpointing

**Files:**
- Modify: `packages/db/src/schema.ts` — add `sessionCheckpoints` table
- Create: `packages/api/src/router/checkpoint.ts`
- Create: `apps/web/src/components/chat/checkpoint-indicator.tsx`

**Implementation:**
- `sessionCheckpoints` table: id, sessionId, turnNumber, eventSeq, label, snapshotData (jsonb), createdAt
- Every N turns (configurable) OR on every skill execution, save a checkpoint.
- snapshotData: conversation state, file system state hash, git ref, work item state.
- Chat UI: small checkpoint markers between messages. Click to revert.
- Revert action: restores conversation to that turn, git resets to that ref, updates work item state.
- "What if" mode: branch from a checkpoint to explore alternatives without losing the original path.

### Task E.4: Skill Replay + Editing

**Files:**
- Create: `apps/web/src/components/chat/skill-replay.tsx`
- Modify: `packages/api/src/router/skill.ts` — add `replay` procedure

**Implementation:**
- Every skill execution is fully recorded (input, output, duration, tool calls within).
- "Replay" button on any completed skill block opens a replay view.
- Replay shows: timeline of what happened, each sub-step, duration bars.
- "Edit & Re-run" button: modify the skill input parameters and re-execute.
- Use case: "What if /review had been stricter?" Change config, re-run, see different results.
- Re-run creates a new execution linked to the original (branched_from field).

---

## Updated Implementation Order

**Phase 5A (parallel):**
- Tasks A.1 + A.2 (planning session + Bob Thinking)
- Tasks B.1 + B.2 (skill registry + chat blocks)

**Phase 5B (parallel):**
- Tasks A.3 + A.4 (time travel + mobile swipe)
- Tasks B.3 + B.4 (skill mapping + agent routing)
- Tasks E.1 + E.2 (composability + human gates)

**Phase 5C (integration):**
- Tasks E.3 + E.4 (checkpointing + replay)
- Tasks A.5, B.5, B.6, B.7 (stories + floating capture + dashboard)

**Total: 3 tracks, 16 tasks**
