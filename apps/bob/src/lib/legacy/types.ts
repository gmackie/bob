export interface Repository {
  id: string;
  name: string;
  path: string;
  branch: string;
  mainBranch: string;
  worktrees: Worktree[];
}

export interface Worktree {
  id: string;
  path: string;
  branch: string;
  repositoryId: string;
  instances: ClaudeInstance[];
  isMainWorktree: boolean;
}

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

export interface ClaudeInstance {
  id: string;
  worktreeId: string;
  repositoryId: string;
  agentType: AgentType;
  status: "starting" | "running" | "stopped" | "error";
  pid?: number;
  port?: number;
  createdAt: string;
  lastActivity?: string;
  errorMessage?: string;
}

export interface CreateWorktreeRequest {
  repositoryId: string;
  branchName: string;
  baseBranch?: string;
}

export interface StartInstanceRequest {
  worktreeId: string;
  repositoryId: string;
  agentType?: AgentType;
}

export interface AppConfig {
  appName: string;
  enableGithubAuth: boolean;
  jeffMode: boolean;
  allowedAgents: string[];
}
