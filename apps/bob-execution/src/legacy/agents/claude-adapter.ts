import { BaseAgentAdapter } from './base-adapter';
import type { AgentType } from '../types';

interface ClaudeUsagePayload {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

function isClaudeUsagePayload(value: unknown): value is ClaudeUsagePayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('usage' in value)) {
    return true;
  }
  return typeof value.usage === 'object' && value.usage !== null;
}

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
          const parsed: unknown = JSON.parse(trimmed);
          if (!isClaudeUsagePayload(parsed) || !parsed.usage) {
            continue;
          }

          const { usage } = parsed;
          if (usage.input_tokens ?? usage.output_tokens) {
            const inputTokens = usage.input_tokens ?? 0;
            const outputTokens = usage.output_tokens ?? 0;
            const cacheCreation = usage.cache_creation_input_tokens ?? 0;
            const cacheRead = usage.cache_read_input_tokens ?? 0;

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

  private calculateCost(inputTokens: number, outputTokens: number, cacheCreation = 0, cacheRead = 0): number {
    // Sonnet pricing: $3 per 1M input tokens, $15 per 1M output tokens
    // Cache creation: $3.75 per 1M tokens, Cache read: $0.30 per 1M tokens
    const inputCost = (inputTokens / 1000000) * 3.00;
    const outputCost = (outputTokens / 1000000) * 15.00;
    const cacheCreationCost = (cacheCreation / 1000000) * 3.75;
    const cacheReadCost = (cacheRead / 1000000) * 0.30;

    return inputCost + outputCost + cacheCreationCost + cacheReadCost;
  }
}