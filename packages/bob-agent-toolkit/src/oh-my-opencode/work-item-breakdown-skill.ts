import type { BuiltinSkill } from "./bob-workflow-skill.js";

export const workItemBreakdownSkill: BuiltinSkill = {
  name: "work-item-breakdown",
  description:
    "Breaks Bob epics, issues, BRDs, and requirement sets into linked child tasks with dependencies and lifecycle guidance.",
  template: `# Work Item Breakdown

Use this when a Bob epic, issue, BRD, or requirement set needs to become executable tasks.

## Core Rule

Break work from parent requirements downward. The parent issue or epic owns the scope, and child tasks own execution.

## Breakdown Workflow

1. Read the parent issue or epic description first
2. Read the BRD or business requirements document if one exists
3. Normalize the scope into concrete requirements on the parent work item
4. Create child tasks under the parent issue or epic
5. Make each task executable in one agent session with clear acceptance criteria
6. Set dependencies only where order is real
7. Link requirements to tasks so each requirement has a primary owner

## Bob Linking Rules

- Keep requirements on the parent issue or epic
- Create executable child tasks beneath that parent
- Use \`linkedTaskId\` to link each requirement to the task that primarily owns it
- If multiple tasks touch one requirement, choose one primary owner and note supporting tasks in descriptions
- Do not promote the parent to a task unless the parent itself should now execute directly

## Lifecycle

- \`shape\`: clarify the rough idea, create the parent work item, and capture the BRD
- \`plan\`: turn the BRD into categorized requirements and child tasks
- \`execute\`: run the child tasks, not the whole epic at once
- \`review\`: verify task outputs and combined feature review against the parent scope
- \`ship\`: merge, deploy, and close the work when the parent requirements are satisfied

This is the Bob lifecycle: shape -> plan -> execute -> review -> ship.

## Good Tasks

- One primary outcome
- Clear acceptance criteria
- Explicit package, layer, or system boundary when relevant
- Small enough for one coding session
- Named like work, not like a vague topic

## Avoid

- Rewriting the BRD inside every task
- Creating orphan tasks with no parent issue or epic
- Leaving requirements unowned
- Overusing dependencies
- Using child tasks for brainstorming instead of execution
`,
};
