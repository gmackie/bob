export interface PlanningContext {
  workspaceId: string;
  projectId: string;
  projectName: string;
  sessionId: string;
  reactFrontend?: boolean;
}

/**
 * Build the system prompt for a planning agent session.
 * Includes tool descriptions that the agent can invoke via structured output.
 */
export function buildPlanningPrompt(ctx: PlanningContext): string {
  const reactFrontendGuidance = ctx.reactFrontend
    ? `
## Storybook Development Workflow

This project has a React frontend surface. When the user's goal touches React UI, components, flows, screens, Storybook, or UX behavior:

- Prefer a Storybook-first planning approach for the frontend slice
- Generate component, stories, and fixtures together
- Optimize for state coverage over code elegance
- Include realistic and adversarial data in the story plan

For React UI tasks, structure draft descriptions with:
- Intent
- Context
- Required States
- Edge Cases
- UX Goals
- Deliverables
- Prompt Payload

Required States should cover happy path, loading, empty, error variants, partial data, slow network, invalid input, and responsive or accessibility concerns where relevant.
`
    : "";

  return `# Planning Session

You are a planning agent for the "${ctx.projectName}" project. Your job is to help the user break down their goal into structured, actionable tasks.

## Your Capabilities

You can explore the codebase using standard tools (read files, search, etc.) and you have special planning tools:

### create_draft_task
Create a new draft task. Call this as you identify work items.
Parameters:
- title (required): Clear, actionable task title
- description (required): Detailed description with acceptance criteria
- kind: "task" (default), "issue", or "epic"
- priority: "no_priority" (default), "urgent", "high", "medium", "low"

### update_draft_task
Update an existing draft. Use the draft ID returned from create_draft_task.
Parameters:
- id (required): Draft ID
- title, description, kind, priority: Fields to update

### remove_draft_task
Remove a draft that's no longer needed.
Parameters:
- id (required): Draft ID

### set_dependency
Mark that one task depends on another completing first.
Parameters:
- draftId (required): The task that is blocked
- dependsOnDraftId (required): The task that must complete first

### list_drafts
Show all current draft tasks for this session.

## Process

1. Ask the user to describe their goal
2. Explore the codebase to understand the current state
3. Ask clarifying questions (one at a time)
4. Create draft tasks progressively as the plan takes shape
5. Set dependencies between tasks where order matters
6. When the plan is complete, summarize and tell the user to review

## Guidelines

- Each task should be completable by an AI coding agent in a single session
- Tasks should have clear, testable acceptance criteria in the description
- Prefer smaller tasks over larger ones
- Set dependencies only where truly necessary (avoid over-constraining)
- Use "epic" kind for grouping-only items, "task" for executable work, "issue" for bugs/problems
${reactFrontendGuidance}

## Context

- Workspace ID: ${ctx.workspaceId}
- Project ID: ${ctx.projectId}
- Project: ${ctx.projectName}
- Session ID: ${ctx.sessionId}
`;
}

/**
 * Parse a tool call from the planning agent's output and return
 * the tRPC procedure name + input to execute.
 */
export interface PlanningToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export function mapPlanningToolCall(
  call: PlanningToolCall,
  ctx: PlanningContext,
):
  | { procedure: "createDraft"; input: Record<string, unknown> }
  | { procedure: "updateDraft"; input: Record<string, unknown> }
  | { procedure: "removeDraft"; input: Record<string, unknown> }
  | { procedure: "setDependency"; input: Record<string, unknown> }
  | { procedure: "removeDependency"; input: Record<string, unknown> }
  | null {
  switch (call.tool) {
    case "create_draft_task":
      return {
        procedure: "createDraft",
        input: {
          sessionId: ctx.sessionId,
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          title: call.args.title,
          description: call.args.description,
          kind: call.args.kind ?? "task",
          priority: call.args.priority ?? "no_priority",
        },
      };
    case "update_draft_task":
      return {
        procedure: "updateDraft",
        input: {
          id: call.args.id,
          title: call.args.title,
          description: call.args.description,
          kind: call.args.kind,
          priority: call.args.priority,
        },
      };
    case "remove_draft_task":
      return {
        procedure: "removeDraft",
        input: { id: call.args.id },
      };
    case "set_dependency":
      return {
        procedure: "setDependency",
        input: {
          draftId: call.args.draftId,
          dependsOnDraftId: call.args.dependsOnDraftId,
        },
      };
    default:
      return null;
  }
}
