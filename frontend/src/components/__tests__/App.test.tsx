import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import App from '../../App';
import * as api from '../../api';

// Mock the API
vi.mock('../../api', () => ({
  api: {
    getRepositories: vi.fn(),
    getInstances: vi.fn(),
    getAgents: vi.fn(),
    addRepository: vi.fn(),
    createWorktree: vi.fn(),
    startInstance: vi.fn(),
    removeWorktree: vi.fn(),
    refreshMainBranch: vi.fn(),
    createTerminalSession: vi.fn(),
    createDirectoryTerminalSession: vi.fn(),
    closeTerminalSession: vi.fn(),
    restartInstance: vi.fn(),
    stopInstance: vi.fn(),
  },
}));

// Mock components that have complex dependencies
vi.mock('../../components/Terminal', () => ({
  TerminalComponent: () => <div data-testid="terminal-mock" />,
}));

vi.mock('../../components/DirectoryBrowser', () => ({
  DirectoryBrowser: () => <div data-testid="directory-browser-mock" />,
}));

vi.mock('../../components/Dashboard', () => ({
  Dashboard: ({ repositories }: any) => (
    <div data-testid="dashboard-component">
      Dashboard for {repositories[0]?.name}
    </div>
  ),
}));

vi.mock('../../components/AuthButton', () => ({
  AuthButton: () => <div data-testid="auth-button" />,
}));

vi.mock('../../components/SettingsMenu', () => ({
  SettingsMenu: () => <div data-testid="settings-menu" />,
}));

vi.mock('../../components/WebSocketDebugPanel', () => ({
  WebSocketDebugPanel: () => <div data-testid="websocket-debug" />,
}));

vi.mock('../../contexts/CheatCodeContext', () => ({
  useCheatCode: () => ({ isDatabaseUnlocked: false }),
  CheatCodeProvider: ({ children }: any) => children,
}));

describe('App - Repository and Worktree Selection', () => {
  const mockRepositories = [
    {
      id: 'repo1',
      name: 'Test Repo',
      path: '/tmp/test-repo',
      branch: 'main',
      mainBranch: 'main',
      worktrees: [
        {
          id: 'wt1',
          path: '/tmp/test-repo/wt1',
          branch: 'feature/test',
          repositoryId: 'repo1',
          instances: [],
          isMainWorktree: false,
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (api.api.getRepositories as any).mockResolvedValue(mockRepositories);
    (api.api.getInstances as any).mockResolvedValue([]);
    (api.api.getAgents as any).mockResolvedValue([
      { type: 'claude', name: 'Claude Code', isAvailable: true, isAuthenticated: true },
    ]);
  });

  it('shows Dashboard component when repository is selected', async () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Repo')).toBeTruthy();
    });

    // Click on repository name to select it
    const repoName = screen.getByText('Test Repo');
    fireEvent.click(repoName);

    // Should show Dashboard component
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-component')).toBeTruthy();
      expect(screen.getByText('Dashboard for Test Repo')).toBeTruthy();
    });
  });

  it('shows AgentPanel when worktree is selected', async () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Repo')).toBeTruthy();
    });

    // Click on worktree to select it
    const worktreeBranch = screen.getByText('feature/test');
    fireEvent.click(worktreeBranch);

    // Should show AgentPanel (not Dashboard)
    await waitFor(() => {
      expect(screen.queryByTestId('dashboard-component')).toBeFalsy();
      // AgentPanel shows the instance header
      expect(screen.getByText('Agent Instance')).toBeTruthy();
    });
  });

  it('clears repository selection when worktree is selected', async () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Repo')).toBeTruthy();
    });

    // First select repository
    fireEvent.click(screen.getByText('Test Repo'));

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-component')).toBeTruthy();
    });

    // Then select worktree
    fireEvent.click(screen.getByText('feature/test'));

    // Dashboard should disappear
    await waitFor(() => {
      expect(screen.queryByTestId('dashboard-component')).toBeFalsy();
    });
  });
});
