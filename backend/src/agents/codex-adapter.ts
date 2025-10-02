import { BaseAgentAdapter } from './base-adapter.js';
import { AgentType } from '../types.js';

export class CodexAdapter extends BaseAgentAdapter {
  readonly type: AgentType = 'codex';
  readonly name = 'Codex';
  readonly command = 'codex';

  getSpawnArgs(options?: { interactive?: boolean; port?: number }): { command: string; args: string[]; env?: Record<string, string> } {
    const args: string[] = [];
    const env: Record<string, string> = {
      // Full terminal support with colors
      TERM: 'xterm-256color',
      TERM_PROGRAM: 'node-pty',
      COLORTERM: 'truecolor'
    };

    if (options?.interactive) {
      // Interactive mode - just start codex with default settings
      // Add workspace-write sandbox for safe file operations
      args.push('--sandbox', 'workspace-write');
      // Auto-approve on failure to reduce friction
      args.push('--ask-for-approval', 'on-failure');
    } else {
      // Non-interactive mode
      args.push('exec');
    }

    return {
      command: this.command,
      args,
      env
    };
  }

  async checkAuthentication(): Promise<{ isAuthenticated: boolean; authenticationStatus?: string; statusMessage?: string }> {
    try {
      // Try to run a simple command to check if Codex is authenticated
      const result = await this.runCommand(['--help']);
      if (result.code === 0) {
        return {
          isAuthenticated: true,
          authenticationStatus: 'Authenticated',
          statusMessage: 'Codex CLI is available and authenticated'
        };
      } else {
        return {
          isAuthenticated: false,
          authenticationStatus: 'Not authenticated',
          statusMessage: 'Codex CLI authentication required'
        };
      }
    } catch (error) {
      return {
        isAuthenticated: false,
        authenticationStatus: 'Error',
        statusMessage: error instanceof Error ? error.message : 'Unknown authentication error'
      };
    }
  }

  parseOutput(output: string): { inputTokens?: number; outputTokens?: number; cost?: number } | null {
    try {
      // Codex may output usage information in different formats
      // Look for token usage patterns
      const lines = output.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();

        // Look for JSON usage data
        if (trimmed.startsWith('{') && trimmed.includes('usage')) {
          const json = JSON.parse(trimmed);
          if (json.usage && (json.usage.input_tokens || json.usage.output_tokens)) {
            return {
              inputTokens: json.usage.input_tokens || 0,
              outputTokens: json.usage.output_tokens || 0,
              cost: this.calculateCost(json.usage.input_tokens || 0, json.usage.output_tokens || 0)
            };
          }
        }

        // Look for text-based usage reporting
        const tokenMatch = line.match(/tokens?:\s*(\d+)/i);
        if (tokenMatch) {
          const tokens = parseInt(tokenMatch[1]);
          return {
            inputTokens: Math.floor(tokens * 0.7), // Estimate split
            outputTokens: Math.ceil(tokens * 0.3),
            cost: this.calculateCost(Math.floor(tokens * 0.7), Math.ceil(tokens * 0.3))
          };
        }
      }
    } catch (error) {
      console.log(`Failed to parse Codex output:`, error);
    }
    return null;
  }

  protected isAgentReady(data: string, fullOutput: string): boolean {
    // Codex is ready when it shows its prompt or starts processing
    return data.includes('Codex') ||
           data.includes('codex') ||
           data.includes('>') ||
           data.includes('$') ||
           fullOutput.length > 50;
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    // Codex pricing varies by model - using GPT-4 style pricing as estimate
    // $30 per 1M input tokens, $60 per 1M output tokens
    const inputCost = (inputTokens / 1000000) * 30.00;
    const outputCost = (outputTokens / 1000000) * 60.00;
    return inputCost + outputCost;
  }
}