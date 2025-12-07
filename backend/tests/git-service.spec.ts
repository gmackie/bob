import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitService } from '../src/services/git';
import { DatabaseService } from '../src/database/database';
import { AgentType } from '../src/types';

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn((cmd, opts, callback) => {
    if (callback) callback(null, { stdout: 'mock output', stderr: '' });
  })
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  statSync: vi.fn(() => ({ isDirectory: () => true })),
  mkdirSync: vi.fn()
}));

describe('GitService', () => {
  let gitService: GitService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      saveRepository: vi.fn(),
      saveWorktree: vi.fn(),
      getAllRepositories: vi.fn().mockResolvedValue([]),
      getRepositories: vi.fn().mockResolvedValue([]),
      getWorktreesByRepository: vi.fn().mockResolvedValue([]),
      deleteWorktree: vi.fn()
    };
    gitService = new GitService(mockDb as DatabaseService);
  });

  describe('createWorktree', () => {
    it('should create worktree with default agent type (claude)', async () => {
      const branchName = 'feature-test';

      // Add a repository first - it will generate its own ID
      const repo = await gitService.addRepository('/test/repo');
      const repoId = repo.id;

      const worktree = await gitService.createWorktree(repoId, branchName);

      expect(worktree).toBeDefined();
      expect(worktree.branch).toBe(branchName);
      expect(worktree.preferredAgent).toBe('claude');
      expect(mockDb.saveWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ preferredAgent: 'claude' })
      );
    });

    it('should create worktree with specified agent type', async () => {
      const branchName = 'feature-test';
      const agentType: AgentType = 'codex';

      // Add a repository first
      const repo = await gitService.addRepository('/test/repo');
      const repoId = repo.id;

      const worktree = await gitService.createWorktree(repoId, branchName, undefined, agentType);

      expect(worktree).toBeDefined();
      expect(worktree.branch).toBe(branchName);
      expect(worktree.preferredAgent).toBe('codex');
      expect(mockDb.saveWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ preferredAgent: 'codex' })
      );
    });

    it('should handle different agent types', async () => {
      const repo = await gitService.addRepository('/test/repo');
      const repoId = repo.id;

      const agents: AgentType[] = ['claude', 'codex', 'gemini', 'kiro', 'cursor-agent', 'opencode'];

      for (const agent of agents) {
        const worktree = await gitService.createWorktree(repoId, `branch-${agent}`, undefined, agent);
        expect(worktree.preferredAgent).toBe(agent);
      }
    });
  });
});