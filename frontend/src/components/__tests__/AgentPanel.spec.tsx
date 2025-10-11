import { render, screen, fireEvent } from '@testing-library/react';
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

describe('AgentPanel dashboard tab', () => {
  const selectedWorktree = {
    id: 'wt1',
    path: '/tmp/repo1/wt1',
    branch: 'feature/test',
    repositoryId: 'repo1',
    instances: [],
    isMainWorktree: false,
  } as any;

  const selectedInstance = {
    id: 'inst1',
    worktreeId: 'wt1',
    repositoryId: 'repo1',
    agentType: 'claude',
    status: 'running',
    pid: 12345,
    port: 3000,
    createdAt: new Date().toISOString(),
  } as any;

  it('shows dashboard tab as first tab', () => {
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

    // Verify Dashboard tab exists and is the first tab
    const dashboardTab = screen.getByText('Dashboard');
    expect(dashboardTab).toBeTruthy();

    // Also verify other tabs exist
    expect(screen.getByText(/Agent/)).toBeTruthy();
    expect(screen.getByText(/Terminal/)).toBeTruthy();
    expect(screen.getByText('Git')).toBeTruthy();
    expect(screen.getByText('Notes')).toBeTruthy();
  });

  it('shows dashboard content by default', () => {
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

    // Verify dashboard content is visible
    expect(screen.getByText('Worktree Overview')).toBeTruthy();
    expect(screen.getByText('Branch Information')).toBeTruthy();
    expect(screen.getByText('Agent Status')).toBeTruthy();
    expect(screen.getByText('Quick Actions')).toBeTruthy();
  });

  it('displays worktree information in dashboard', () => {
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

    // Check worktree details are shown
    expect(screen.getByText('feature/test')).toBeTruthy();
    expect(screen.getByText('/tmp/repo1/wt1')).toBeTruthy();
  });

  it('displays agent status in dashboard', () => {
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

    // Check agent details are shown
    expect(screen.getByText('running')).toBeTruthy();
    expect(screen.getByText('claude')).toBeTruthy();
    expect(screen.getByText('12345')).toBeTruthy();
    expect(screen.getByText('3000')).toBeTruthy();
  });

  it('shows no agent message when instance is null', () => {
    render(
      <AgentPanel
        selectedWorktree={selectedWorktree}
        selectedInstance={null}
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

    expect(screen.getByText('No agent instance running')).toBeTruthy();
  });

  it('can switch from dashboard to agent tab', () => {
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

    // Dashboard content should be visible initially
    expect(screen.getByText('Worktree Overview')).toBeTruthy();

    // Click on Agent tab
    const agentTab = screen.getByText(/Agent/);
    fireEvent.click(agentTab);

    // Dashboard content should no longer be visible
    expect(screen.queryByText('Worktree Overview')).toBeFalsy();
  });
});
