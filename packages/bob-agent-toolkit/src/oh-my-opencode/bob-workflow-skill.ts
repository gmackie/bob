export interface BuiltinSkill {
  name: string;
  description: string;
  template: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  allowedTools?: string[];
  agent?: string;
  model?: string;
  subtask?: boolean;
  argumentHint?: string;
  mcpConfig?: {
    mcpServers: Record<
      string,
      {
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }
    >;
  };
}

export const bobWorkflowSkill: BuiltinSkill = {
  name: "bob-workflow",
  description:
    "Workflow and status reporting for Bob-managed sessions. Use when working in a Bob session to report progress, request input, and manage tasks.",
  template: `# Bob Workflow Skill

You are working in a Bob-managed session. Bob provides tools for status reporting, input gathering, and task management.

## Session Context

Your session has:
- A unique \`BOB_SESSION_ID\` (check environment)
- Optional linked Kanbanger task
- Optional linked repository/worktree

Use \`get_session\` to understand your context at the start of work.

## Workflow Status

Report your status regularly using \`update_status\`:

1. **Start of work**: Call \`update_status\` with status="working" and describe what you're doing
2. **Phase changes**: Update status when moving between phases (planning, implementation, testing)
3. **Completion**: Call \`update_status\` with status="completed" when done

Example:
\`\`\`
update_status(status="working", message="Starting implementation of feature X", phase="implementation")
\`\`\`

## Requesting Human Input

When you need clarification or a decision, use \`request_input\`:

\`\`\`
request_input(
  question="Should I use React or Vue for the frontend?",
  options=["React", "Vue", "Let me decide"],
  default_action="proceed with React as it's already in the project"
)
\`\`\`

Key behaviors:
- Provide sensible default actions so work can continue if no response
- Default timeout is 30 minutes
- The human can respond via the Bob UI or Kanbanger task comments
- After resolution, you'll transition back to "working" status

## Being Blocked

If you encounter an issue that requires human intervention:

\`\`\`
mark_blocked(
  reason="Cannot proceed - missing database credentials",
  blockers=["DATABASE_URL not configured", "No access to production DB"]
)
\`\`\`

This will:
- Set your status to "blocked"
- Post a notification to Kanbanger (if task linked)
- Wait for human to resolve the issue

## Pull Requests

When you create a PR, use the Bob tools:

\`\`\`
create_pr(
  title="feat: Add user authentication",
  body="## Summary\\n- Adds JWT auth\\n- Adds login/logout endpoints",
  head_branch="feature/auth",
  base_branch="main"
)
\`\`\`

After creating a PR, submit for review:

\`\`\`
submit_for_review(
  pr_url="https://github.com/org/repo/pull/123",
  summary="Implemented JWT auth with login/logout endpoints"
)
\`\`\`

## Task Integration

If working on a Kanbanger task:

1. Task is auto-linked when session starts from task
2. Use \`post_task_comment\` to share progress updates
3. Use \`complete_task\` when finished:

\`\`\`
complete_task(
  summary="Implemented user authentication with JWT",
  pr_url="https://github.com/org/repo/pull/123"
)
\`\`\`

## Best Practices

1. **Report early, report often** - Regular status updates help humans track progress
2. **Use request_input sparingly** - Only for decisions that truly need human input
3. **Provide good defaults** - Always have a sensible default_action
4. **Be specific in blockers** - Clear descriptions help humans resolve issues faster
5. **Link work to tasks** - Use task tools to maintain traceability

## Available Tools

### Status Tools
- \`update_status\` - Report workflow status
- \`request_input\` - Ask for human input
- \`mark_blocked\` - Report blocking issues
- \`submit_for_review\` - Submit work for review

### Context Tools
- \`get_session\` - Get session info
- \`get_task_context\` - Get linked task details
- \`get_workflow_state\` - Check current workflow state
- \`list_session_prs\` - List PRs in this session

### PR Tools
- \`create_pr\` - Create a pull request
- \`update_pr\` - Update PR title/body/state
- \`get_pr_status\` - Get PR details
- \`merge_pr\` - Merge a PR
- \`refresh_pr\` - Refresh PR from remote

### Task Tools
- \`link_task\` - Link a Kanbanger task
- \`post_task_comment\` - Comment on linked task
- \`complete_task\` - Mark task complete
- \`update_task_status\` - Change task status
`,
  mcpConfig: {
    mcpServers: {
      bob: {
        command: "npx",
        args: ["@bob/mcp-server"],
        env: {
          BOB_API_URL: "${env:BOB_API_URL}",
          BOB_API_KEY: "${env:BOB_API_KEY}",
          BOB_SESSION_ID: "${env:BOB_SESSION_ID}",
        },
      },
    },
  },
  allowedTools: [
    "update_status",
    "request_input",
    "mark_blocked",
    "submit_for_review",
    "get_session",
    "get_task_context",
    "get_workflow_state",
    "list_session_prs",
    "create_pr",
    "update_pr",
    "get_pr_status",
    "merge_pr",
    "refresh_pr",
    "link_task",
    "post_task_comment",
    "complete_task",
    "update_task_status",
  ],
};
