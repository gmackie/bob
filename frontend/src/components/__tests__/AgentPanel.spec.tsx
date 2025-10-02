import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import React from 'react';
import { AgentPanel } from '../../components/AgentPanel';

vi.mock('../../components/Terminal', () => ({
  TerminalComponent: () => <div data-testid="terminal-mock" />,
}));

describe('AgentPanel header', () => {
  const selectedWorktree = {
    id: 'wt1',
    path: '/tmp/repo1/wt1',
    branch: 'feature/x',
    repositoryId: 'repo1',
    instances: [],
    isMainWorktree: false,
  } as any;

  const selectedInstance = {
    id: 'inst1',
    worktreeId: 'wt1',
    repositoryId: 'repo1',
    agentType: 'codex',
    status: 'running',
    createdAt: new Date().toISOString(),
  } as any;

  it('shows agent badge uppercase', () => {
    render(
      <AgentPanel
        selectedWorktree={selectedWorktree}
        selectedInstance={selectedInstance}
        onCreateTerminalSession={async () => 's1'}
        onCreateDirectoryTerminalSession={async () => 's2'}
        onCloseTerminalSession={() => {}}
        onRestartInstance={async () => {}}
        onStopInstance={async () => {}}
        onDeleteWorktree={async () => {}}
        error={null}
        isLeftPanelCollapsed={false}
      />
    );

    // Verify header label and agent badge
    expect(screen.getByText('Agent Instance')).toBeTruthy();
    expect(screen.getByText('CODEX')).toBeTruthy();
  });
});
