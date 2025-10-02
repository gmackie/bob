import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Dashboard } from '../Dashboard';
import { Repository } from '../../types';
import { api } from '../../api';

// Mock the API
vi.mock('../../api', () => ({
  api: {
    getInstances: vi.fn(),
    getGitStatus: vi.fn(),
    getPRStatus: vi.fn(),
    getGitDiff: vi.fn(),
    stopInstance: vi.fn(),
    removeWorktree: vi.fn(),
    getRepositories: vi.fn(),
  }
}));

describe('Dashboard', () => {
  const mockRepositories: Repository[] = [
    {
      id: 'repo-1',
      name: 'test-repo',
      path: '/path/to/repo',
      mainBranch: 'main',
      worktrees: [
        {
          id: 'worktree-1',
          repositoryId: 'repo-1',
          branch: 'feature-branch',
          path: '/path/to/worktree',
          preferredAgent: 'claude'
        }
      ]
    }
  ];

  const mockInstances = [
    {
      id: 'instance-1',
      worktreeId: 'worktree-1',
      agentType: 'claude' as const,
      status: 'running' as const,
      pid: 1234,
      port: 3000
    }
  ];

  const mockGitStatus = {
    branch: 'feature-branch',
    ahead: 2,
    behind: 0,
    hasChanges: true,
    files: {
      staged: 1,
      unstaged: 2,
      untracked: 0
    }
  };

  const mockPRStatus = {
    exists: true,
    number: 42,
    title: 'Test PR',
    url: 'https://github.com/test/test/pull/42',
    state: 'open' as const
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getInstances as any).mockResolvedValue(mockInstances);
    (api.getGitStatus as any).mockResolvedValue(mockGitStatus);
    (api.getPRStatus as any).mockResolvedValue(mockPRStatus);
  });

  it('renders repository selector', async () => {
    render(<Dashboard repositories={mockRepositories} />);

    await waitFor(() => {
      expect(screen.getByText('test-repo')).toBeInTheDocument();
    });
  });

  it('displays worktree details when repository is selected', async () => {
    render(<Dashboard repositories={mockRepositories} />);

    await waitFor(() => {
      expect(screen.getByText('feature-branch')).toBeInTheDocument();
      expect(screen.getByText('/path/to/worktree')).toBeInTheDocument();
    });
  });

  it('shows git status information', async () => {
    render(<Dashboard repositories={mockRepositories} />);

    await waitFor(() => {
      expect(screen.getByText('Uncommitted changes')).toBeInTheDocument();
      expect(screen.getByText(/1.*staged/i)).toBeInTheDocument();
    });
  });

  it('displays PR status badge when PR exists', async () => {
    render(<Dashboard repositories={mockRepositories} />);

    await waitFor(() => {
      expect(screen.getByText('PR #42')).toBeInTheDocument();
    });
  });

  it('shows agent instances with status', async () => {
    render(<Dashboard repositories={mockRepositories} />);

    await waitFor(() => {
      expect(screen.getByText(/instance-1/i)).toBeInTheDocument();
      expect(screen.getByText('running')).toBeInTheDocument();
    });
  });

  it('calls stopInstance when stop button is clicked', async () => {
    (api.stopInstance as any).mockResolvedValue({});

    render(<Dashboard repositories={mockRepositories} />);

    await waitFor(() => {
      const stopButton = screen.getByText('Stop');
      fireEvent.click(stopButton);
    });

    await waitFor(() => {
      expect(api.stopInstance).toHaveBeenCalledWith('instance-1');
    });
  });

  it('copies worktree link to clipboard', async () => {
    const mockClipboard = {
      writeText: vi.fn().mockResolvedValue(undefined)
    };
    Object.assign(navigator, { clipboard: mockClipboard });

    render(<Dashboard repositories={mockRepositories} />);

    await waitFor(() => {
      const copyButton = screen.getByText(/Copy Link/i);
      fireEvent.click(copyButton);
    });

    expect(mockClipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('worktree-1')
    );
  });

  it('handles worktree deletion with confirmation', async () => {
    const mockConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    (api.removeWorktree as any).mockResolvedValue({});
    (api.getRepositories as any).mockResolvedValue(mockRepositories);

    render(<Dashboard repositories={mockRepositories} />);

    await waitFor(() => {
      const removeButton = screen.getByText(/Remove/i);
      fireEvent.click(removeButton);
    });

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalled();
      expect(api.removeWorktree).toHaveBeenCalledWith('worktree-1', false);
    });

    mockConfirm.mockRestore();
  });

  it('falls back to diff-based status when git status fails', async () => {
    (api.getGitStatus as any).mockRejectedValue(new Error('Git status failed'));
    (api.getGitDiff as any).mockResolvedValue('diff --git a/file.txt b/file.txt');

    render(<Dashboard repositories={mockRepositories} />);

    await waitFor(() => {
      expect(api.getGitDiff).toHaveBeenCalled();
    });
  });

  it('refreshes data every 5 seconds', async () => {
    vi.useFakeTimers();

    render(<Dashboard repositories={mockRepositories} />);

    await waitFor(() => {
      expect(api.getInstances).toHaveBeenCalledTimes(1);
    });

    vi.advanceTimersByTime(5000);

    await waitFor(() => {
      expect(api.getInstances).toHaveBeenCalledTimes(2);
    });

    vi.useRealTimers();
  });
});
