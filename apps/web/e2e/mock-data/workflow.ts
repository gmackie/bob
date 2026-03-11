import type {
  WorkflowState,
  WorkflowStatus,
} from "~/app/chat/_components/session-header";

export const workflowStatuses: WorkflowStatus[] = [
  "started",
  "working",
  "awaiting_input",
  "blocked",
  "awaiting_review",
  "completed",
];

export const mockWorkflowStates: Record<WorkflowStatus, WorkflowState> = {
  started: {
    workflowStatus: "started",
    statusMessage: "Session initialized",
  },
  working: {
    workflowStatus: "working",
    statusMessage: "Implementing user authentication",
  },
  awaiting_input: {
    workflowStatus: "awaiting_input",
    statusMessage: "Need clarification on auth provider",
    awaitingInput: {
      question: "Which authentication provider should I use?",
      options: ["OAuth2 with Google", "Auth0", "Firebase Auth", "Custom JWT"],
      defaultAction: "OAuth2 with Google",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    },
  },
  blocked: {
    workflowStatus: "blocked",
    statusMessage: "Missing API credentials in .env file",
  },
  awaiting_review: {
    workflowStatus: "awaiting_review",
    statusMessage: "Implementation complete, ready for review",
  },
  completed: {
    workflowStatus: "completed",
    statusMessage: "Task completed successfully",
  },
};

export const mockAwaitingInputStates = {
  withOptions: {
    workflowStatus: "awaiting_input" as const,
    statusMessage: "Waiting for user input",
    awaitingInput: {
      question: "How would you like to proceed with the database migration?",
      options: ["Run migrations now", "Skip for now", "Review changes first"],
      defaultAction: "Skip for now",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    },
  },
  withoutOptions: {
    workflowStatus: "awaiting_input" as const,
    statusMessage: "Waiting for custom input",
    awaitingInput: {
      question: "What should be the name of the new component?",
      options: null,
      defaultAction: "NewComponent",
      expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    },
  },
  expiringSoon: {
    workflowStatus: "awaiting_input" as const,
    statusMessage: "Urgent input needed",
    awaitingInput: {
      question: "Confirm deployment to production?",
      options: ["Yes, deploy", "No, cancel"],
      defaultAction: "No, cancel",
      expiresAt: new Date(Date.now() + 30 * 1000).toISOString(),
    },
  },
  expired: {
    workflowStatus: "awaiting_input" as const,
    statusMessage: "Input timed out",
    awaitingInput: {
      question: "Which test framework should I use?",
      options: ["Jest", "Vitest", "Mocha"],
      defaultAction: "Vitest",
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  },
};

export const mockResolvedInputs = {
  humanResolved: {
    question: "Which authentication provider should I use?",
    resolution: {
      type: "human" as const,
      value: "Auth0",
    },
  },
  timeoutResolved: {
    question: "Should I add unit tests for this feature?",
    resolution: {
      type: "timeout" as const,
      value: "Yes, add comprehensive tests",
    },
  },
};

export const mockSessionWithWorkflow = {
  id: "session-workflow-test",
  title: "Feature Development Session",
  repositoryId: "repo-123",
  worktreeId: "worktree-456",
  workingDirectory: "/path/to/worktree",
  agentType: "opencode",
  status: "running",
  nextSeq: 25,
  lastActivityAt: new Date().toISOString(),
  lastError: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  repository: {
    id: "repo-123",
    name: "my-project",
    path: "/path/to/repo",
  },
  worktree: {
    id: "worktree-456",
    branch: "feature/auth-system",
    path: "/path/to/worktree",
  },
  linkedPr: {
    id: "pr-789",
    number: 42,
    title: "feat: Add user authentication system",
    status: "open",
    url: "https://github.com/org/repo/pull/42",
  },
  linkedTask: {
    id: "task-abc",
    identifier: "PROJ-123",
    title: "Implement user authentication",
    url: "https://linear.app/team/PROJ-123",
  },
};
