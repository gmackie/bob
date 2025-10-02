import { BaseAgentAdapter } from './base-adapter.js';
import { AgentType } from '../types.js';

export class AmazonQAdapter extends BaseAgentAdapter {
  readonly type: AgentType = 'amazon-q';
  readonly name = 'Amazon Q';
  readonly command = 'q';

  getSpawnArgs(options?: { interactive?: boolean; port?: number }): { command: string; args: string[]; env?: Record<string, string> } {
    const args: string[] = ['chat'];
    const env: Record<string, string> = {};

    // Amazon Q chat is primarily interactive
    // Add any additional configuration if needed

    return {
      command: this.command,
      args,
      env
    };
  }

  async checkAvailability(): Promise<{ isAvailable: boolean; version?: string; statusMessage?: string }> {
    try {
      // Amazon Q might not have a --version flag, so try --help or the basic command
      const result = await this.runCommand(['--help']);
      return {
        isAvailable: result.code === 0,
        version: this.parseVersion(result.stdout),
        statusMessage: result.code === 0 ? 'Available' : 'Command not found'
      };
    } catch (error) {
      return {
        isAvailable: false,
        statusMessage: error instanceof Error ? error.message : 'Command not found'
      };
    }
  }

  async checkAuthentication(): Promise<{ isAuthenticated: boolean; authenticationStatus?: string; statusMessage?: string }> {
    try {
      // Try to run q chat command to check authentication
      // This might require AWS CLI authentication
      const result = await this.runCommand(['chat', '--help']);

      if (result.code === 0) {
        return {
          isAuthenticated: true,
          authenticationStatus: 'Authenticated',
          statusMessage: 'Amazon Q is available and authenticated'
        };
      } else if (result.stderr.includes('auth') || result.stderr.includes('credential')) {
        return {
          isAuthenticated: false,
          authenticationStatus: 'Not authenticated',
          statusMessage: 'Amazon Q requires AWS authentication'
        };
      } else {
        return {
          isAuthenticated: false,
          authenticationStatus: 'Error',
          statusMessage: `Amazon Q error: ${result.stderr}`
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
      // Amazon Q may have different output formats
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

        // Look for AWS-style usage reporting
        const usageMatch = line.match(/Usage:\s*(\d+)\s*input,?\s*(\d+)\s*output/i);
        if (usageMatch) {
          const inputTokens = parseInt(usageMatch[1]);
          const outputTokens = parseInt(usageMatch[2]);
          return {
            inputTokens,
            outputTokens,
            cost: this.calculateCost(inputTokens, outputTokens)
          };
        }
      }
    } catch (error) {
      console.log(`Failed to parse Amazon Q output:`, error);
    }
    return null;
  }

  protected isAgentReady(data: string, fullOutput: string): boolean {
    // Amazon Q is ready when it shows its chat interface
    return data.includes('Amazon Q') ||
           data.includes('Q:') ||
           data.includes('chat') ||
           data.includes('>') ||
           data.includes('Welcome') ||
           fullOutput.length > 50;
  }

  protected parseVersion(output: string): string | undefined {
    // Amazon Q might not follow standard version patterns
    const versionPatterns = [
      /Amazon Q.*?([0-9]+\.[0-9]+\.[0-9]+)/i,
      /version\s+([^\s\n]+)/i,
      /v?(\d+\.\d+\.\d+[^\s]*)/,
      /(\d+\.\d+\.\d+)/
    ];

    for (const pattern of versionPatterns) {
      const match = output.match(pattern);
      if (match) {
        return match[1];
      }
    }

    // If no version found, return a generic indicator
    return 'AWS CLI';
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    // Amazon Q pricing varies by plan
    // Using approximate pricing for conversation usage
    // Professional plan: approximately $20/user/month with usage limits
    // For calculation purposes, estimate per-token costs
    const inputCost = (inputTokens / 1000000) * 1.00;
    const outputCost = (outputTokens / 1000000) * 3.00;
    return inputCost + outputCost;
  }
}