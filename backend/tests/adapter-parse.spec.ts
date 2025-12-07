import { describe, it, expect, vi } from 'vitest';

vi.mock('node-pty', () => ({
  spawn: () => ({
    on: () => {},
    onData: () => {},
    kill: () => {},
    pid: 123,
  }),
}));
import { ClaudeAdapter } from '../src/agents/claude-adapter';
import { CodexAdapter } from '../src/agents/codex-adapter';
import { GeminiAdapter } from '../src/agents/gemini-adapter';
import { KiroAdapter } from '../src/agents/kiro-adapter';

describe('adapter parseOutput', () => {
  it('parses Claude JSON usage', () => {
    const adapter = new ClaudeAdapter();
    const output = '\n' + JSON.stringify({ usage: { input_tokens: 1000, output_tokens: 500 } });
    const res = adapter.parseOutput!(output)!;
    expect(res.inputTokens).toBe(1000);
    expect(res.outputTokens).toBe(500);
    expect(res.cost).toBeGreaterThan(0);
  });

  it('parses Codex token text', () => {
    const adapter = new CodexAdapter();
    const output = 'Processed tokens: 2000';
    const res = adapter.parseOutput!(output)!;
    expect(res.inputTokens).toBeGreaterThan(0);
    expect(res.outputTokens).toBeGreaterThan(0);
  });

  it('parses Gemini JSON usage', () => {
    const adapter = new GeminiAdapter();
    const output = JSON.stringify({ usage: { input_tokens: 300, output_tokens: 100 } });
    const res = adapter.parseOutput!(output)!;
    expect(res.inputTokens).toBe(300);
    expect(res.outputTokens).toBe(100);
  });

  it('parses Kiro JSON usage', () => {
    const adapter = new KiroAdapter();
    const output = JSON.stringify({ tokens: { prompt_tokens: 50, completion_tokens: 20 } });
    const res = adapter.parseOutput!(output)!;
    expect(res.inputTokens).toBe(50);
    expect(res.outputTokens).toBe(20);
  });
});
