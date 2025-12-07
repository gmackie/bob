import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BrowserRouter } from 'react-router-dom';
import { AgentPanel } from '../AgentPanel';
import { RepositoryPanel } from '../RepositoryPanel';
import { api } from '../../api';
import { AgentInfo, AgentType, ClaudeInstance, Worktree, Repository } from '../../types';

// Mock the API
vi.mock('../../api', () => ({
  api: {
    getAgents: vi.fn(),
    createWorktree: vi.fn(),
    startInstance: vi.fn(),
    getGitDiff: vi.fn(),
    getGitStatus: vi.fn(),
    getPRStatus: vi.fn(),
    getNotes: vi.fn(),
  }
}));

describe('Bug Fixes - availableAgents', () => {
  const mockAgents: AgentInfo[] = [
    {
      type: 'claude' as AgentType,
      name: 'Claude',
      command: 'claude',
      isAvailable: true,
      isAuthenticated: true,
      version: '1.0.0',
      statusMessage: 'Ready'
    },
    {
      type: 'codex' as AgentType,
      name: 'Codex',
      command: 'codex',
      isAvailable: true,
      isAuthenticated: true,
      version: '0.23.0',
      statusMessage: 'Ready'
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getAgents as any).mockResolvedValue(mockAgents);
    (api.getNotes as any).mockResolvedValue({ content: '', fileName: '' });
  });

  it('should fetch and populate availableAgents in AgentPanel', async () => {
    const mockWorktree: Worktree = {
      id: 'wt-1',
      path: '/path/to/worktree',
      branch: 'main',
      repositoryId: 'repo-1',
      instances: [],
      isMainWorktree: false
    };

    const mockInstance: ClaudeInstance = {
      id: 'inst-1',
      worktreeId: 'wt-1',
      status: 'running',
      agentType: 'claude',
      pid: 12345,
      createdAt: new Date().toISOString(),
      repositoryId: 'repo-1'
    };

    render(
      <BrowserRouter>
        <AgentPanel
          selectedWorktree={mockWorktree}
          selectedInstance={mockInstance}
          onCreateTerminalSession={vi.fn()}
          onCreateDirectoryTerminalSession={vi.fn()}
          onCloseTerminalSession={vi.fn()}
          onRestartInstance={vi.fn()}
          onStopInstance={vi.fn()}
          onDeleteWorktree={vi.fn()}
          error={null}
          isLeftPanelCollapsed={false}
        />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(api.getAgents).toHaveBeenCalled();
    });

    // The component should not crash with undefined availableAgents
    expect(screen.getByText(/Claude Instance/i)).toBeInTheDocument();
  });

  it('should fetch and populate availableAgents in RepositoryPanel', async () => {
    const mockRepositories: Repository[] = [{
      id: 'repo-1',
      name: 'Test Repo',
      path: '/path/to/repo',
      mainBranch: 'main',
      worktrees: []
    }];

    render(
      <BrowserRouter>
        <RepositoryPanel
          repositories={mockRepositories}
          instances={[]}
          selectedWorktreeId={null}
          selectedRepositoryId={null}
          onAddRepository={vi.fn()}
          onCreateWorktreeAndStartInstance={vi.fn()}
          onSelectWorktree={vi.fn()}
          onSelectRepository={vi.fn()}
          onDeleteWorktree={vi.fn()}
          onRefreshMainBranch={vi.fn()}
          isCollapsed={false}
          onToggleCollapse={vi.fn()}
        />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(api.getAgents).toHaveBeenCalled();
    });
  });

  it('should handle API errors gracefully when fetching agents', async () => {
    (api.getAgents as any).mockRejectedValue(new Error('API Error'));

    const mockWorktree: Worktree = {
      id: 'wt-1',
      path: '/path/to/worktree',
      branch: 'main',
      repositoryId: 'repo-1',
      instances: [],
      isMainWorktree: false
    };

    const mockInstance: ClaudeInstance = {
      id: 'inst-1',
      worktreeId: 'wt-1',
      status: 'running',
      agentType: 'claude',
      pid: 12345,
      createdAt: new Date().toISOString(),
      repositoryId: 'repo-1'
    };

    // Should not crash even if API fails
    expect(() => {
      render(
        <BrowserRouter>
          <AgentPanel
            selectedWorktree={mockWorktree}
            selectedInstance={mockInstance}
            onCreateTerminalSession={vi.fn()}
            onCreateDirectoryTerminalSession={vi.fn()}
            onCloseTerminalSession={vi.fn()}
            onRestartInstance={vi.fn()}
            onStopInstance={vi.fn()}
            onDeleteWorktree={vi.fn()}
            error={null}
            isLeftPanelCollapsed={false}
          />
        </BrowserRouter>
      );
    }).not.toThrow();
  });
});

describe('Bug Fixes - selectedInstance null checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getAgents as any).mockResolvedValue([]);
    (api.getNotes as any).mockResolvedValue({ content: '', fileName: '' });
  });

  it('should handle null selectedInstance without crashing', () => {
    const mockWorktree: Worktree = {
      id: 'wt-1',
      path: '/path/to/worktree',
      branch: 'feature-test',
      repositoryId: 'repo-1',
      instances: [],
      isMainWorktree: false
    };

    // selectedInstance is null - this should not crash
    expect(() => {
      render(
        <BrowserRouter>
          <AgentPanel
            selectedWorktree={mockWorktree}
            selectedInstance={null}
            onCreateTerminalSession={vi.fn()}
            onCreateDirectoryTerminalSession={vi.fn()}
            onCloseTerminalSession={vi.fn()}
            onRestartInstance={vi.fn()}
            onStopInstance={vi.fn()}
            onDeleteWorktree={vi.fn()}
            error={null}
            isLeftPanelCollapsed={false}
          />
        </BrowserRouter>
      );
    }).not.toThrow();

    // Should still render the worktree info
    expect(screen.getByText(/feature-test/)).toBeInTheDocument();
  });

  it('should not show instance status when selectedInstance is null', () => {
    const mockWorktree: Worktree = {
      id: 'wt-1',
      path: '/path/to/worktree',
      branch: 'feature-test',
      repositoryId: 'repo-1',
      instances: [],
      isMainWorktree: false
    };

    render(
      <BrowserRouter>
        <AgentPanel
          selectedWorktree={mockWorktree}
          selectedInstance={null}
          onCreateTerminalSession={vi.fn()}
          onCreateDirectoryTerminalSession={vi.fn()}
          onCloseTerminalSession={vi.fn()}
          onRestartInstance={vi.fn()}
          onStopInstance={vi.fn()}
          onDeleteWorktree={vi.fn()}
          error={null}
          isLeftPanelCollapsed={false}
        />
      </BrowserRouter>
    );

    // Should not render status badge when instance is null
    expect(screen.queryByText(/running/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/stopped/i)).not.toBeInTheDocument();
  });

  it('should show instance status when selectedInstance exists', () => {
    const mockWorktree: Worktree = {
      id: 'wt-1',
      path: '/path/to/worktree',
      branch: 'feature-test',
      repositoryId: 'repo-1',
      instances: [],
      isMainWorktree: false
    };

    const mockInstance: ClaudeInstance = {
      id: 'inst-1',
      worktreeId: 'wt-1',
      status: 'running',
      agentType: 'claude',
      pid: 12345,
      createdAt: new Date().toISOString(),
      repositoryId: 'repo-1'
    };

    render(
      <BrowserRouter>
        <AgentPanel
          selectedWorktree={mockWorktree}
          selectedInstance={mockInstance}
          onCreateTerminalSession={vi.fn()}
          onCreateDirectoryTerminalSession={vi.fn()}
          onCloseTerminalSession={vi.fn()}
          onRestartInstance={vi.fn()}
          onStopInstance={vi.fn()}
          onDeleteWorktree={vi.fn()}
          error={null}
          isLeftPanelCollapsed={false}
        />
      </BrowserRouter>
    );

    // Should render status badge when instance exists
    expect(screen.getByText('running')).toBeInTheDocument();
  });
});

describe('Bug Fixes - sessionCache implementation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getAgents as any).mockResolvedValue([]);
    (api.getNotes as any).mockResolvedValue({ content: '', fileName: '' });
  });

  it('should initialize sessionCache without errors', () => {
    const mockWorktree: Worktree = {
      id: 'wt-1',
      path: '/path/to/worktree',
      branch: 'main',
      repositoryId: 'repo-1',
      instances: [],
      isMainWorktree: false
    };

    const mockInstance: ClaudeInstance = {
      id: 'inst-1',
      worktreeId: 'wt-1',
      status: 'running',
      agentType: 'claude',
      pid: 12345,
      createdAt: new Date().toISOString(),
      repositoryId: 'repo-1'
    };

    // sessionCache should be initialized and not throw errors
    expect(() => {
      render(
        <BrowserRouter>
          <AgentPanel
            selectedWorktree={mockWorktree}
            selectedInstance={mockInstance}
            onCreateTerminalSession={vi.fn()}
            onCreateDirectoryTerminalSession={vi.fn()}
            onCloseTerminalSession={vi.fn()}
            onRestartInstance={vi.fn()}
            onStopInstance={vi.fn()}
            onDeleteWorktree={vi.fn()}
            error={null}
            isLeftPanelCollapsed={false}
          />
        </BrowserRouter>
      );
    }).not.toThrow();
  });
});

describe('Bug Fixes - notes state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getAgents as any).mockResolvedValue([]);
    (api.getNotes as any).mockResolvedValue({ content: 'Test notes', fileName: 'notes.md' });
  });

  it('should initialize notes state without errors', () => {
    const mockWorktree: Worktree = {
      id: 'wt-1',
      path: '/path/to/worktree',
      branch: 'main',
      repositoryId: 'repo-1',
      instances: [],
      isMainWorktree: false
    };

    const mockInstance: ClaudeInstance = {
      id: 'inst-1',
      worktreeId: 'wt-1',
      status: 'running',
      agentType: 'claude',
      pid: 12345,
      createdAt: new Date().toISOString(),
      repositoryId: 'repo-1'
    };

    // notesContent, notesFileName, etc. should be initialized
    expect(() => {
      render(
        <BrowserRouter>
          <AgentPanel
            selectedWorktree={mockWorktree}
            selectedInstance={mockInstance}
            onCreateTerminalSession={vi.fn()}
            onCreateDirectoryTerminalSession={vi.fn()}
            onCloseTerminalSession={vi.fn()}
            onRestartInstance={vi.fn()}
            onStopInstance={vi.fn()}
            onDeleteWorktree={vi.fn()}
            error={null}
            isLeftPanelCollapsed={false}
          />
        </BrowserRouter>
      );
    }).not.toThrow();
  });
});
