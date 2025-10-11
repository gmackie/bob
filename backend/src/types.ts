export interface Repository {
  id: string;
  name: string;
  path: string;
  branch: string;
  mainBranch: string; // The default/main branch (main, master, etc.)
  worktrees: Worktree[];
}

export interface Worktree {
  id: string;
  path: string;
  branch: string;
  repositoryId: string;
  preferredAgent?: AgentType;
  instances: AgentInstance[];
  isMainWorktree: boolean;
}

export interface AgentInstance {
  id: string;
  worktreeId: string;
  repositoryId: string;
  agentType: AgentType;
  status: 'starting' | 'running' | 'stopped' | 'error';
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
}

export interface StartInstanceRequest {
  worktreeId: string;
  repositoryId: string;
  agentType?: AgentType;
}

export type AgentType = 'claude' | 'cursor-agent' | 'codex' | 'gemini' | 'amazon-q' | 'opencode';

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
  checkAvailability(): Promise<{ isAvailable: boolean; version?: string; statusMessage?: string }>;

  // Check authentication status
  checkAuthentication(): Promise<{ isAuthenticated: boolean; authenticationStatus?: string; statusMessage?: string }>;

  // Start the agent process
  startProcess(worktreePath: string, port?: number): Promise<any>; // ChildProcess or IPty

  // Get process spawn arguments
  getSpawnArgs(options?: { interactive?: boolean; port?: number }): { command: string; args: string[]; env?: Record<string, string> };

  // Parse agent-specific output for token usage or other metrics
  parseOutput?(output: string): { inputTokens?: number; outputTokens?: number; cost?: number } | null;

  // Agent-specific cleanup
  cleanup?(process: any): Promise<void>;
}