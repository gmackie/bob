export const mockSession = {
  id: "test-session-id",
  title: "Test Session",
  repositoryId: "repo-123",
  worktreeId: "worktree-456",
  workingDirectory: "/path/to/worktree",
  agentType: "opencode",
  status: "running",
  nextSeq: 10,
  lastActivityAt: new Date().toISOString(),
  lastError: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  repository: {
    id: "repo-123",
    name: "test-repo",
    path: "/path/to/repo",
  },
  worktree: {
    id: "worktree-456",
    branch: "feature/test",
    path: "/path/to/worktree",
  },
};

export const mockSessionList = {
  items: [mockSession],
  nextCursor: undefined,
};
