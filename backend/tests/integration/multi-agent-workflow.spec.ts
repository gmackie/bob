import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GitService } from '../../src/services/git';
import { AgentService } from '../../src/services/agent';
import { DatabaseService } from '../../src/database/database';
import { AgentFactory } from '../../src/agents/agent-factory';
import { AgentType } from '../../src/types';

describe('Multi-Agent Workflow Integration Tests', () => {
  let db: DatabaseService;
  let gitService: GitService;
  let agentService: AgentService;
  let agentFactory: AgentFactory;

  beforeAll(async () => {
    // Setup in-memory database for testing
    db = new DatabaseService(':memory:');
    await db.init();

    gitService = new GitService(db);
    agentService = new AgentService(gitService, db);
    agentFactory = new AgentFactory();
  });

  afterAll(async () => {
    await db.close();
  });

  describe('End-to-End Worktree Creation with Different Agents', () => {
    it('should create worktree with Claude agent', async () => {
      // Mock repository
      const repo = await gitService.addRepository('/test/repo-claude');

      // Create worktree with Claude
      const worktree = await gitService.createWorktree(
        repo.id,
        'feature-claude-test',
        undefined,
        'claude'
      );

      expect(worktree).toBeDefined();
      expect(worktree.preferredAgent).toBe('claude');
      expect(worktree.branch).toBe('feature-claude-test');
    });

    it('should create worktree with Codex agent', async () => {
      const repo = await gitService.addRepository('/test/repo-codex');

      const worktree = await gitService.createWorktree(
        repo.id,
        'feature-codex-test',
        undefined,
        'codex'
      );

      expect(worktree.preferredAgent).toBe('codex');
    });

    it('should create worktree with Gemini agent', async () => {
      const repo = await gitService.addRepository('/test/repo-gemini');

      const worktree = await gitService.createWorktree(
        repo.id,
        'feature-gemini-test',
        undefined,
        'gemini'
      );

      expect(worktree.preferredAgent).toBe('gemini');
    });
  });

  describe('Agent Instance Lifecycle Management', () => {
    it('should start instance with preferred agent', async () => {
      const repo = await gitService.addRepository('/test/repo-lifecycle');
      const worktree = await gitService.createWorktree(
        repo.id,
        'test-lifecycle',
        undefined,
        'codex'
      );

      // Mock agent availability
      vi.spyOn(agentFactory, 'getAgentInfo').mockResolvedValue([
        {
          type: 'codex' as AgentType,
          name: 'Codex',
          isAvailable: true,
          isAuthenticated: true,
          version: '1.0.0'
        }
      ]);

      const instance = await agentService.startInstance(worktree.id, 'codex');

      expect(instance).toBeDefined();
      expect(instance.agentType).toBe('codex');
      expect(instance.worktreeId).toBe(worktree.id);
      expect(instance.status).toMatch(/starting|running/);
    });

    it('should handle agent stop and restart', async () => {
      const repo = await gitService.addRepository('/test/repo-restart');
      const worktree = await gitService.createWorktree(
        repo.id,
        'test-restart',
        undefined,
        'claude'
      );

      const instance = await agentService.startInstance(worktree.id, 'claude');
      const instanceId = instance.id;

      // Stop instance
      await agentService.stopInstance(instanceId);
      const stoppedInstance = agentService.getInstance(instanceId);
      expect(stoppedInstance?.status).toBe('stopped');

      // Restart instance
      const restartedInstance = await agentService.restartInstance(instanceId);
      expect(restartedInstance).toBeDefined();
      expect(restartedInstance.id).not.toBe(instanceId); // New instance created
      expect(restartedInstance.agentType).toBe('claude');
    });
  });

  describe('Agent Switching Scenarios', () => {
    it('should switch from one agent to another', async () => {
      const repo = await gitService.addRepository('/test/repo-switch');
      const worktree = await gitService.createWorktree(
        repo.id,
        'test-switch',
        undefined,
        'claude'
      );

      // Start with Claude
      const claudeInstance = await agentService.startInstance(worktree.id, 'claude');
      expect(claudeInstance.agentType).toBe('claude');

      // Stop Claude
      await agentService.stopInstance(claudeInstance.id);

      // Start with Gemini
      const geminiInstance = await agentService.startInstance(worktree.id, 'gemini');
      expect(geminiInstance.agentType).toBe('gemini');
      expect(geminiInstance.worktreeId).toBe(worktree.id);
    });

    it('should handle multiple agents for same repository', async () => {
      const repo = await gitService.addRepository('/test/repo-multi');

      // Create multiple worktrees with different agents
      const worktree1 = await gitService.createWorktree(
        repo.id,
        'branch-claude',
        undefined,
        'claude'
      );

      const worktree2 = await gitService.createWorktree(
        repo.id,
        'branch-codex',
        undefined,
        'codex'
      );

      // Start instances
      const instance1 = await agentService.startInstance(worktree1.id, 'claude');
      const instance2 = await agentService.startInstance(worktree2.id, 'codex');

      expect(instance1.agentType).toBe('claude');
      expect(instance2.agentType).toBe('codex');

      // Verify both are tracked
      const instances = agentService.getInstancesByRepository(repo.id);
      expect(instances.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle unavailable agent gracefully', async () => {
      const repo = await gitService.addRepository('/test/repo-error');
      const worktree = await gitService.createWorktree(
        repo.id,
        'test-error',
        undefined,
        'unknown-agent' as AgentType
      );

      // Mock agent as unavailable
      vi.spyOn(agentFactory, 'getAgentInfo').mockResolvedValue([
        {
          type: 'unknown-agent' as AgentType,
          name: 'Unknown',
          isAvailable: false,
          isAuthenticated: false
        }
      ]);

      await expect(
        agentService.startInstance(worktree.id, 'unknown-agent' as AgentType)
      ).rejects.toThrow();
    });

    it('should fallback to available agent when preferred is unavailable', async () => {
      const repo = await gitService.addRepository('/test/repo-fallback');
      const worktree = await gitService.createWorktree(
        repo.id,
        'test-fallback',
        undefined,
        'codex'
      );

      // Mock Codex unavailable, Claude available
      vi.spyOn(agentFactory, 'getAgentInfo').mockResolvedValue([
        {
          type: 'codex' as AgentType,
          name: 'Codex',
          isAvailable: false,
          isAuthenticated: false
        },
        {
          type: 'claude' as AgentType,
          name: 'Claude',
          isAvailable: true,
          isAuthenticated: true,
          version: '1.0.0'
        }
      ]);

      // Should throw for unavailable agent
      await expect(
        agentService.startInstance(worktree.id, 'codex')
      ).rejects.toThrow();

      // But should work with available agent
      const instance = await agentService.startInstance(worktree.id, 'claude');
      expect(instance.agentType).toBe('claude');
    });
  });
});