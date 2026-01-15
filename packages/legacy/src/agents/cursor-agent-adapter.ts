import { BaseAgentAdapter } from './base-adapter.js';
import { AgentType } from '../types.js';
import { spawn } from 'child_process';

export class CursorAgentAdapter extends BaseAgentAdapter {
  readonly type: AgentType = 'cursor-agent';
  readonly name = 'Cursor Agent';
  readonly command = 'cursor-agent';
  private chatIdMap = new Map<string, string>(); // worktreePath -> chatId
  private currentChatId: string | null = null; // Temporary storage for getSpawnArgs

  private async createChat(): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, ['create-chat'], { stdio: 'pipe' });
      let chatId = '';

      child.stdout?.on('data', (data) => {
        chatId += data.toString().trim();
      });

      child.on('close', (code) => {
        if (code === 0 && chatId) {
          resolve(chatId);
        } else {
          reject(new Error('Failed to create cursor-agent chat'));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });

      setTimeout(() => {
        child.kill();
        reject(new Error('Create chat timeout'));
      }, 5000);
    });
  }

  async startProcess(worktreePath: string, port?: number) {
    // Create a chat session for this worktree if one doesn't exist
    if (!this.chatIdMap.has(worktreePath)) {
      try {
        const chatId = await this.createChat();
        this.chatIdMap.set(worktreePath, chatId);
        console.log(`Created cursor-agent chat ${chatId} for worktree ${worktreePath}`);
      } catch (error) {
        console.error(`Failed to create cursor-agent chat:`, error);
        throw error;
      }
    }

    // Set current chat ID for getSpawnArgs to use
    this.currentChatId = this.chatIdMap.get(worktreePath)!;

    // Call parent startProcess which will use getSpawnArgs
    try {
      return await super.startProcess(worktreePath, port);
    } finally {
      // Clear current chat ID after process starts
      this.currentChatId = null;
    }
  }

  getSpawnArgs(options?: { interactive?: boolean; port?: number; worktreePath?: string }): { command: string; args: string[]; env?: Record<string, string> } {
    const args: string[] = [];
    const env: Record<string, string> = {
      // Full terminal support with colors
      TERM: 'xterm-256color',
      TERM_PROGRAM: 'node-pty',
      COLORTERM: 'truecolor'
    };

    if (options?.interactive) {
      // Interactive mode - resume existing chat session
      if (this.currentChatId) {
        args.push('--resume', this.currentChatId);
      } else {
        throw new Error('No chat ID available for cursor-agent interactive mode');
      }
    } else {
      // Non-interactive mode - use print mode for scripting
      args.push('--print');
      args.push('--output-format', 'stream-json');
    }

    return {
      command: this.command,
      args,
      env
    };
  }

  async checkAuthentication(): Promise<{ isAuthenticated: boolean; authenticationStatus?: string; statusMessage?: string }> {
    try {
      // Cursor Agent uses API key authentication
      // Check if CURSOR_API_KEY env var is set or if we can run with --help
      const result = await this.runCommand(['--version'], 3000);

      // If we can run --version successfully, check for API key requirements
      if (result.code === 0) {
        // Check if API key is set in environment
        const hasApiKey = !!process.env.CURSOR_API_KEY;

        if (hasApiKey) {
          return {
            isAuthenticated: true,
            authenticationStatus: 'Authenticated',
            statusMessage: 'Cursor Agent is authenticated (API key set)'
          };
        } else {
          // API key not set, but may work with other auth methods
          return {
            isAuthenticated: true,
            authenticationStatus: 'Unknown',
            statusMessage: 'Cursor Agent is available (set CURSOR_API_KEY for authentication)'
          };
        }
      } else {
        return {
          isAuthenticated: false,
          authenticationStatus: 'Error',
          statusMessage: 'Cursor Agent error during authentication check'
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (errorMsg.includes('API key') || errorMsg.includes('authentication')) {
        return {
          isAuthenticated: false,
          authenticationStatus: 'Not authenticated',
          statusMessage: 'Cursor Agent requires API key. Set CURSOR_API_KEY env var or use --api-key'
        };
      }

      // For other errors, assume it might work
      return {
        isAuthenticated: true,
        authenticationStatus: 'Unknown',
        statusMessage: 'Cursor Agent available (authentication status unknown)'
      };
    }
  }

  parseOutput(output: string): { inputTokens?: number; outputTokens?: number; cost?: number } | null {
    try {
      // Cursor Agent outputs stream-json format with usage information
      const lines = output.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith('{')) {
          try {
            const json = JSON.parse(trimmed);

            // Look for usage in the JSON output
            if (json.usage) {
              return {
                inputTokens: json.usage.input_tokens || json.usage.prompt_tokens || 0,
                outputTokens: json.usage.output_tokens || json.usage.completion_tokens || 0,
                cost: json.usage.cost || 0
              };
            }

            // Look for token counts in metadata
            if (json.metadata?.tokens) {
              return {
                inputTokens: json.metadata.tokens.input || 0,
                outputTokens: json.metadata.tokens.output || 0,
                cost: json.metadata.tokens.cost || 0
              };
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }
    } catch (error) {
      console.log(`Failed to parse Cursor Agent output:`, error);
    }
    return null;
  }

  protected isAgentReady(data: string, fullOutput: string): boolean {
    // Cursor Agent is ready when it starts showing output or the UI
    return data.includes('Cursor') ||
           data.includes('cursor') ||
           data.includes('Agent') ||
           data.includes('composer') ||
           data.includes('▶') ||
           fullOutput.length > 50;
  }
}
