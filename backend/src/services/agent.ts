import { ChildProcess } from 'child_process';
import { IPty } from 'node-pty';
import { AgentInstance, Worktree, AgentType } from '../types.js';
import { GitService } from './git.js';
import { DatabaseService } from '../database/database.js';
import { agentFactory } from '../agents/agent-factory.js';

export class AgentService {
  private instances = new Map<string, AgentInstance>();
  private processes = new Map<string, ChildProcess>();
  private ptyProcesses = new Map<string, IPty>();
  private nextPort = 3100;

  // Real-time token usage tracking
  private instanceTokenUsage = new Map<string, { input: number; output: number; cost: number }>();
  private usageCollectionIntervals = new Map<string, NodeJS.Timeout>();
  private cumulativeTokens = { input: 0, output: 0 };
  private sessionStartTimes = new Map<string, number>();

  constructor(private gitService: GitService, private db: DatabaseService) {
    this.loadFromDatabase();
  }

  private async loadFromDatabase(): Promise<void> {
    const instances = await this.db.getAllInstances();
    instances.forEach(instance => {
      // Only load non-running instances (running instances need to be restarted)
      if (instance.status !== 'running') {
        this.instances.set(instance.id, instance);

        // Add instance to worktree
        const worktree = this.gitService.getWorktree(instance.worktreeId);
        if (worktree) {
          worktree.instances.push(instance);
        }
      }
    });
  }

  async startInstance(worktreeId: string, agentType: AgentType = 'claude'): Promise<AgentInstance> {
    const worktree = this.gitService.getWorktree(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree ${worktreeId} not found`);
    }

    // Check if agent is supported and available
    if (!agentFactory.isSupported(agentType)) {
      throw new Error(`Agent type '${agentType}' is not supported`);
    }

    const agentInfo = await agentFactory.getAgentInfoById(agentType);
    if (!agentInfo?.isAvailable) {
      throw new Error(`Agent '${agentType}' is not available: ${agentInfo?.statusMessage || 'Unknown error'}`);
    }

    if (!agentInfo.isAuthenticated) {
      throw new Error(`Agent '${agentType}' is not authenticated: ${agentInfo.statusMessage || 'Authentication required'}`);
    }

    // Allow multiple agents per worktree - no restriction check here

    const instanceId = `${agentType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const port = this.nextPort++;

    const instance: AgentInstance = {
      id: instanceId,
      worktreeId,
      repositoryId: worktree.repositoryId,
      agentType,
      status: 'starting',
      port,
      createdAt: new Date(),
      lastActivity: new Date()
    };

    this.instances.set(instanceId, instance);
    worktree.instances.push(instance);

    await this.db.saveInstance(instance);

    try {
      const agentPty = await this.spawnAgentPty(instance, worktree);
      this.ptyProcesses.set(instanceId, agentPty);

      instance.pid = agentPty.pid;
      instance.status = 'running';

      await this.db.saveInstance(instance);

      this.setupPtyHandlers(instance, agentPty);

      // Start token usage collection for this instance
      this.startUsageCollection(instance.id);

      return instance;
    } catch (error) {
      instance.status = 'error';
      instance.errorMessage = error instanceof Error ? error.message : String(error);
      await this.db.saveInstance(instance);
      throw new Error(`Failed to start ${agentType} instance: ${error}`);
    }
  }

  private async spawnAgentPty(instance: AgentInstance, worktree: Worktree): Promise<IPty> {
    console.log(`Starting ${instance.agentType} PTY in directory: ${worktree.path}`);

    // Use the agent factory to start the agent process
    try {
      return await agentFactory.startAgent(instance.agentType, worktree.path, instance.port);
    } catch (error) {
      console.error(`Failed to start ${instance.agentType} PTY:`, error);
      throw error;
    }
  }

  private setupPtyHandlers(instance: AgentInstance, agentPty: IPty): void {
    agentPty.onExit((exitCode) => {
      console.log(`${instance.agentType} PTY ${instance.id} exited with code ${exitCode}`);
      instance.status = 'stopped';
      this.ptyProcesses.delete(instance.id);

      // Stop token usage collection
      this.stopUsageCollection(instance.id);

      const worktree = this.gitService.getWorktree(instance.worktreeId);
      if (worktree) {
        worktree.instances = worktree.instances.filter(i => i.id !== instance.id);
      }

      this.instances.delete(instance.id);
      this.db.saveInstance(instance).catch(err => console.error('Failed to save instance:', err));
    });

    agentPty.onData((data: string) => {
      instance.lastActivity = new Date();
      this.db.updateInstanceActivity(instance.id).catch(err => console.error('Failed to update activity:', err));
    });
  }

  async stopInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    // Stop token usage collection
    this.stopUsageCollection(instanceId);

    // Handle PTY processes
    const agentPty = this.ptyProcesses.get(instanceId);
    if (agentPty) {
      // Use agent-specific cleanup if available
      await agentFactory.cleanupAgent(instance.agentType, agentPty);
      this.ptyProcesses.delete(instanceId);
    }

    // Handle regular processes (fallback)
    const agentProcess = this.processes.get(instanceId);
    if (agentProcess && !agentProcess.killed) {
      agentProcess.removeAllListeners();
      agentProcess.stdout?.removeAllListeners();
      agentProcess.stderr?.removeAllListeners();
      agentProcess.kill('SIGTERM');

      setTimeout(() => {
        if (!agentProcess.killed) {
          agentProcess.kill('SIGKILL');
        }
      }, 5000);
      this.processes.delete(instanceId);
    }

    instance.status = 'stopped';
    await this.db.saveInstance(instance);
  }

  async restartInstance(instanceId: string): Promise<AgentInstance> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    const worktree = this.gitService.getWorktree(instance.worktreeId);
    if (!worktree) {
      throw new Error(`Worktree ${instance.worktreeId} not found`);
    }

    await this.stopInstance(instanceId);

    // Wait a moment for the process to fully terminate
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      // Reset instance state for restart
      instance.status = 'starting';
      instance.pid = undefined;
      instance.errorMessage = undefined;
      instance.lastActivity = new Date();

      await this.db.saveInstance(instance);

      // Start the process directly without going through startInstance to avoid loop
      const agentPty = await this.spawnAgentPty(instance, worktree);
      this.ptyProcesses.set(instanceId, agentPty);

      instance.pid = agentPty.pid;
      instance.status = 'running';

      await this.db.saveInstance(instance);

      this.setupPtyHandlers(instance, agentPty);

      // Start token usage collection for restarted instance
      this.startUsageCollection(instance.id);

      console.log(`Successfully restarted instance ${instanceId}`);
      return instance;
    } catch (error) {
      instance.status = 'error';
      instance.errorMessage = error instanceof Error ? error.message : String(error);
      await this.db.saveInstance(instance);
      console.error(`Failed to restart instance ${instanceId}:`, error);
      throw new Error(`Failed to restart ${instance.agentType} instance: ${error}`);
    }
  }

  getInstances(): AgentInstance[] {
    return Array.from(this.instances.values());
  }

  getInstance(id: string): AgentInstance | undefined {
    return this.instances.get(id);
  }

  getInstancesByRepository(repositoryId: string): AgentInstance[] {
    return Array.from(this.instances.values()).filter(i => i.repositoryId === repositoryId);
  }

  getInstancesByWorktree(worktreeId: string): AgentInstance[] {
    return Array.from(this.instances.values()).filter(i => i.worktreeId === worktreeId);
  }

  getInstancesByAgentType(agentType: AgentType): AgentInstance[] {
    return Array.from(this.instances.values()).filter(i => i.agentType === agentType);
  }

  getProcess(instanceId: string): ChildProcess | undefined {
    return this.processes.get(instanceId);
  }

  getAgentProcess(instanceId: string): ChildProcess | undefined {
    return this.processes.get(instanceId);
  }

  getAgentPty(instanceId: string): IPty | undefined {
    return this.ptyProcesses.get(instanceId);
  }

  // Legacy methods for backward compatibility
  getClaudeProcess(instanceId: string): ChildProcess | undefined {
    return this.getAgentProcess(instanceId);
  }

  getClaudePty(instanceId: string): IPty | undefined {
    return this.getAgentPty(instanceId);
  }

  getTokenUsageStats(): {
    totalSessions: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    dailyUsage: Array<{
      date: string;
      inputTokens: number;
      outputTokens: number;
      sessions: number;
    }>;
    instanceUsage: Array<{
      instanceId: string;
      worktreeId: string;
      agentType: AgentType;
      inputTokens: number;
      outputTokens: number;
      lastActivity: Date;
    }>;
    hasRealData?: boolean;
  } {
    const now = Date.now();
    const instances = this.getInstances();
    const runningInstances = instances.filter(i => i.status === 'running');

    // Track running sessions
    runningInstances.forEach(instance => {
      if (!this.sessionStartTimes.has(instance.id)) {
        this.sessionStartTimes.set(instance.id, now);
      }
    });

    // Remove sessions that are no longer running
    const runningIds = new Set(runningInstances.map(i => i.id));
    for (const [sessionId] of this.sessionStartTimes) {
      if (!runningIds.has(sessionId)) {
        this.sessionStartTimes.delete(sessionId);
        this.instanceTokenUsage.delete(sessionId);
      }
    }

    // Use real token data from in-memory collection or fallback to simulated data
    const hasRealTokenData = this.cumulativeTokens.input > 0 || this.cumulativeTokens.output > 0;

    // Generate daily usage (simulate historical + real current data)
    const dailyUsage = [];
    const currentDate = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(currentDate);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const isToday = i === 0;

      let inputTokens, outputTokens;
      if (isToday && hasRealTokenData) {
        inputTokens = this.cumulativeTokens.input;
        outputTokens = this.cumulativeTokens.output;
      } else {
        // Historical simulation
        const dayActivity = instances.filter(instance => {
          const activityDate = new Date(instance.lastActivity || new Date());
          return activityDate.toDateString() === date.toDateString();
        }).length;
        const baseTokens = Math.max(100, dayActivity * 800 || 1200);
        inputTokens = Math.floor(baseTokens * (0.8 + i * 0.1));
        outputTokens = Math.floor(inputTokens * 0.35);
      }

      dailyUsage.push({
        date: dateStr,
        inputTokens,
        outputTokens,
        sessions: Math.max(1, runningInstances.length || 1)
      });
    }

    // Generate instance-specific usage from real data
    const instanceUsage = instances.map(instance => {
      const realUsage = this.instanceTokenUsage.get(instance.id);

      if (realUsage && (realUsage.input > 0 || realUsage.output > 0)) {
        return {
          instanceId: instance.id,
          worktreeId: instance.worktreeId,
          agentType: instance.agentType,
          inputTokens: realUsage.input,
          outputTokens: realUsage.output,
          lastActivity: instance.lastActivity || new Date()
        };
      } else {
        return {
          instanceId: instance.id,
          worktreeId: instance.worktreeId,
          agentType: instance.agentType,
          inputTokens: 0,
          outputTokens: 0,
          lastActivity: instance.lastActivity || new Date()
        };
      }
    });

    const totalInputTokens = hasRealTokenData ?
      instanceUsage.reduce((sum, instance) => sum + instance.inputTokens, 0) :
      dailyUsage.reduce((sum, day) => sum + day.inputTokens, 0);

    const totalOutputTokens = hasRealTokenData ?
      instanceUsage.reduce((sum, instance) => sum + instance.outputTokens, 0) :
      dailyUsage.reduce((sum, day) => sum + day.outputTokens, 0);

    return {
      totalSessions: Math.max(instances.length, 1),
      totalInputTokens,
      totalOutputTokens,
      dailyUsage,
      instanceUsage,
      hasRealData: hasRealTokenData
    };
  }

  // Real-time token usage collection methods
  private startUsageCollection(instanceId: string): void {
    // Clear any existing interval for this instance
    this.stopUsageCollection(instanceId);

    // Start collecting usage every 30 seconds
    const interval = setInterval(() => {
      this.collectInstanceUsage(instanceId);
    }, 30000);

    this.usageCollectionIntervals.set(instanceId, interval);

    // Initial collection after a brief delay
    setTimeout(() => {
      this.collectInstanceUsage(instanceId);
    }, 5000);
  }

  private stopUsageCollection(instanceId: string): void {
    const interval = this.usageCollectionIntervals.get(instanceId);
    if (interval) {
      clearInterval(interval);
      this.usageCollectionIntervals.delete(instanceId);
    }

    // Clean up token usage data for this instance
    this.instanceTokenUsage.delete(instanceId);
    this.sessionStartTimes.delete(instanceId);
  }

  private async collectInstanceUsage(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.status !== 'running') {
      return;
    }

    const worktree = this.gitService.getWorktree(instance.worktreeId);
    if (!worktree) {
      return;
    }

    // Only collect usage for agents that support output parsing
    const adapter = agentFactory.getAdapter(instance.agentType);
    if (!adapter || !adapter.parseOutput) {
      return;
    }

    try {
      // For Claude, use the existing method
      if (instance.agentType === 'claude') {
        await this.collectClaudeUsage(instanceId, worktree);
      }
      // For other agents, we might need different collection strategies
      // For now, we'll only implement Claude usage collection
    } catch (error) {
      console.log(`Failed to collect usage for instance ${instanceId}:`, error);
    }
  }

  private async collectClaudeUsage(instanceId: string, worktree: Worktree): Promise<void> {
    try {
      const { spawn } = await import('child_process');
      const child = spawn('echo', ['Usage check'], {
        cwd: worktree.path,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Pipe the echo output to claude
      const claude = spawn('claude', ['--print', '--output-format', 'json'], {
        cwd: worktree.path,
        stdio: [child.stdout, 'pipe', 'pipe']
      });

      let output = '';
      claude.stdout?.on('data', (data) => {
        const MAX_OUTPUT_LENGTH = 50000;
        output += data.toString();
        if (output.length > MAX_OUTPUT_LENGTH) {
          output = output.slice(-MAX_OUTPUT_LENGTH / 2);
        }
      });

      claude.on('close', (code) => {
        if (code === 0 && output.trim()) {
          this.parseAgentOutput(instanceId, 'claude', output);
        }
      });

      claude.on('error', (error) => {
        console.log(`Agent usage collection error for ${instanceId}:`, error.message);
      });

    } catch (error) {
      console.log(`Failed to collect Claude usage for instance ${instanceId}:`, error);
    }
  }

  private parseAgentOutput(instanceId: string, agentType: AgentType, output: string): void {
    try {
      const usage = agentFactory.parseAgentOutput(agentType, output);
      if (!usage) {
        return;
      }

      const { inputTokens = 0, outputTokens = 0, cost = 0 } = usage;

      // Update instance-specific tracking
      const existing = this.instanceTokenUsage.get(instanceId) || { input: 0, output: 0, cost: 0 };
      this.instanceTokenUsage.set(instanceId, {
        input: existing.input + inputTokens,
        output: existing.output + outputTokens,
        cost: existing.cost + cost
      });

      // Update cumulative totals
      this.cumulativeTokens.input += inputTokens;
      this.cumulativeTokens.output += outputTokens;

      console.log(`Updated token usage for ${instanceId}: +${inputTokens} input, +${outputTokens} output`);
    } catch (error) {
      console.log(`Failed to parse ${agentType} output for ${instanceId}:`, error);
    }
  }

  async cleanup(): Promise<void> {
    // Clear all usage collection intervals
    for (const [instanceId, interval] of this.usageCollectionIntervals) {
      clearInterval(interval);
    }
    this.usageCollectionIntervals.clear();

    const stopPromises = Array.from(this.instances.keys()).map(id =>
      this.stopInstance(id).catch(error =>
        console.error(`Error stopping instance ${id}:`, error)
      )
    );

    await Promise.allSettled(stopPromises);
  }
}