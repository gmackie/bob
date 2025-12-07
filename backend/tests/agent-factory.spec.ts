import { describe, it, expect, vi } from 'vitest';

// Mock node-pty to avoid native binary requirement in tests
vi.mock('node-pty', () => ({
  spawn: () => ({
    on: () => {},
    onData: () => {},
    kill: () => {},
    pid: 123,
  }),
}));

import { agentFactory } from '../src/agents/agent-factory';

describe('agentFactory', () => {
  it('includes expected agent types', () => {
    const types = agentFactory.getAvailableTypes();
    expect(types).toEqual(expect.arrayContaining(['claude', 'codex', 'gemini', 'kiro']));
  });
});
