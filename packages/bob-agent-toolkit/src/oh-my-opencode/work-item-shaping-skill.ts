import type { BuiltinSkill } from "./bob-workflow-skill.js";

export const workItemShapingSkill: BuiltinSkill = {
  name: "work-item-shaping",
  description:
    "Question-driven shaping for turning rough ideas into Bob epics or issues, plus BRDs and requirement sets.",
  template: `# Work Item Shaping

Use this when the user is past a raw idea and needs help shaping it into a Bob work item.

## Core Rule

Chat one question at a time until the work is clear enough to become an epic or issue with a real business requirements document.

## Choose the Right Container

- Use an \`epic\` for a feature, initiative, or multi-step outcome that will break into child tasks
- Use an \`issue\` for a bug, incident, operational problem, or narrow fix that still needs shaping
- Use a \`task\` only when the work is already executable in one agent session

## Shaping Workflow

1. Start from the user outcome, not the proposed implementation
2. Ask one question at a time to clarify users, scope, constraints, and success signals
3. Decide whether the result should be an epic or issue
4. Write a concise parent work item description with problem, scope, non-goals, risks, and success measures
5. If the document is long, attach a BRD or business requirements document as a current \`documentation\` artifact
6. Extract concrete requirements onto the parent epic or issue before creating child tasks

## Bob Linking Rules

- Requirements belong on the parent issue or epic
- Child tasks should not own the source-of-truth BRD
- Keep the BRD in the parent description or a \`documentation\` artifact, then break it into requirement rows
- Leave the parent as an epic or issue unless that item itself becomes directly executable

## Minimum Output

- Parent work item kind: epic or issue
- Clear title
- Description with user problem, scope, constraints, and success signals
- BRD or business requirements document when the work is large enough to need one
- Initial requirement categories such as data, api, ui, infra, test, or other

## Avoid

- Turning rough ideas directly into tasks
- Asking a long survey instead of one question at a time
- Mixing requirements and implementation steps together
- Creating child tasks before the parent scope is stable
`,
};
