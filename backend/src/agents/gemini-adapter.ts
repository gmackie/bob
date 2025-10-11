import { BaseAgentAdapter } from './base-adapter.js';
import { AgentType } from '../types.js';

export class GeminiAdapter extends BaseAgentAdapter {
  readonly type: AgentType = 'gemini';
  readonly name = 'Gemini';
  readonly command = 'gemini';

  getSpawnArgs(options?: { interactive?: boolean; port?: number }): { command: string; args: string[]; env?: Record<string, string> } {
    const args: string[] = [];
    const env: Record<string, string> = {};

    if (options?.interactive) {
      // Interactive mode with sandbox and auto-edit approval
      args.push('--sandbox');
      args.push('--approval-mode', 'auto_edit');
    } else {
      // Non-interactive mode with prompt
      args.push('--prompt');
    }

    return {
      command: this.command,
      args,
      env
    };
  }

  async checkAuthentication(): Promise<{ isAuthenticated: boolean; authenticationStatus?: string; statusMessage?: string }> {
    try {
      // Check if gemini can start by running it with --help or checking for credentials
      // Using --help is safer as it doesn't hang waiting for input
      const result = await this.runCommand(['--help'], 2000); // 2 second timeout

      // If --help works, check stderr/stdout for authentication hints
      const output = result.stdout + result.stderr;

      if (result.code === 0 || output.includes('Loaded cached credentials')) {
        return {
          isAuthenticated: true,
          authenticationStatus: 'Authenticated',
          statusMessage: 'Gemini CLI is available and authenticated'
        };
      } else if (output.includes('auth') || output.includes('login') || output.includes('not authenticated')) {
        return {
          isAuthenticated: false,
          authenticationStatus: 'Not authenticated',
          statusMessage: 'Gemini CLI authentication required. Run: gemini auth login'
        };
      } else {
        // If we can run --help successfully, assume authentication is OK
        return {
          isAuthenticated: true,
          authenticationStatus: 'Authenticated',
          statusMessage: 'Gemini CLI is available'
        };
      }
    } catch (error) {
      // If command times out or fails, check the error message
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('auth') || errorMsg.includes('login')) {
        return {
          isAuthenticated: false,
          authenticationStatus: 'Not authenticated',
          statusMessage: 'Gemini CLI authentication required'
        };
      }

      // For other errors, assume it might be authenticated but there's another issue
      return {
        isAuthenticated: true,
        authenticationStatus: 'Unknown',
        statusMessage: 'Gemini CLI available (authentication status unknown)'
      };
    }
  }

  parseOutput(output: string): { inputTokens?: number; outputTokens?: number; cost?: number } | null {
    try {
      // Gemini may output usage information in various formats
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
              cost: this.calculateCost(
                usage.input_tokens || usage.prompt_tokens || 0,
                usage.output_tokens || usage.completion_tokens || 0
              )
            };
          }
        }

        // Look for text-based usage reporting
        const inputMatch = line.match(/input[:\s]+(\d+)/i);
        const outputMatch = line.match(/output[:\s]+(\d+)/i);
        if (inputMatch && outputMatch) {
          const inputTokens = parseInt(inputMatch[1]);
          const outputTokens = parseInt(outputMatch[1]);
          return {
            inputTokens,
            outputTokens,
            cost: this.calculateCost(inputTokens, outputTokens)
          };
        }
      }
    } catch (error) {
      console.log(`Failed to parse Gemini output:`, error);
    }
    return null;
  }

  protected isAgentReady(data: string, fullOutput: string): boolean {
    // Gemini is ready when it shows its interface or starts processing
    return data.includes('Gemini') ||
           data.includes('gemini') ||
           data.includes('▶') ||
           data.includes('>') ||
           data.includes('●') ||
           fullOutput.length > 50;
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    // Gemini Pro pricing (as of 2024)
    // Free tier: up to certain limits, then paid
    // Using approximate pricing: $0.50 per 1M input tokens, $1.50 per 1M output tokens
    const inputCost = (inputTokens / 1000000) * 0.50;
    const outputCost = (outputTokens / 1000000) * 1.50;
    return inputCost + outputCost;
  }
}