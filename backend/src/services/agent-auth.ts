import { spawn, IPty } from 'node-pty';
import { AgentType } from '../types.js';
import { agentFactory } from '../agents/agent-factory.js';
import { getUserPathsService } from './user-paths.js';
import os from 'os';
import path from 'path';
import fs from 'fs';

/**
 * Supported authentication providers for agents
 */
export type AuthProvider = 'anthropic' | 'openai' | 'google' | 'github';

/**
 * Auth session state
 */
export interface AuthSession {
  id: string;
  agentType: AgentType;
  provider?: AuthProvider;
  status: 'pending' | 'authenticating' | 'success' | 'failed' | 'cancelled';
  pty: IPty;
  output: string;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * Auth command configuration per agent type
 */
interface AuthCommandConfig {
  // Command to check current auth status
  statusCommand: string[];
  // Command to initiate login (interactive)
  loginCommand: string[];
  // Alternative: TUI command that has /connect built-in
  tuiCommand?: string[];
  // Patterns that indicate successful auth
  successPatterns: RegExp[];
  // Patterns that indicate auth URL is being displayed
  urlPatterns: RegExp[];
  // Patterns that indicate failure
  failurePatterns: RegExp[];
}

/**
 * Auth commands for each supported agent
 */
const AUTH_COMMANDS: Partial<Record<AgentType, AuthCommandConfig>> = {
  opencode: {
    statusCommand: ['auth', 'status'],
    loginCommand: ['auth', 'login'],
    tuiCommand: ['.'], // Opens TUI where user can use /connect
    successPatterns: [
      /authenticated/i,
      /logged in/i,
      /connected to/i,
      /successfully/i
    ],
    urlPatterns: [
      /https?:\/\/[^\s]+/,
      /visit:?\s*https?:\/\//i,
      /open:?\s*https?:\/\//i,
      /authorize at/i
    ],
    failurePatterns: [
      /failed/i,
      /error/i,
      /denied/i,
      /invalid/i
    ]
  },
  claude: {
    statusCommand: ['--print', '--output-format', 'json'],
    loginCommand: [], // Claude uses API key, not OAuth
    successPatterns: [/api_key/i, /authenticated/i],
    urlPatterns: [],
    failurePatterns: [/error/i, /invalid/i]
  }
};

export class AgentAuthService {
  private sessions = new Map<string, AuthSession>();
  private userPathsService = getUserPathsService();

  getAuthConfig(agentType: AgentType): AuthCommandConfig | null {
    return AUTH_COMMANDS[agentType] || null;
  }

  supportsInteractiveAuth(agentType: AgentType): boolean {
    const config = this.getAuthConfig(agentType);
    return config !== null && (config.loginCommand.length > 0 || !!config.tuiCommand);
  }

  getUserScopedEnv(userId?: string): Record<string, string> {
    return this.userPathsService.getUserScopedEnv(userId);
  }

  ensureUserDirectories(userId?: string): void {
    this.userPathsService.ensureUserDirectories(userId);
  }

  /**
   * Start an interactive authentication session for an agent
   */
  async startAuthSession(
    agentType: AgentType,
    options: {
      userId?: string;
      provider?: AuthProvider;
      useLoginCommand?: boolean;
    } = {}
  ): Promise<AuthSession> {
    const { userId, provider, useLoginCommand = true } = options;
    const config = this.getAuthConfig(agentType);
    
    if (!config) {
      throw new Error(`Agent type '${agentType}' does not support authentication`);
    }

    // Ensure user directories exist for isolation
    this.ensureUserDirectories(userId);

    // Get the command to run
    const adapter = agentFactory.getAdapter(agentType);
    if (!adapter) {
      throw new Error(`No adapter found for agent type '${agentType}'`);
    }

    // Determine which command to use
    let command: string;
    let args: string[];

    if (useLoginCommand && config.loginCommand.length > 0) {
      // Use explicit login command
      command = adapter.command;
      args = config.loginCommand;
    } else if (config.tuiCommand) {
      // Use TUI mode where user can /connect
      command = adapter.command;
      args = config.tuiCommand;
    } else {
      throw new Error(`No auth command available for agent type '${agentType}'`);
    }

    // Merge environment
    const userEnv = this.getUserScopedEnv(userId);
    const env = {
      ...process.env,
      ...userEnv,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    } as { [key: string]: string };

    // Create session ID
    const sessionId = `auth-${agentType}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    // Spawn PTY for interactive auth
    const pty = spawn(command, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: process.env.HOME || '/',
      env
    });

    const session: AuthSession = {
      id: sessionId,
      agentType,
      provider,
      status: 'authenticating',
      pty,
      output: '',
      createdAt: new Date()
    };

    this.sessions.set(sessionId, session);

    // Monitor output for success/failure patterns
    pty.onData((data: string) => {
      session.output += data;
      // Keep output buffer manageable
      if (session.output.length > 50000) {
        session.output = session.output.slice(-25000);
      }

      // Check for success patterns
      if (config.successPatterns.some(p => p.test(data) || p.test(session.output))) {
        if (session.status === 'authenticating') {
          // Don't auto-complete - let the user finish the flow
          // session.status = 'success';
        }
      }

      // Check for failure patterns (only if clearly failed)
      if (config.failurePatterns.some(p => p.test(data))) {
        // Don't auto-fail - some error messages are recoverable
      }
    });

    pty.onExit(({ exitCode }) => {
      if (session.status === 'authenticating') {
        // Determine final status based on exit code and output
        if (exitCode === 0 || config.successPatterns.some(p => p.test(session.output))) {
          session.status = 'success';
        } else {
          session.status = 'failed';
          session.error = `Process exited with code ${exitCode}`;
        }
      }
      session.completedAt = new Date();
    });

    return session;
  }

  /**
   * Get an existing auth session
   */
  getSession(sessionId: string): AuthSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get the PTY for an auth session (for WebSocket attachment)
   */
  getSessionPty(sessionId: string): IPty | undefined {
    const session = this.sessions.get(sessionId);
    return session?.pty;
  }

  /**
   * Cancel an auth session
   */
  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'cancelled';
      session.completedAt = new Date();
      try {
        session.pty.kill();
      } catch {
        // Ignore kill errors
      }
    }
  }

  /**
   * Clean up a completed session
   */
  cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.status === 'authenticating') {
        this.cancelSession(sessionId);
      }
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Get all active auth sessions
   */
  getActiveSessions(): AuthSession[] {
    return Array.from(this.sessions.values()).filter(
      s => s.status === 'pending' || s.status === 'authenticating'
    );
  }

  /**
   * Verify auth status for an agent after authentication
   */
  async verifyAuthStatus(
    agentType: AgentType,
    userId?: string
  ): Promise<{ isAuthenticated: boolean; statusMessage?: string }> {
    const adapter = agentFactory.getAdapter(agentType);
    if (!adapter) {
      return { isAuthenticated: false, statusMessage: 'Unknown agent type' };
    }

    // For user-scoped verification, we'd need to run the check in the user's environment
    // For now, use the adapter's built-in check
    return adapter.checkAuthentication();
  }
}

// Singleton instance
export const agentAuthService = new AgentAuthService();
