export interface Repository {
  id: string;
  userId?: string;
  name: string;
  path: string;
  branch: string;
  mainBranch: string;
  worktrees: Worktree[];
}

export interface Worktree {
  id: string;
  userId?: string;
  path: string;
  branch: string;
  repositoryId: string;
  preferredAgent?: AgentType;
  instances: AgentInstance[];
  isMainWorktree: boolean;
}

export interface AgentInstance {
  id: string;
  userId?: string;
  worktreeId: string;
  repositoryId: string;
  agentType: AgentType;
  status: "starting" | "running" | "stopped" | "error";
  pid?: number;
  port?: number;
  createdAt: Date;
  lastActivity?: Date;
  errorMessage?: string;
}

// Legacy type alias for backward compatibility
export type ClaudeInstance = AgentInstance;

export interface CreateWorktreeRequest {
  repositoryId: string;
  branchName: string;
  baseBranch?: string;
  agentType?: AgentType;
  userId?: string;
}

export interface StartInstanceRequest {
  worktreeId: string;
  repositoryId: string;
  agentType?: AgentType;
  userId?: string;
}

export type WorkspaceRunStatus =
  | "CREATED"
  | "MATERIALIZED"
  | "CODING"
  | "TESTING"
  | "FAILED"
  | "PASSED"
  | "PENDING_APPROVAL"
  | "INTEGRATED"
  | "ABANDONED";

export interface WorkspaceRun {
  runId: string;
  userId?: string;
  taskId: string;
  workspaceId: string;
  repositoryId: string;
  agentId: string;
  baseRev: string;
  headRev: string;
  workspacePath: string;
  status: WorkspaceRunStatus;
  testStatus?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceOperation {
  id: string;
  userId?: string;
  runId: string;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  status: "running" | "succeeded" | "failed";
  resultJson?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceEventOutbox {
  eventId: string;
  userId?: string;
  eventType: string;
  runId: string;
  revId: string;
  payloadJson: string;
  publishedAt?: Date;
  deliveryStatus: "pending" | "published" | "failed";
  createdAt: Date;
}

export const DEFAULT_USER_ID = "default-user";

export type AgentType =
  | "claude"
  | "cursor-agent"
  | "codex"
  | "gemini"
  | "kiro"
  | "opencode";

export interface AgentInfo {
  type: AgentType;
  name: string;
  command: string;
  version?: string;
  isAvailable: boolean;
  isAuthenticated?: boolean;
  authenticationStatus?: string;
  statusMessage?: string;
}

export interface AgentAdapter {
  readonly type: AgentType;
  readonly name: string;
  readonly command: string;

  // Check if the agent is available and get version info
  checkAvailability(): Promise<{
    isAvailable: boolean;
    version?: string;
    statusMessage?: string;
  }>;

  // Check authentication status
  checkAuthentication(): Promise<{
    isAuthenticated: boolean;
    authenticationStatus?: string;
    statusMessage?: string;
  }>;

  // Start the agent process
  startProcess(worktreePath: string, port?: number): Promise<any>; // ChildProcess or IPty

  // Get process spawn arguments
  getSpawnArgs(options?: { interactive?: boolean; port?: number }): {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };

  // Parse agent-specific output for token usage or other metrics
  parseOutput?(
    output: string,
  ): { inputTokens?: number; outputTokens?: number; cost?: number } | null;

  // Agent-specific cleanup
  cleanup?(process: any): Promise<void>;
}
