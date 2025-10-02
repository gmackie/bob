import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Repository, Worktree } from '../types';
import { api } from '../api';

interface GitRemote {
  name: string;
  url: string;
  type: 'fetch' | 'push';
}

interface GitBranch {
  name: string;
  isLocal: boolean;
  isRemote: boolean;
  isCurrent: boolean;
  lastCommit?: {
    hash: string;
    message: string;
    author: string;
    date: string;
  };
}

interface GitGraphNode {
  hash: string;
  parents: string[];
  message: string;
  author: string;
  date: string;
  branch?: string;
  x: number;
  y: number;
}

export const RepositoryDashboard: React.FC = () => {
  const { repositoryId } = useParams<{ repositoryId: string }>();
  const navigate = useNavigate();
  const [repository, setRepository] = useState<Repository | null>(null);
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [gitGraph, setGitGraph] = useState<GitGraphNode[]>([]);
  const [projectNotes, setProjectNotes] = useState<string>('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'branches' | 'graph' | 'docs' | 'notes'>('dashboard');
  const [creatingFromBranch, setCreatingFromBranch] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState<string>('');
  const [creatingWorktree, setCreatingWorktree] = useState<boolean>(false);
  // Docs state - currently unused but kept for future docs feature
  const [, setDocsList] = useState<Array<{ name: string; relativePath: string; size: number; mtime: number }>>([]);
  const [, setSelectedDoc] = useState<string | null>(null);
  const [, setDocContent] = useState<string>('');
  const [, setLoadingDocs] = useState<boolean>(false);

  useEffect(() => {
    loadRepositoryData();
  }, [repositoryId]);

  const loadRepositoryData = async () => {
    if (!repositoryId) return;

    try {
      setLoading(true);

      // Load repository data
      const repoData = await api.getRepository(repositoryId);
      setRepository(repoData);

      // Load git information
      const [remotesData, branchesData, graphData] = await Promise.all([
        api.getGitRemotes(repositoryId),
        api.getGitBranches(repositoryId),
        api.getGitGraph(repositoryId)
      ]);

      setRemotes(remotesData);
      setBranches(branchesData);
      setGitGraph(graphData);

      // Load project notes
      const notes = await api.getProjectNotes(repositoryId);
      setProjectNotes(notes);

    } catch (error) {
      console.error('Failed to load repository data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadDocs = async () => {
      if (!repositoryId) return;
      try {
        setLoadingDocs(true);
        const list = await api.getRepositoryDocs(repositoryId);
        setDocsList(list);
        if (list.length > 0 && !selectedDoc) {
          // Auto-select README if present
          const readme = list.find(d => d.name.toLowerCase().startsWith('readme')) || list[0];
          setSelectedDoc(readme.relativePath);
          const content = await api.getRepositoryDocContent(repositoryId, readme.relativePath);
          setDocContent(content);
        }
      } catch (err) {
        console.error('Failed to load docs:', err);
      } finally {
        setLoadingDocs(false);
      }
    };
    if (activeTab === 'docs') {
      loadDocs();
    }
  }, [activeTab, repositoryId]);

  // Currently unused but kept for future docs feature
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const loadDocContent = async (relativePath: string) => {
    if (!repositoryId) return;
    try {
      const content = await api.getRepositoryDocContent(repositoryId, relativePath);
      setSelectedDoc(relativePath);
      setDocContent(content);
    } catch (err) {
      console.error('Failed to load doc content:', err);
    }
  };

  const saveProjectNotes = async () => {
    if (!repositoryId) return;

    try {
      await api.saveProjectNotes(repositoryId, projectNotes);
      setEditingNotes(false);
    } catch (error) {
      console.error('Failed to save project notes:', error);
    }
  };

  const startCreateWorktree = (baseBranch: string) => {
    // Suggest a default new branch name
    const cleanBase = baseBranch.replace(/^origin\//, '');
    const suggested = `feature/${cleanBase}`;
    setCreatingFromBranch(baseBranch);
    setNewBranchName(suggested);
  };

  const cancelCreateWorktree = () => {
    setCreatingFromBranch(null);
    setNewBranchName('');
    setCreatingWorktree(false);
  };

  const createWorktreeFromBranch = async () => {
    if (!repositoryId || !creatingFromBranch || !newBranchName.trim()) return;
    try {
      setCreatingWorktree(true);
      const worktree = await api.createWorktree(repositoryId, newBranchName.trim(), creatingFromBranch);
      // Navigate to main interface selecting this worktree
      navigate(`/?worktree=${worktree.id}`);
    } catch (error) {
      console.error('Failed to create worktree:', error);
    } finally {
      cancelCreateWorktree();
    }
  };

  const getGitHostIcon = (url: string) => {
    if (url.includes('github.com')) return '🐙';
    if (url.includes('gitlab.com')) return '🦊';
    if (url.includes('bitbucket.org')) return '🪣';
    return '🔗';
  };

  const formatGitUrl = (url: string) => {
    // Convert SSH URLs to HTTPS for web viewing
    if (url.startsWith('git@')) {
      return url
        .replace('git@', 'https://')
        .replace('.com:', '.com/')
        .replace('.org:', '.org/')
        .replace(/\.git$/, '');
    }
    return url.replace(/\.git$/, '');
  };

  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="loading">Loading repository data...</div>
      </div>
    );
  }

  if (!repository) {
    return (
      <div className="dashboard-container">
        <div className="error">Repository not found</div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <button
          onClick={() => navigate('/')}
          className="back-button"
        >
          ← Back
        </button>
        <h2>{repository.name}</h2>
        <div className="repo-path">{repository.path}</div>
      </div>

      <div className="dashboard-tabs">
        <button
          className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={`tab ${activeTab === 'branches' ? 'active' : ''}`}
          onClick={() => setActiveTab('branches')}
        >
          Branches ({branches.length})
        </button>
        <button
          className={`tab ${activeTab === 'graph' ? 'active' : ''}`}
          onClick={() => setActiveTab('graph')}
        >
          Git Graph
        </button>
        <button
          className={`tab ${activeTab === 'notes' ? 'active' : ''}`}
          onClick={() => setActiveTab('notes')}
        >
          Project Notes
        </button>
      </div>

      <div className="dashboard-content">
        {activeTab === 'dashboard' && (
          <div className="overview-section">
            <div className="info-card">
              <h3>Repository Information</h3>
              <div className="info-row">
                <span className="info-label">Main Branch:</span>
                <span className="info-value">{repository.mainBranch}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Current Branch:</span>
                <span className="info-value">{repository.branch}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Worktrees:</span>
                <span className="info-value">{repository.worktrees.length}</span>
              </div>
            </div>

            <div className="info-card">
              <h3>Remote Repositories</h3>
              {remotes.length === 0 ? (
                <div className="empty-state">No remotes configured</div>
              ) : (
                <div className="remotes-list">
                  {remotes.map((remote, idx) => (
                    <div key={idx} className="remote-item">
                      <span className="remote-icon">{getGitHostIcon(remote.url)}</span>
                      <span className="remote-name">{remote.name}</span>
                      <a
                        href={formatGitUrl(remote.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="remote-link"
                      >
                        {remote.url}
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="info-card">
              <h3>Active Worktrees</h3>
              {repository.worktrees.length === 0 ? (
                <div className="empty-state">No worktrees created</div>
              ) : (
                <div className="worktrees-grid">
                  {repository.worktrees.map(worktree => (
                    <div
                      key={worktree.id}
                      className="worktree-card"
                      onClick={() => navigate(`/?worktree=${worktree.id}`)}
                    >
                      <div className="worktree-branch">{worktree.branch}</div>
                      <div className="worktree-path">{worktree.path}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'branches' && (
          <div className="branches-section">
            <div className="branches-header">
              <h3>All Branches</h3>
              <button className="refresh-button" onClick={loadRepositoryData}>
                ⟳ Refresh
              </button>
            </div>
            <div className="branches-list">
              {branches.map(branch => (
                <div key={branch.name} className="branch-item">
                  <div className="branch-info">
                    <span className="branch-name">
                      {branch.isCurrent && '● '}
                      {branch.name}
                    </span>
                    <div className="branch-badges">
                      {branch.isLocal && <span className="badge local">local</span>}
                      {branch.isRemote && <span className="badge remote">remote</span>}
                    </div>
                  </div>
                  {branch.lastCommit && (
                    <div className="branch-commit">
                      <span className="commit-hash">{branch.lastCommit.hash.substring(0, 7)}</span>
                      <span className="commit-message">{branch.lastCommit.message}</span>
                      <span className="commit-author">by {branch.lastCommit.author}</span>
                    </div>
                  )}
                  <div className="branch-actions">
                    {creatingFromBranch === branch.name ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', marginTop: 8 }}>
                        <input
                          type="text"
                          value={newBranchName}
                          onChange={(e) => setNewBranchName(e.target.value)}
                          placeholder={`New branch name (base: ${branch.name})`}
                          className="input"
                          style={{ flex: 1 }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') createWorktreeFromBranch();
                            if (e.key === 'Escape') cancelCreateWorktree();
                          }}
                          autoFocus
                        />
                        <button
                          className="action-button"
                          disabled={creatingWorktree || !newBranchName.trim()}
                          onClick={createWorktreeFromBranch}
                        >
                          {creatingWorktree ? 'Creating…' : 'Create'}
                        </button>
                        <button className="secondary-button" onClick={cancelCreateWorktree}>Cancel</button>
                      </div>
                    ) : (
                      <button
                        className="action-button"
                        onClick={() => startCreateWorktree(branch.name)}
                      >
                        Create Worktree
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'graph' && (
          <div className="graph-section">
            <h3>Git Commit Graph</h3>
            <div className="git-graph">
              <svg width="100%" height="600" viewBox="0 0 1200 600">
                {gitGraph.map((node, idx) => (
                  <g key={node.hash}>
                    {node.parents.map(parentHash => {
                      const parent = gitGraph.find(n => n.hash === parentHash);
                      if (parent) {
                        return (
                          <line
                            key={`${node.hash}-${parentHash}`}
                            x1={node.x}
                            y1={node.y}
                            x2={parent.x}
                            y2={parent.y}
                            stroke="#58a6ff"
                            strokeWidth="2"
                          />
                        );
                      }
                      return null;
                    })}
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r="6"
                      fill={node.branch === repository.mainBranch ? '#28a745' : '#58a6ff'}
                      stroke="#fff"
                      strokeWidth="2"
                    />
                    <text
                      x={node.x + 15}
                      y={node.y + 5}
                      fill="#fff"
                      fontSize="12"
                      className="commit-text"
                    >
                      {node.hash.substring(0, 7)} - {node.message.substring(0, 50)}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="notes-section">
            <div className="notes-header">
              <h3>Project Management Notes</h3>
              {!editingNotes ? (
                <button
                  className="edit-button"
                  onClick={() => setEditingNotes(true)}
                >
                  ✏️ Edit
                </button>
              ) : (
                <div className="notes-actions">
                  <button
                    className="save-button"
                    onClick={saveProjectNotes}
                  >
                    💾 Save
                  </button>
                  <button
                    className="cancel-button"
                    onClick={() => setEditingNotes(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            {editingNotes ? (
              <textarea
                className="notes-editor"
                value={projectNotes}
                onChange={(e) => setProjectNotes(e.target.value)}
                placeholder="# Project Notes&#10;&#10;Add your project management notes here using Markdown..."
              />
            ) : (
              <div className="notes-content">
                {projectNotes ? (
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(projectNotes) }} />
                ) : (
                  <div className="empty-state">No project notes yet. Click Edit to add some.</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Simple markdown renderer (you might want to use a library like marked for production)
function renderMarkdown(text: string): string {
  return text
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/\n/g, '<br/>');
}
