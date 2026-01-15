import { Repository, ClaudeInstance, Worktree, AgentType, AgentInfo } from './types';

// Use environment variable in production, otherwise use proxy path
const API_BASE = import.meta.env.MODE === 'production' && import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

class ApiClient {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const token = localStorage.getItem('authToken');
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers,
      ...options,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    // Handle 204 No Content responses
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  async getRepositories(): Promise<Repository[]> {
    return this.request('/repositories');
  }

  async addRepository(repositoryPath: string): Promise<Repository> {
    return this.request('/repositories/add', {
      method: 'POST',
      body: JSON.stringify({ repositoryPath }),
    });
  }

  async getRepository(id: string): Promise<Repository> {
    return this.request(`/repositories/${id}`);
  }

  async createWorktree(repositoryId: string, branchName: string, baseBranch?: string): Promise<Worktree> {
    return this.request(`/repositories/${repositoryId}/worktrees`, {
      method: 'POST',
      body: JSON.stringify({ branchName, baseBranch }),
    });
  }

  async refreshMainBranch(repositoryId: string): Promise<Repository> {
    return this.request(`/repositories/${repositoryId}/refresh-main`, {
      method: 'POST',
    });
  }

  async checkWorktreeMergeStatus(worktreeId: string): Promise<{ isMerged: boolean; targetBranch: string }> {
    return this.request(`/repositories/worktrees/${worktreeId}/merge-status`);
  }

  async removeWorktree(worktreeId: string, force: boolean = false): Promise<void> {
    return this.request(`/repositories/worktrees/${worktreeId}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
    });
  }

  async getInstances(): Promise<ClaudeInstance[]> {
    return this.request('/instances');
  }

  async getInstancesByRepository(repositoryId: string): Promise<ClaudeInstance[]> {
    return this.request(`/instances/repository/${repositoryId}`);
  }

  async startInstance(worktreeId: string, agentType?: AgentType): Promise<ClaudeInstance> {
    return this.request('/instances', {
      method: 'POST',
      body: JSON.stringify({ worktreeId, agentType }),
    });
  }

  async stopInstance(instanceId: string): Promise<void> {
    return this.request(`/instances/${instanceId}`, {
      method: 'DELETE',
    });
  }

  async restartInstance(instanceId: string): Promise<ClaudeInstance> {
    return this.request(`/instances/${instanceId}/restart`, {
      method: 'POST',
    });
  }

  async createTerminalSession(instanceId: string): Promise<{ sessionId: string }> {
    return this.request(`/instances/${instanceId}/terminal`, {
      method: 'POST',
    });
  }

  async createDirectoryTerminalSession(instanceId: string): Promise<{ sessionId: string }> {
    return this.request(`/instances/${instanceId}/terminal/directory`, {
      method: 'POST',
    });
  }

  async getTerminalSessions(instanceId: string): Promise<{ id: string; createdAt: string; type: 'claude' | 'directory' | 'unknown' }[]> {
    return this.request(`/instances/${instanceId}/terminals`);
  }

  // Agents
  async getAgents(): Promise<AgentInfo[]> {
    return this.request('/agents');
  }

  async closeTerminalSession(sessionId: string): Promise<void> {
    return this.request(`/instances/terminals/${sessionId}`, {
      method: 'DELETE',
    });
  }

  // System terminal (not tied to any instance)
  async createSystemTerminal(initialCommand?: string): Promise<{ sessionId: string }> {
    return this.request('/instances/system-terminal', {
      method: 'POST',
      body: JSON.stringify({ initialCommand }),
    });
  }

  // Git operations
  async getGitDiff(worktreeId: string): Promise<string> {
    const token = localStorage.getItem('authToken');
    const headers: Record<string, string> = {};

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}/git/${worktreeId}/diff`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.text();
  }

  async getGitStatus(worktreeId: string): Promise<{
    branch: string;
    ahead: number;
    behind: number;
    hasChanges: boolean;
    files: {
      staged: number;
      unstaged: number;
      untracked: number;
    };
  }> {
    return this.request(`/git/${worktreeId}/status`);
  }

  async getPRStatus(worktreeId: string): Promise<{
    exists: boolean;
    number?: number;
    title?: string;
    url?: string;
    state?: 'open' | 'closed' | 'merged';
  }> {
    return this.request(`/git/${worktreeId}/pr-status`);
  }

  async generateCommitMessage(worktreeId: string, comments?: any[]): Promise<{
    commitMessage: string;
    commitSubject?: string;
    commitBody?: string;
    changedFiles: string[];
    fileCount: number;
    fallback?: boolean;
  }> {
    return this.request(`/git/${worktreeId}/generate-commit-message`, {
      method: 'POST',
      body: JSON.stringify({ comments }),
    });
  }

  async commitChanges(worktreeId: string, message: string): Promise<{
    message: string;
    commitMessage: string;
  }> {
    return this.request(`/git/${worktreeId}/commit`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  async revertChanges(worktreeId: string): Promise<{ message: string }> {
    return this.request(`/git/${worktreeId}/revert`, {
      method: 'POST',
    });
  }

  async createPullRequest(worktreeId: string): Promise<{
    message: string;
    branch: string;
    title: string;
    description?: string;
    pr?: string;
  }> {
    return this.request(`/git/${worktreeId}/create-pr`, {
      method: 'POST',
    });
  }

  async updatePullRequest(worktreeId: string): Promise<{
    message: string;
    prNumber: number;
    title: string;
    description: string;
  }> {
    return this.request(`/git/${worktreeId}/update-pr`, {
      method: 'POST',
    });
  }

  async analyzeDiff(worktreeId: string): Promise<{
    analysis: {
      comments: Array<{
        file: string;
        line: number;
        type: 'suggestion' | 'warning' | 'error';
        message: string;
        severity: 'low' | 'medium' | 'high';
      }>;
      summary: string;
      analysisId: string;
    };
    diffAnalyzed: boolean;
  }> {
    return this.request(`/git/${worktreeId}/analyze-diff`, {
      method: 'POST',
    });
  }

  async getAnalysis(worktreeId: string): Promise<{
    analysis: {
      id: string;
      summary: string;
      timestamp: string;
    } | null;
    comments: Array<{
      id: string;
      file: string;
      line: number;
      type: 'suggestion' | 'warning' | 'error' | 'user';
      message: string;
      severity: 'low' | 'medium' | 'high';
      isAI: boolean;
      userReply?: string;
    }>;
  }> {
    return this.request(`/git/${worktreeId}/analysis`);
  }

  async addComment(worktreeId: string, data: {
    analysisId: string;
    file: string;
    line: number;
    message: string;
  }): Promise<{
    id: string;
    file: string;
    line: number;
    type: 'user';
    message: string;
    severity: 'low';
    isAI: false;
  }> {
    return this.request(`/git/${worktreeId}/comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateComment(worktreeId: string, commentId: string, data: {
    userReply?: string;
    isDismissed?: boolean;
  }): Promise<{ success: boolean }> {
    return this.request(`/git/${worktreeId}/comments/${commentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async applyCodeFixes(worktreeId: string): Promise<{
    success: boolean;
    message: string;
    fixesApplied: number;
    filesModified?: number;
    error?: string;
    details?: string;
    suggestion?: string;
  }> {
    return this.request(`/git/${worktreeId}/apply-fixes`, {
      method: 'POST',
    });
  }

  // Notes operations
  async getNotes(worktreeId: string): Promise<{
    content: string;
    fileName: string;
  }> {
    return this.request(`/git/${worktreeId}/notes`);
  }

  async saveNotes(worktreeId: string, content: string): Promise<{
    message: string;
    fileName: string;
    path: string;
  }> {
    return this.request(`/git/${worktreeId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  // System status and metrics
  async getSystemStatus(): Promise<{
    agents: Array<{
      type: string;
      name: string;
      command: string;
      isAvailable: boolean;
      version?: string;
      isAuthenticated?: boolean;
      authenticationStatus?: string;
      statusMessage?: string;
    }>;
    claude: {
      status: 'available' | 'not_available' | 'unknown';
      version: string;
    };
    github: {
      status: 'available' | 'not_available' | 'not_authenticated' | 'unknown';
      version: string;
      user: string;
    };
    metrics: {
      repositories: number;
      worktrees: number;
      totalInstances: number;
      activeInstances: number;
    };
    server: {
      uptime: number;
      memory: {
        rss: number;
        heapTotal: number;
        heapUsed: number;
        external: number;
      };
      nodeVersion: string;
    };
  }> {
    return this.request('/system-status');
  }

  // Database management operations
  async getDatabaseTables(): Promise<string[]> {
    return this.request('/database/tables');
  }

  async getTableSchema(tableName: string): Promise<any[]> {
    return this.request(`/database/tables/${tableName}/schema`);
  }

  async getTableData(tableName: string, page: number = 1, limit: number = 50): Promise<{
    data: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    return this.request(`/database/tables/${tableName}/data?page=${page}&limit=${limit}`);
  }

  async executeQuery(sql: string): Promise<any[]> {
    return this.request('/database/query', {
      method: 'POST',
      body: JSON.stringify({ sql }),
    });
  }

  async deleteRows(tableName: string, whereClause: string, confirm: boolean = false): Promise<{
    message: string;
    affectedRows: number;
  }> {
    return this.request(`/database/tables/${tableName}/rows`, {
      method: 'DELETE',
      body: JSON.stringify({ whereClause, confirm }),
    });
  }

  async updateRows(tableName: string, setClause: string, whereClause: string, confirm: boolean = false): Promise<{
    message: string;
    affectedRows: number;
  }> {
    return this.request(`/database/tables/${tableName}/rows`, {
      method: 'PUT',
      body: JSON.stringify({ setClause, whereClause, confirm }),
    });
  }

  // Repository dashboard specific APIs
  async getGitRemotes(repositoryId: string): Promise<Array<{
    name: string;
    url: string;
    type: 'fetch' | 'push';
  }>> {
    return this.request(`/repositories/${repositoryId}/remotes`);
  }

  async getGitBranches(repositoryId: string): Promise<Array<{
    name: string;
    isLocal: boolean;
    isRemote: boolean;
    isCurrent: boolean;
    lastCommit?: {
      hash: string;
      message: string;
      author: string;
      date: string;
    };
  }>> {
    return this.request(`/repositories/${repositoryId}/branches`);
  }

  async getGitGraph(repositoryId: string): Promise<Array<{
    hash: string;
    parents: string[];
    message: string;
    author: string;
    date: string;
    branch?: string;
    x: number;
    y: number;
  }>> {
    return this.request(`/repositories/${repositoryId}/graph`);
  }

  async getProjectNotes(repositoryId: string): Promise<string> {
    const response = await fetch(`${API_BASE}/repositories/${repositoryId}/notes`);
    if (!response.ok) {
      if (response.status === 404) {
        return ''; // No notes file exists yet
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.text();
  }

  async saveProjectNotes(repositoryId: string, notes: string): Promise<void> {
    return this.request(`/repositories/${repositoryId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    });
  }

  // Repository docs
  async getRepositoryDocs(repositoryId: string): Promise<Array<{
    name: string;
    relativePath: string;
    size: number;
    mtime: number;
  }>> {
    return this.request(`/repositories/${repositoryId}/docs`);
  }

  async getRepositoryDocContent(repositoryId: string, relativePath: string): Promise<string> {
    const response = await fetch(`${API_BASE}/repositories/${repositoryId}/docs/content?path=${encodeURIComponent(relativePath)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.text();
  }

  // GitHub repository operations
  async getGitHubRepos(search?: string): Promise<Array<{
    name: string;
    nameWithOwner: string;
    description: string | null;
    isPrivate: boolean;
    url: string;
  }>> {
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    return this.request(`/git/github/repos${params}`);
  }

  async getGitHubBranches(owner: string, repo: string): Promise<string[]> {
    return this.request(`/git/github/repos/${owner}/${repo}/branches`);
  }

  async cloneGitHubRepo(repoFullName: string, branch?: string): Promise<{
    message: string;
    repository: any;
    clonePath: string;
  }> {
    return this.request('/git/github/clone', {
      method: 'POST',
      body: JSON.stringify({ repoFullName, branch }),
    });
  }

  // Agent config operations
  async getAgentConfig(agentType: string): Promise<{
    agentType: string;
    configDir: string;
    files: Array<{
      name: string;
      path: string;
      exists: boolean;
      content?: string;
    }>;
  }> {
    return this.request(`/agents/${agentType}/config`);
  }

  async saveAgentConfig(agentType: string, fileName: string, content: string): Promise<{
    message: string;
    path: string;
  }> {
    return this.request(`/agents/${agentType}/config/${encodeURIComponent(fileName)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  }

  async createAgentConfigFile(agentType: string, fileName: string, content?: string): Promise<{
    message: string;
    path: string;
  }> {
    return this.request(`/agents/${agentType}/config`, {
      method: 'POST',
      body: JSON.stringify({ fileName, content }),
    });
  }

  async deleteAgentConfigFile(agentType: string, fileName: string): Promise<{
    message: string;
  }> {
    return this.request(`/agents/${agentType}/config/${encodeURIComponent(fileName)}`, {
      method: 'DELETE',
    });
  }

  // Agent Authentication
  async startAgentAuth(agentType: string): Promise<{ sessionId: string; agentType: string; status: string }> {
    return this.request('/agents/auth/start', {
      method: 'POST',
      body: JSON.stringify({ agentType, useLoginCommand: true }),
    });
  }

  async createAuthTerminalSession(sessionId: string): Promise<{ sessionId: string }> {
    return this.request(`/agents/auth/session/${sessionId}/terminal`, {
      method: 'POST',
    });
  }

  async cancelAuthSession(sessionId: string): Promise<void> {
    return this.request(`/agents/auth/session/${sessionId}/cancel`, {
      method: 'POST',
    });
  }

  async verifyAgentAuth(agentType: string): Promise<{
    type: string;
    ok: boolean;
    reason?: string;
    outputPreview?: string;
    error?: string;
    info?: any;
  }> {
    return this.request(`/agents/auth/verify/${agentType}`, {
      method: 'POST',
    });
  }
}

export const api = new ApiClient();
