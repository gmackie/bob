import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import React from 'react';
import { RepositoryPanel } from '../../components/RepositoryPanel';

describe('RepositoryPanel agent selection', () => {
  const repositories = [
    {
      id: 'repo1',
      name: 'Repo One',
      path: '/tmp/repo1',
      branch: 'main',
      mainBranch: 'main',
      worktrees: [
        { id: 'wt1', path: '/tmp/repo1/wt1', branch: 'feature/x', repositoryId: 'repo1', instances: [], isMainWorktree: false },
      ],
    },
  ];

  const instances: any[] = [];
  const agents = [
    { type: 'claude', name: 'Claude Code', command: 'claude', isAvailable: true, isAuthenticated: true },
    { type: 'codex', name: 'Codex', command: 'codex', isAvailable: true, isAuthenticated: true },
  ] as any[];

  it('invokes create with selected agent type', () => {
    const onCreate = vi.fn();
    render(
      <RepositoryPanel
        repositories={repositories as any}
        instances={instances as any}
        selectedWorktreeId={null}
        onAddRepository={vi.fn()}
        onCreateWorktreeAndStartInstance={onCreate}
        onSelectWorktree={vi.fn() as any}
        onDeleteWorktree={vi.fn() as any}
        onRefreshMainBranch={vi.fn() as any}
        isCollapsed={false}
        onToggleCollapse={() => {}}
        agents={agents as any}
      />
    );

    // Open new worktree form
    fireEvent.click(screen.getByTitle('Create new worktree and start agent instance'));

    // Enter branch name
    const input = screen.getByPlaceholderText('Branch name (e.g., feature-xyz)');
    fireEvent.change(input, { target: { value: 'feat-test' } });

    // Select Codex agent
    const select = screen.getByTitle('Select agent for this worktree');
    fireEvent.change(select, { target: { value: 'codex' } });

    // Click create
    fireEvent.click(screen.getByText('Create'));

    expect(onCreate).toHaveBeenCalled();
    const args = onCreate.mock.calls[0];
    expect(args[0]).toBe('repo1');
    expect(args[1]).toBe('feat-test');
    expect(args[2]).toBe('codex');
  });
});

describe('RepositoryPanel repository selection', () => {
  const repositories = [
    {
      id: 'repo1',
      name: 'Test Repository',
      path: '/tmp/test-repo',
      branch: 'main',
      mainBranch: 'main',
      worktrees: [
        { id: 'wt1', path: '/tmp/test-repo/wt1', branch: 'feature/test', repositoryId: 'repo1', instances: [], isMainWorktree: false },
      ],
    },
  ];

  const instances: any[] = [];
  const agents = [
    { type: 'claude', name: 'Claude Code', command: 'claude', isAvailable: true, isAuthenticated: true },
  ] as any[];

  it('calls onSelectRepository when repository name is clicked', () => {
    const onSelectRepository = vi.fn();
    render(
      <RepositoryPanel
        repositories={repositories as any}
        instances={instances as any}
        selectedWorktreeId={null}
        selectedRepositoryId={null}
        onAddRepository={vi.fn()}
        onCreateWorktreeAndStartInstance={vi.fn()}
        onSelectWorktree={vi.fn() as any}
        onSelectRepository={onSelectRepository}
        onDeleteWorktree={vi.fn() as any}
        onRefreshMainBranch={vi.fn() as any}
        isCollapsed={false}
        onToggleCollapse={() => {}}
        agents={agents as any}
      />
    );

    // Click on repository name
    const repoName = screen.getByText('Test Repository');
    fireEvent.click(repoName);

    expect(onSelectRepository).toHaveBeenCalledWith('repo1');
  });

  it('highlights selected repository', () => {
    render(
      <RepositoryPanel
        repositories={repositories as any}
        instances={instances as any}
        selectedWorktreeId={null}
        selectedRepositoryId="repo1"
        onAddRepository={vi.fn()}
        onCreateWorktreeAndStartInstance={vi.fn()}
        onSelectWorktree={vi.fn() as any}
        onSelectRepository={vi.fn()}
        onDeleteWorktree={vi.fn() as any}
        onRefreshMainBranch={vi.fn() as any}
        isCollapsed={false}
        onToggleCollapse={() => {}}
        agents={agents as any}
      />
    );

    // Get the repository name element
    const repoName = screen.getByText('Test Repository');

    // Check that it has the highlighted color style
    expect(repoName.style.color).toBe('rgb(88, 166, 255)'); // #58a6ff
  });

  it('does not call onSelectRepository if handler is not provided', () => {
    // Should not throw error when onSelectRepository is undefined
    render(
      <RepositoryPanel
        repositories={repositories as any}
        instances={instances as any}
        selectedWorktreeId={null}
        onAddRepository={vi.fn()}
        onCreateWorktreeAndStartInstance={vi.fn()}
        onSelectWorktree={vi.fn() as any}
        onDeleteWorktree={vi.fn() as any}
        onRefreshMainBranch={vi.fn() as any}
        isCollapsed={false}
        onToggleCollapse={() => {}}
        agents={agents as any}
      />
    );

    const repoName = screen.getByText('Test Repository');

    // Should not throw error
    expect(() => fireEvent.click(repoName)).not.toThrow();
  });
});

