import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BrowserRouter } from 'react-router-dom';
import { RepositoryPanel } from '../RepositoryPanel';
import { api } from '../../api';
import { AgentInfo, AgentType, Repository } from '../../types';

// Mock the API
vi.mock('../../api', () => ({
  api: {
    getAgents: vi.fn(),
  }
}));

describe('Agent Selection in Worktree Creation', () => {
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
    },
    {
      type: 'gemini' as AgentType,
      name: 'Gemini',
      command: 'gemini',
      isAvailable: true,
      isAuthenticated: true,
      version: '2.0.0',
      statusMessage: 'Ready'
    },
    {
      type: 'kiro' as AgentType,
      name: 'Kiro',
      command: 'kiro',
      isAvailable: false,
      isAuthenticated: false,
      version: undefined,
      statusMessage: 'Not installed'
    }
  ];

  const mockRepositories: Repository[] = [{
    id: 'repo-1',
    name: 'Test Repo',
    path: '/path/to/repo',
    mainBranch: 'main',
    worktrees: []
  }];

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getAgents as any).mockResolvedValue(mockAgents);
  });

  it('should fetch available agents on mount', async () => {
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

  it('should show agent selector when creating a new worktree', async () => {
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

    // Wait for agents to load
    await waitFor(() => {
      expect(api.getAgents).toHaveBeenCalled();
    });

    // Click the "+" button to show new worktree form
    const addButton = screen.getByTitle(/Create new worktree/i);
    fireEvent.click(addButton);

    // Agent selector should be visible
    await waitFor(() => {
      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();
    });
  });

  it('should display only available and authenticated agents in selector', async () => {
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

    // Open new worktree form
    const addButton = screen.getByTitle(/Create new worktree/i);
    fireEvent.click(addButton);

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      const options = Array.from(select.options);

      // Should show Claude, Codex, and Gemini (all available and authenticated)
      expect(options.some(opt => opt.textContent?.includes('Claude'))).toBe(true);
      expect(options.some(opt => opt.textContent?.includes('Codex'))).toBe(true);
      expect(options.some(opt => opt.textContent?.includes('Gemini'))).toBe(true);

      // Should NOT show Kiro (not available)
      expect(options.some(opt => opt.textContent?.includes('Kiro'))).toBe(false);
    });
  });

  it('should auto-select first available agent by default', async () => {
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

    // Open new worktree form
    const addButton = screen.getByTitle(/Create new worktree/i);
    fireEvent.click(addButton);

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      // First available agent (Claude) should be selected by default
      expect(select.value).toBe('claude');
    });
  });

  it('should pass selected agent type when creating worktree', async () => {
    const mockCreateWorktree = vi.fn();

    render(
      <BrowserRouter>
        <RepositoryPanel
          repositories={mockRepositories}
          instances={[]}
          selectedWorktreeId={null}
          selectedRepositoryId={null}
          onAddRepository={vi.fn()}
          onCreateWorktreeAndStartInstance={mockCreateWorktree}
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

    // Open new worktree form
    const addButton = screen.getByTitle(/Create new worktree/i);
    fireEvent.click(addButton);

    await waitFor(() => {
      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();
    });

    // Enter branch name
    const branchInput = screen.getByPlaceholderText(/Branch name/i);
    fireEvent.change(branchInput, { target: { value: 'feature-test' } });

    // Select Codex
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'codex' } });

    // Click Create button
    const createButton = screen.getByText('Create');
    fireEvent.click(createButton);

    // Should call the handler with the selected agent type
    await waitFor(() => {
      expect(mockCreateWorktree).toHaveBeenCalledWith('repo-1', 'feature-test', 'codex');
    });
  });

  it('should allow changing agent selection', async () => {
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

    // Open new worktree form
    const addButton = screen.getByTitle(/Create new worktree/i);
    fireEvent.click(addButton);

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('claude');
    });

    // Change to Gemini
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'gemini' } });

    expect(select.value).toBe('gemini');

    // Change to Codex
    fireEvent.change(select, { target: { value: 'codex' } });

    expect(select.value).toBe('codex');
  });

  it('should show agent version in selector options', async () => {
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

    // Open new worktree form
    const addButton = screen.getByTitle(/Create new worktree/i);
    fireEvent.click(addButton);

    await waitFor(() => {
      // Should show versions in parentheses
      expect(screen.getByText(/Claude.*1\.0\.0/)).toBeInTheDocument();
      expect(screen.getByText(/Codex.*0\.23\.0/)).toBeInTheDocument();
      expect(screen.getByText(/Gemini.*2\.0\.0/)).toBeInTheDocument();
    });
  });

  it('should handle empty agent list gracefully', async () => {
    (api.getAgents as any).mockResolvedValue([]);

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

    // Should not crash with empty agent list
    const addButton = screen.getByTitle(/Create new worktree/i);
    fireEvent.click(addButton);

    // Form should still be visible
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Branch name/i)).toBeInTheDocument();
    });
  });
});
