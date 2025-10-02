import { AgentAdapter, AgentType, AgentInfo } from '../types.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { GeminiAdapter } from './gemini-adapter.js';
import { AmazonQAdapter } from './amazon-q-adapter.js';
import { OpenCodeAdapter } from './opencode-adapter.js';
import { CursorAgentAdapter } from './cursor-agent-adapter.js';
import { appConfig } from '../config/app.config.js';

export class AgentFactory {
  private adapters: Map<AgentType, AgentAdapter> = new Map();
  private initialized = false;

  constructor() {
    this.registerAdapters();
  }

  private registerAdapters(): void {
    // Register all available agent adapters
    const allAdapters: [AgentType, AgentAdapter][] = [
      ['claude', new ClaudeAdapter()],
      ['codex', new CodexAdapter()],
      ['gemini', new GeminiAdapter()],
      ['amazon-q', new AmazonQAdapter()],
      ['opencode', new OpenCodeAdapter()],
      ['cursor-agent', new CursorAgentAdapter()]
    ];

    // Filter adapters based on app configuration
    for (const [type, adapter] of allAdapters) {
      if (appConfig.isAgentAllowed(type)) {
        this.adapters.set(type, adapter);
      }
    }
  }

  /**
   * Get an agent adapter by type
   */
  getAdapter(type: AgentType): AgentAdapter | null {
    return this.adapters.get(type) || null;
  }

  /**
   * Get all registered agent types
   */
  getAvailableTypes(): AgentType[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get all registered agent adapters
   */
  getAllAdapters(): AgentAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Get information about all agents including availability and authentication status
   */
  async getAgentInfo(): Promise<AgentInfo[]> {
    const agentInfo: AgentInfo[] = [];

    for (const adapter of this.adapters.values()) {
      try {
        const [availability, authentication] = await Promise.all([
          adapter.checkAvailability(),
          adapter.checkAuthentication()
        ]);

        agentInfo.push({
          type: adapter.type,
          name: adapter.name,
          command: adapter.command,
          version: availability.version,
          isAvailable: availability.isAvailable,
          isAuthenticated: authentication.isAuthenticated,
          authenticationStatus: authentication.authenticationStatus,
          statusMessage: availability.isAvailable
            ? (authentication.isAuthenticated ? 'Ready' : authentication.statusMessage)
            : availability.statusMessage
        });
      } catch (error) {
        agentInfo.push({
          type: adapter.type,
          name: adapter.name,
          command: adapter.command,
          isAvailable: false,
          isAuthenticated: false,
          statusMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return agentInfo;
  }

  /**
   * Get information about a specific agent
   */
  async getAgentInfoById(type: AgentType): Promise<AgentInfo | null> {
    const adapter = this.getAdapter(type);
    if (!adapter) {
      return null;
    }

    try {
      const [availability, authentication] = await Promise.all([
        adapter.checkAvailability(),
        adapter.checkAuthentication()
      ]);

      return {
        type: adapter.type,
        name: adapter.name,
        command: adapter.command,
        version: availability.version,
        isAvailable: availability.isAvailable,
        isAuthenticated: authentication.isAuthenticated,
        authenticationStatus: authentication.authenticationStatus,
        statusMessage: availability.isAvailable
          ? (authentication.isAuthenticated ? 'Ready' : authentication.statusMessage)
          : availability.statusMessage
      };
    } catch (error) {
      return {
        type: adapter.type,
        name: adapter.name,
        command: adapter.command,
        isAvailable: false,
        isAuthenticated: false,
        statusMessage: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Check if an agent type is supported
   */
  isSupported(type: AgentType): boolean {
    return this.adapters.has(type);
  }

  /**
   * Get available (installed and ready) agents
   */
  async getAvailableAgents(): Promise<AgentType[]> {
    const agentInfo = await this.getAgentInfo();
    return agentInfo
      .filter(info => info.isAvailable && info.isAuthenticated)
      .map(info => info.type);
  }

  /**
   * Get the default agent type (first available, preferring Claude)
   */
  async getDefaultAgentType(): Promise<AgentType> {
    const availableAgents = await this.getAvailableAgents();

    // Prefer Claude if available
    if (availableAgents.includes('claude')) {
      return 'claude';
    }

    // Otherwise return the first available agent
    if (availableAgents.length > 0) {
      return availableAgents[0];
    }

    // Fallback to Claude even if not available
    return 'claude';
  }

  /**
   * Start an agent process for a specific worktree
   */
  async startAgent(type: AgentType, worktreePath: string, port?: number): Promise<any> {
    const adapter = this.getAdapter(type);
    if (!adapter) {
      throw new Error(`Agent type '${type}' is not supported`);
    }

    // Check if agent is available before starting
    const availability = await adapter.checkAvailability();
    if (!availability.isAvailable) {
      throw new Error(`Agent '${type}' is not available: ${availability.statusMessage}`);
    }

    // Check authentication if required
    const authentication = await adapter.checkAuthentication();
    if (!authentication.isAuthenticated) {
      throw new Error(`Agent '${type}' is not authenticated: ${authentication.statusMessage}`);
    }

    return adapter.startProcess(worktreePath, port);
  }

  /**
   * Parse output from an agent if it supports output parsing
   */
  parseAgentOutput(type: AgentType, output: string): { inputTokens?: number; outputTokens?: number; cost?: number } | null {
    const adapter = this.getAdapter(type);
    if (!adapter || !adapter.parseOutput) {
      return null;
    }
    return adapter.parseOutput(output);
  }

  /**
   * Clean up an agent process
   */
  async cleanupAgent(type: AgentType, process: any): Promise<void> {
    const adapter = this.getAdapter(type);
    if (!adapter || !adapter.cleanup) {
      // Default cleanup
      if (process && typeof process.kill === 'function') {
        process.kill();
      }
      return;
    }

    return adapter.cleanup(process);
  }
}

// Export singleton instance
export const agentFactory = new AgentFactory();