import React, { useState, useEffect } from 'react';
import { Repository, Worktree, ClaudeInstance } from '../types';
import { api } from '../api';

interface DashboardProps {
  repositories: Repository[];
}

interface WorktreeDetails {
  worktree: Worktree;
  instances: ClaudeInstance[];
  gitStatus?: {
    branch: string;
    ahead: number;
    behind: number;
    hasChanges: boolean;
    files: {
      staged: number;
      unstaged: number;
      untracked: number;
    };
  };
  prStatus?: {
    exists: boolean;
    number?: number;
    title?: string;
    url?: string;
    state?: 'open' | 'closed' | 'merged';
  };
}

export const Dashboard: React.FC<DashboardProps> = ({ repositories }) => {
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [worktreeDetails, setWorktreeDetails] = useState<WorktreeDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [stoppingInstance, setStoppingInstance] = useState<string | null>(null);
  const [deletingInstance, setDeletingInstance] = useState<string | null>(null);
  const [deletingWorktree, setDeletingWorktree] = useState<string | null>(null);
  const [copiedWorktreeId, setCopiedWorktreeId] = useState<string | null>(null);

  useEffect(() => {
    if (repositories.length > 0 && !selectedRepo) {
      setSelectedRepo(repositories[0]);
    }
  }, [repositories]);

  useEffect(() => {
    if (!selectedRepo) return;

    const loadWorktreeDetails = async () => {
      setLoading(true);
      try {
        const instances = await api.getInstances();
        const details: WorktreeDetails[] = [];

        for (const worktree of selectedRepo.worktrees) {
          const worktreeInstances = instances.filter(i => i.worktreeId === worktree.id);

          // Get git status
          let gitStatus;
          try {
            gitStatus = await api.getGitStatus(worktree.id);
          } catch (error) {
            console.error('Failed to get git status:', error);
            // Fallback to diff-based detection
            try {
              const diff = await api.getGitDiff(worktree.id);
              const diffLines = diff.split('\n');
              const staged = diffLines.filter(l => l.startsWith('diff --git')).length;

              gitStatus = {
                branch: worktree.branch,
                ahead: 0,
                behind: 0,
                hasChanges: diff.trim().length > 0,
                files: {
                  staged,
                  unstaged: 0,
                  untracked: 0
                }
              };
            } catch {}
          }

          // Get PR status
          let prStatus;
          try {
            prStatus = await api.getPRStatus(worktree.id);
          } catch (error) {
            console.error('Failed to get PR status:', error);
          }

          details.push({
            worktree,
            instances: worktreeInstances,
            gitStatus,
            prStatus
          });
        }

        setWorktreeDetails(details);
      } catch (error) {
        console.error('Failed to load worktree details:', error);
      } finally {
        setLoading(false);
      }
    };

    loadWorktreeDetails();
    const interval = setInterval(loadWorktreeDetails, 5000);
    return () => clearInterval(interval);
  }, [selectedRepo]);

  const handleStopInstance = async (instanceId: string) => {
    setStoppingInstance(instanceId);
    try {
      await api.stopInstance(instanceId);
      // Refresh details
      if (selectedRepo) {
        const instances = await api.getInstances();
        setWorktreeDetails(prev =>
          prev.map(detail => ({
            ...detail,
            instances: instances.filter(i => i.worktreeId === detail.worktree.id)
          }))
        );
      }
    } catch (error) {
      console.error('Failed to stop instance:', error);
    } finally {
      setStoppingInstance(null);
    }
  };

  const handleDeleteInstance = async (instanceId: string) => {
    setDeletingInstance(instanceId);
    try {
      await api.stopInstance(instanceId);
      // Refresh details
      if (selectedRepo) {
        const instances = await api.getInstances();
        setWorktreeDetails(prev =>
          prev.map(detail => ({
            ...detail,
            instances: instances.filter(i => i.worktreeId === detail.worktree.id)
          }))
        );
      }
    } catch (error) {
      console.error('Failed to delete instance:', error);
    } finally {
      setDeletingInstance(null);
    }
  };

  const handleCopyWorktreeLink = (worktreeId: string) => {
    const url = `${window.location.origin}/?worktree=${worktreeId}`;
    navigator.clipboard.writeText(url);
    setCopiedWorktreeId(worktreeId);
    setTimeout(() => setCopiedWorktreeId(null), 2000);
  };

  const handleDeleteWorktree = async (worktreeId: string) => {
    if (!confirm('Are you sure you want to delete this worktree? This action cannot be undone.')) {
      return;
    }

    setDeletingWorktree(worktreeId);
    try {
      await api.removeWorktree(worktreeId, false);
      // Refresh the repository to update worktree list
      if (selectedRepo) {
        const repos = await api.getRepositories();
        const updatedRepo = repos.find(r => r.id === selectedRepo.id);
        if (updatedRepo) {
          setSelectedRepo(updatedRepo);
        }
      }
    } catch (error) {
      console.error('Failed to delete worktree:', error);
      alert('Failed to delete worktree. It may have uncommitted changes.');
    } finally {
      setDeletingWorktree(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return '#28a745';
      case 'starting': return '#ffc107';
      case 'stopped': return '#6c757d';
      case 'error': return '#dc3545';
      default: return '#6c757d';
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#1a1a1a' }}>
      {/* Header */}
      <div style={{
        padding: '20px 24px',
        borderBottom: '1px solid #333',
        background: '#1a1a1a'
      }}>
        <h1 style={{ margin: 0, color: '#fff', fontSize: '24px', marginBottom: '8px' }}>
          📊 Repository Dashboard
        </h1>
        <p style={{ margin: 0, color: '#888', fontSize: '14px' }}>
          Detailed view of worktrees, agents, and git status
        </p>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Repository Selector */}
        <div style={{
          width: '280px',
          borderRight: '1px solid #333',
          background: '#0d1117',
          overflowY: 'auto'
        }}>
          <div style={{ padding: '16px' }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#fff', fontSize: '14px', textTransform: 'uppercase' }}>
              Repositories
            </h3>
            {repositories.map(repo => (
              <div
                key={repo.id}
                onClick={() => setSelectedRepo(repo)}
                style={{
                  padding: '12px',
                  marginBottom: '8px',
                  background: selectedRepo?.id === repo.id ? '#21262d' : 'transparent',
                  border: `1px solid ${selectedRepo?.id === repo.id ? '#58a6ff' : '#30363d'}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  if (selectedRepo?.id !== repo.id) {
                    e.currentTarget.style.background = '#161b22';
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedRepo?.id !== repo.id) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <div style={{ fontWeight: 'bold', color: '#fff', fontSize: '13px', marginBottom: '4px' }}>
                  {repo.name}
                </div>
                <div style={{ fontSize: '11px', color: '#8b949e' }}>
                  {repo.worktrees.length} worktree{repo.worktrees.length !== 1 ? 's' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {!selectedRepo ? (
            <div style={{ textAlign: 'center', color: '#666', padding: '60px 20px' }}>
              <h3 style={{ color: '#888' }}>Select a repository to view details</h3>
            </div>
          ) : loading && worktreeDetails.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#666', padding: '60px 20px' }}>
              <div>Loading worktree details...</div>
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: '24px' }}>
                <h2 style={{ margin: '0 0 8px 0', color: '#fff', fontSize: '20px' }}>
                  {selectedRepo.name}
                </h2>
                <p style={{ margin: 0, color: '#8b949e', fontSize: '13px' }}>
                  {selectedRepo.path}
                </p>
              </div>

              {worktreeDetails.map(detail => (
                <div
                  key={detail.worktree.id}
                  style={{
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    overflow: 'hidden'
                  }}
                >
                  {/* Worktree Header */}
                  <div style={{
                    padding: '16px',
                    background: '#161b22',
                    borderBottom: '1px solid #30363d'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                          <span style={{ fontSize: '18px' }}>🌿</span>
                          <h3 style={{ margin: 0, color: '#fff', fontSize: '16px' }}>
                            {detail.worktree.branch}
                          </h3>
                          {detail.prStatus?.exists && (
                            <a
                              href={detail.prStatus.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                fontSize: '11px',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                background: detail.prStatus.state === 'merged' ? '#8957e5' :
                                           detail.prStatus.state === 'closed' ? '#f85149' : '#3fb950',
                                color: '#fff',
                                textDecoration: 'none'
                              }}
                            >
                              PR #{detail.prStatus.number}
                            </a>
                          )}
                        </div>
                        <div style={{ fontSize: '12px', color: '#8b949e' }}>
                          {detail.worktree.path}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div style={{ display: 'flex', gap: '8px', marginLeft: '16px' }}>
                        <button
                          onClick={() => handleCopyWorktreeLink(detail.worktree.id)}
                          style={{
                            background: copiedWorktreeId === detail.worktree.id ? '#28a745' : '#6c757d',
                            color: '#fff',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px'
                          }}
                          title={copiedWorktreeId === detail.worktree.id ? "Link copied!" : "Copy direct link"}
                        >
                          {copiedWorktreeId === detail.worktree.id ? '✓ Copied' : '🔗 Copy Link'}
                        </button>
                        <button
                          onClick={() => handleDeleteWorktree(detail.worktree.id)}
                          disabled={deletingWorktree === detail.worktree.id}
                          style={{
                            background: '#dc3545',
                            color: '#fff',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: '4px',
                            cursor: deletingWorktree === detail.worktree.id ? 'not-allowed' : 'pointer',
                            fontSize: '12px',
                            opacity: deletingWorktree === detail.worktree.id ? 0.6 : 1
                          }}
                          title="Delete worktree"
                        >
                          {deletingWorktree === detail.worktree.id ? 'Deleting...' : '× Remove'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Git Status */}
                  {detail.gitStatus && (
                    <div style={{
                      padding: '16px',
                      borderBottom: '1px solid #30363d',
                      background: '#0d1117'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px' }}>
                        <span style={{ fontSize: '12px', color: '#8b949e', fontWeight: 'bold' }}>GIT STATUS</span>
                      </div>
                      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: detail.gitStatus.hasChanges ? '#f59e0b' : '#3fb950'
                          }} />
                          <span style={{ fontSize: '13px', color: '#e6edf3' }}>
                            {detail.gitStatus.hasChanges ? 'Uncommitted changes' : 'Clean'}
                          </span>
                        </div>
                        {detail.gitStatus.files.staged > 0 && (
                          <div style={{ fontSize: '13px', color: '#8b949e' }}>
                            <span style={{ color: '#3fb950', fontWeight: 'bold' }}>
                              {detail.gitStatus.files.staged}
                            </span> staged
                          </div>
                        )}
                        {detail.gitStatus.ahead > 0 && (
                          <div style={{ fontSize: '13px', color: '#8b949e' }}>
                            <span style={{ color: '#58a6ff', fontWeight: 'bold' }}>
                              ↑{detail.gitStatus.ahead}
                            </span> ahead
                          </div>
                        )}
                        {detail.gitStatus.behind > 0 && (
                          <div style={{ fontSize: '13px', color: '#8b949e' }}>
                            <span style={{ color: '#f85149', fontWeight: 'bold' }}>
                              ↓{detail.gitStatus.behind}
                            </span> behind
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Agent Instances */}
                  <div style={{ padding: '16px' }}>
                    <div style={{
                      fontSize: '12px',
                      color: '#8b949e',
                      fontWeight: 'bold',
                      marginBottom: '12px'
                    }}>
                      AGENT INSTANCES ({detail.instances.length})
                    </div>
                    {detail.instances.length === 0 ? (
                      <div style={{
                        padding: '24px',
                        textAlign: 'center',
                        color: '#666',
                        fontSize: '13px',
                        background: '#0d1117',
                        borderRadius: '6px',
                        border: '1px dashed #30363d'
                      }}>
                        No agent instances running
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {detail.instances.map(instance => (
                          <div
                            key={instance.id}
                            style={{
                              padding: '12px',
                              background: '#161b22',
                              border: '1px solid #30363d',
                              borderRadius: '6px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                <span style={{
                                  fontSize: '11px',
                                  fontWeight: 'bold',
                                  color: '#fff',
                                  textTransform: 'uppercase'
                                }}>
                                  {instance.agentType}
                                </span>
                                <span style={{
                                  fontSize: '10px',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  background: getStatusColor(instance.status),
                                  color: instance.status === 'starting' ? '#000' : '#fff'
                                }}>
                                  {instance.status}
                                </span>
                              </div>
                              <div style={{ fontSize: '11px', color: '#8b949e' }}>
                                ID: {instance.id.slice(-8)}
                                {instance.pid && ` • PID: ${instance.pid}`}
                                {instance.port && ` • Port: ${instance.port}`}
                              </div>
                            </div>

                            <div style={{ display: 'flex', gap: '6px' }}>
                              {instance.status === 'running' && (
                                <button
                                  onClick={() => handleStopInstance(instance.id)}
                                  disabled={stoppingInstance === instance.id}
                                  style={{
                                    background: '#dc3545',
                                    border: 'none',
                                    color: '#fff',
                                    padding: '4px 12px',
                                    borderRadius: '4px',
                                    cursor: stoppingInstance === instance.id ? 'not-allowed' : 'pointer',
                                    fontSize: '11px',
                                    opacity: stoppingInstance === instance.id ? 0.6 : 1
                                  }}
                                >
                                  {stoppingInstance === instance.id ? 'Stopping...' : 'Stop'}
                                </button>
                              )}
                              {(instance.status === 'stopped' || instance.status === 'error') && (
                                <button
                                  onClick={() => handleDeleteInstance(instance.id)}
                                  disabled={deletingInstance === instance.id}
                                  style={{
                                    background: '#6c757d',
                                    border: 'none',
                                    color: '#fff',
                                    padding: '4px 12px',
                                    borderRadius: '4px',
                                    cursor: deletingInstance === instance.id ? 'not-allowed' : 'pointer',
                                    fontSize: '11px',
                                    opacity: deletingInstance === instance.id ? 0.6 : 1
                                  }}
                                >
                                  {deletingInstance === instance.id ? 'Removing...' : 'Remove'}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
