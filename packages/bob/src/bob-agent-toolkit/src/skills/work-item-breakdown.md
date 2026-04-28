---
name: work-item-breakdown
description: Use when a Bob epic, issue, business requirements document, or requirement set needs to become executable child tasks - turns parent scope into linked tasks, dependencies, and requirement ownership while teaching the Bob lifecycle from shape through ship
---

# Work Item Breakdown

## Overview

Break work downward from the parent scope. In Bob, the parent issue or epic owns the problem, BRD, and requirements. Child tasks own execution.

## When to Use

- An epic already exists and needs to be turned into child tasks
- An issue has a stable set of requirements and is ready for planning
- A BRD exists and needs to be converted into Bob requirements plus tasks
- A user wants to understand how tasks, requirements, and lifecycle stages should connect in Bob

Do not use this to brainstorm raw ideas. Use shaping first.

## Quick Reference

| Source | First move |
| --- | --- |
| Parent epic or issue with no requirements | Extract or write requirements first |
| BRD with clear scope | Convert BRD sections into Bob requirements |
| Parent with requirements already present | Create child tasks and assign ownership |

## Breakdown Workflow

1. Read the parent issue or epic description.
2. Read the BRD or `documentation` artifact if present.
3. Normalize the source material into concrete Bob requirements on the parent item.
4. Create child tasks under the parent issue or epic.
5. Make each task small enough for one coding session.
6. Add acceptance criteria and package or system boundaries to each task.
7. Set dependencies only where order truly matters.
8. Link each requirement to its primary owning task.

## Bob Linking Rules

- Requirements stay on the parent issue or epic.
- Executable work becomes child tasks beneath that parent.
- Use `linkedTaskId` to link each requirement to the task that primarily owns it.
- If multiple tasks contribute to one requirement, choose one primary owner and mention supporting tasks in task descriptions.
- Keep task descriptions execution-focused. Do not copy the full BRD into every task.
- Only promote the parent issue or epic to a task when that parent item itself is ready for direct execution. Usually the parent remains a container.

## Lifecycle

- `shape`: parent issue or epic is created, and the BRD or requirement set is clarified
- `plan`: requirements are organized and child tasks are created
- `execute`: Bob runs child tasks in dependency order
- `review`: task outputs and combined changes are checked against the parent scope
- `ship`: the feature or fix lands and the parent closes when requirements are satisfied

This is the Bob lifecycle: `shape -> plan -> execute -> review -> ship`.

## Good Task Pattern

- One primary outcome
- Clear acceptance criteria
- Explicit ownership of the layer or subsystem
- Minimal dependencies
- Small enough for one agent session

## Example

If an epic has these parent requirements:

- `ui`: add project filters to the board
- `api`: support filtering by assignee
- `test`: verify filtered board states

Then create child tasks such as:

- UI task for board filter controls
- API task for filter support
- Test task for end-to-end verification

Link each requirement's `linkedTaskId` to the task that primarily owns it.

## Common Mistakes

- Creating tasks before the parent requirements are stable
- Leaving requirements unlinked to any task
- Writing giant umbrella tasks that span many layers
- Turning dependencies into a dense graph when the order is not real
- Treating parent epics as if they should execute directly

## Red Flags

- A parent epic has many child tasks but no requirement list
- Requirements have no owning task
- Every task repeats the whole BRD
- The plan has more dependency edges than actual sequencing needs
