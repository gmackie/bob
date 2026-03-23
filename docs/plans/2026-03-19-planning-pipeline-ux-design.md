# Planning Pipeline UX Design

**Date:** 2026-03-19
**Status:** Draft
**Scope:** Planning funnel UX — from idea to dispatch

## Overview

Build a cohesive planning pipeline UX that takes work items from raw idea through shaping, planning, breakdown, and dispatch. The work item is the source of truth, but planning happens in a focused split-view experience that writes artifacts, activity records, and structured updates back to the work item.

## Design Principles

- **Linear funnel**: Idea → Shape → Plan → Breakdown → Ready → Dispatched
- **Hybrid ownership**: Pipeline lives on the work item; sessions open a focused experience
- **Soft gates**: Stages auto-advance based on completed session checklists, but users can override manually
- **Full traceability**: Every session produces an artifact, an activity record, and structured state changes

---

## 1. Data Model — Planning Pipeline

### New fields on work items (issues/epics)

- `planningStage`: `idea` | `shaping` | `planning` | `breakdown` | `ready` | `dispatched`
- Auto-advances based on completed sessions, but can be manually set

### Planning Sessions (extends existing `planSession`)

Each session has:
- `sessionType`: `office_hours` | `ceo_review` | `eng_review` | `design_review` | `breakdown`
- Link to the parent work item
- On completion, produces:
  - An **artifact** (design doc, plan, task list) attached to the work item
  - An **activity record** on the work item timeline
  - **Structured updates** (requirements, child tasks, field changes)

### Stage auto-advance rules (soft checklist)

| Transition | Condition |
|---|---|
| `idea → shaping` | First session of any type launched |
| `shaping → planning` | At least one shaping session (office hours) completed with artifact |
| `planning → breakdown` | At least one review session completed |
| `breakdown → ready` | Child tasks exist |
| `ready → dispatched` | Dispatch batch created (existing flow) |

Users can always override the stage manually. These are suggestions, not gates.

---

## 2. Work Item Detail — Pipeline View

### Pipeline bar

Horizontal stepper at the top of the work item page showing all 6 stages:
- Current stage highlighted
- Completed stages show checkmarks
- Future stages dimmed
- Clicking a stage scrolls to its section below

### Stage sections

Below the pipeline bar, the page body shows sections for each completed/active stage:

- **Each stage section shows:**
  - Sessions run in that stage (e.g., "Office Hours — Mar 19", "CEO Review — Mar 20")
  - Artifacts produced (clickable to view the full doc)
  - A "Launch session" button with a dropdown of applicable session types

- **Active stage section** is expanded by default with a prominent CTA (e.g., "Run a plan review" with CEO / Eng / Design options)

- **Completed stage sections** are collapsed but expandable, showing a summary line like "2 sessions, 1 artifact"

### Sidebar additions

Existing sidebar (metadata, assignee, priority) gains a small "Planning Progress" card showing checklist state — which session types have been completed.

### Key interaction

Clicking "Launch session" opens the focused split-view experience. When that session ends, the work item page updates with the new artifact and potentially advances the stage.

---

## 3. Focused Planning Session — Split View

Route: `/work-items/[workItemId]/plan/[sessionId]`

### Left panel — Chat

- Chat interface with Claude, pre-loaded with context:
  - Work item title, description, requirements
  - Artifacts from previous stages (office hours output feeds into CEO review, etc.)
  - Session type determines which skill gets invoked
- Standard chat controls (send, stop)
- "Finish session" button triggers artifact extraction and writes back to work item

### Right panel — Live artifact preview

- Renders the artifact being produced in real-time as the chat progresses
- Content varies by session type:
  - Office hours / brainstorming: design doc taking shape
  - Plan reviews: plan with annotations and scores
  - Breakdown: task tree being generated
- Markdown rendered, editable after session ends
- Tabs if multiple artifacts produced (e.g., design doc + requirements list)

### Header bar

- Back arrow → returns to work item
- Work item identifier and title (e.g., "PROJ-42: User auth redesign")
- Current stage badge
- Session type label (e.g., "CEO Review")

### On session completion

1. Artifact saved to work item
2. Activity record created (e.g., "CEO Review completed — plan scored 8/10")
3. Stage auto-advance evaluated
4. User returned to work item detail page

---

## 4. Breakdown Stage — Task Generation

The breakdown stage produces **child work items**, not just documents.

### Split view — right panel as task tree

When "Launch Breakdown" is clicked:
- Opens the same split view, but right panel shows a **task tree**
- Chat session takes plan artifact(s) from the planning stage as input
- Claude proposes epics and tasks based on the plan
- As tasks are proposed in chat, they appear in the right panel

### Task tree editor (right panel)

- Hierarchical view: Epic → Task
- Each item shows: title, estimated complexity, dependencies
- Inline editing — rename, reorder, re-parent, delete
- "Add task" button for manual additions
- Dependency lines between tasks (simple arrows)
- Builds on the existing `planDrafts` model — tasks stay as drafts until committed

### Commit flow

1. User clicks "Commit tasks"
2. Drafts become real work items (issues/epics/tasks) linked to the parent
3. Stage advances to `ready`
4. User lands back on work item detail page with child items visible

### From `ready` → `dispatched`

Existing dispatch flow — select tasks, assign agents, set concurrency. No changes needed; `/planning/dispatch/[batchId]` handles this.

---

## 5. Navigation & Entry Points

### From `/planning` (existing page)

- Projects view shows project cards as today
- Add filter/view toggle: "All" | "Needs Planning" — showing work items in early pipeline stages
- Clicking a work item goes to its detail page with pipeline view

### From `/projects/[projectId]`

- Issues tab gains a "Planning" column or badge showing pipeline stage
- New "Create & Plan" button — creates a work item and immediately launches first session (office hours)
- Issues sorted/grouped by planning stage

### From a work item directly

- Pipeline header always visible on any issue or epic
- If the item is in `idea` stage, prominent CTA: "Start shaping this"

### Breadcrumbs in split view

`Planning > Project Name > PROJ-42 > CEO Review` — each segment clickable

### No changes to

- Existing dispatch flow
- Existing workspace/execution view
- Mission control dashboard
- Task-level work item pages (tasks don't have their own planning pipeline — they're the output of it)
