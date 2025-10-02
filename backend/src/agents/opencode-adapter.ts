import { BaseAgentAdapter } from './base-adapter.js';
import { AgentType } from '../types.js';

export class OpenCodeAdapter extends BaseAgentAdapter {
  readonly type: AgentType = 'opencode';
  readonly name = 'OpenCode';
  readonly command = 'opencode';

  getSpawnArgs(options?: { interactive?: boolean; port?: number }): { command: string; args: string[]; env?: Record<string, string> } {
    const args: string[] = [];
    const env: Record<string, string> = {};

    if (options?.interactive) {
      // Interactive TUI mode - default behavior
      // OpenCode starts in TUI mode by default
      args.push('.');
    } else {
      // Non-interactive mode - use run command
      args.push('run');
    }

    return {
      command: this.command,
      args,
      env
    };
  }

  async checkAuthentication(): Promise<{ isAuthenticated: boolean; authenticationStatus?: string; statusMessage?: string }> {
    try {
      // OpenCode may require authentication - check with auth command
      const result = await this.runCommand(['auth', 'status'], 3000);

      const output = result.stdout + result.stderr;

      // If auth status succeeds or shows authenticated
      if (result.code === 0 || output.includes('authenticated') || output.includes('logged in')) {
        return {
          isAuthenticated: true,
          authenticationStatus: 'Authenticated',
          statusMessage: 'OpenCode is authenticated'
        };
      } else if (output.includes('not authenticated') || output.includes('not logged in')) {
        return {
          isAuthenticated: false,
          authenticationStatus: 'Not authenticated',
          statusMessage: 'OpenCode authentication required. Run: opencode auth'
        };
      } else {
        // If auth status command doesn't exist or fails, assume no auth required
        return {
          isAuthenticated: true,
          authenticationStatus: 'Unknown',
          statusMessage: 'OpenCode is available'
        };
      }
    } catch (error) {
      // If auth command fails, it might not require auth or we can't determine
      // Be lenient and allow it to run
      return {
        isAuthenticated: true,
        authenticationStatus: 'Unknown',
        statusMessage: 'OpenCode is available (authentication status unknown)'
      };
    }
  }

  parseOutput(output: string): { inputTokens?: number; outputTokens?: number; cost?: number } | null {
    try {
      // OpenCode may output usage information in JSON format
      const lines = output.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();

        // Look for JSON usage data
        if (trimmed.startsWith('{') && (trimmed.includes('usage') || trimmed.includes('tokens'))) {
          const json = JSON.parse(trimmed);
          if (json.usage || json.tokens) {
            const usage = json.usage || json.tokens;
            return {
              inputTokens: usage.input_tokens || usage.prompt_tokens || 0,
              outputTokens: usage.output_tokens || usage.completion_tokens || 0,
              cost: usage.cost || 0
            };
          }
        }
      }
    } catch (error) {
      console.log(`Failed to parse OpenCode output:`, error);
    }
    return null;
  }

  protected isAgentReady(data: string, fullOutput: string): boolean {
    // OpenCode is ready when it shows its TUI or starts processing
    return data.includes('OpenCode') ||
           data.includes('opencode') ||
           data.includes('█') ||  // ASCII art in banner
           data.includes('Commands:') ||
           fullOutput.length > 50;
  }
}
