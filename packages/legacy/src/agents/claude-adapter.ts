import { BaseAgentAdapter } from './base-adapter.js';
import { AgentType } from '../types.js';

export class ClaudeAdapter extends BaseAgentAdapter {
  readonly type: AgentType = 'claude';
  readonly name = 'Claude Code';
  // Command is resolved by getAgentCommand() in base adapter
  readonly command = 'claude';

  getSpawnArgs(options?: { interactive?: boolean; port?: number }): { command: string; args: string[]; env?: Record<string, string> } {
    const args: string[] = [];
    const env: Record<string, string> = {};

    if (options?.port) {
      env.CLAUDE_CODE_PORT = options.port.toString();
    }

    if (!options?.interactive) {
      args.push('--print');
    }

    return {
      command: this.command,
      args,
      env
    };
  }

  parseOutput(output: string): { inputTokens?: number; outputTokens?: number; cost?: number } | null {
    try {
      const lines = output.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{') && trimmed.includes('usage')) {
          const json = JSON.parse(trimmed);

          if (json.usage && (json.usage.input_tokens || json.usage.output_tokens)) {
            const inputTokens = json.usage.input_tokens || 0;
            const outputTokens = json.usage.output_tokens || 0;
            const cacheCreation = json.usage.cache_creation_input_tokens || 0;
            const cacheRead = json.usage.cache_read_input_tokens || 0;

            return {
              inputTokens,
              outputTokens,
              cost: this.calculateCost(inputTokens, outputTokens, cacheCreation, cacheRead)
            };
          }
        }
      }
    } catch (error) {
      console.log(`Failed to parse Claude output:`, error);
    }
    return null;
  }

  protected isAgentReady(data: string, fullOutput: string): boolean {
    return data.includes('Claude') ||
           data.includes('claude') ||
           fullOutput.length > 100;
  }

  private calculateCost(inputTokens: number, outputTokens: number, cacheCreation: number = 0, cacheRead: number = 0): number {
    // Sonnet pricing: $3 per 1M input tokens, $15 per 1M output tokens
    // Cache creation: $3.75 per 1M tokens, Cache read: $0.30 per 1M tokens
    const inputCost = (inputTokens / 1000000) * 3.00;
    const outputCost = (outputTokens / 1000000) * 15.00;
    const cacheCreationCost = (cacheCreation / 1000000) * 3.75;
    const cacheReadCost = (cacheRead / 1000000) * 0.30;

    return inputCost + outputCost + cacheCreationCost + cacheReadCost;
  }
}