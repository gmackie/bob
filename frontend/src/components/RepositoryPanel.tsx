import React, { useMemo, useState } from 'react';
import { Repository, Worktree, ClaudeInstance, AgentInfo, AgentType } from '../types';
import { DirectoryBrowser } from './DirectoryBrowser';
import { DeleteWorktreeModal } from './DeleteWorktreeModal';
import { AgentSelector, AgentBadge } from './AgentSelector';

interface RepositoryPanelProps {
  repositories: Repository[];
  instances: ClaudeInstance[];
  selectedWorktreeId: string | null;
  selectedRepositoryId?: string | null;
  onAddRepository: (path: string) => void;
  onCreateWorktreeAndStartInstance: (repositoryId: string, branchName: string, agentType?: AgentType) => void;
  onSelectWorktree: (worktreeId: string) => Promise<void>;
  onSelectRepository?: (repositoryId: string) => void;
  onDeleteWorktree: (worktreeId: string, force: boolean) => Promise<void>;
  onRefreshMainBranch: (repositoryId: string) => Promise<void>;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  agents?: AgentInfo[];
}

export const RepositoryPanel: React.FC<RepositoryPanelProps> = ({
  repositories,
  instances,
  selectedWorktreeId,
  selectedRepositoryId,
  onAddRepository,
  onCreateWorktreeAndStartInstance,
  onSelectWorktree,
  onSelectRepository,
  onDeleteWorktree,
  onRefreshMainBranch,
  isCollapsed,
  onToggleCollapse,
  agents = []
}) => {
  const [showDirectoryBrowser, setShowDirectoryBrowser] = useState(false);
  const [showNewWorktreeForm, setShowNewWorktreeForm] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const defaultAgent = useMemo<AgentType | undefined>(() => {
    const ready = agents.filter(a => a.isAvailable && a.isAuthenticated);
    if (ready.find(a => a.type === 'claude')) return 'claude';
    return ready[0]?.type;
  }, [agents]);
  const [selectedAgent, setSelectedAgent] = useState<AgentType | undefined>(defaultAgent);
  const [worktreeToDelete, setWorktreeToDelete] = useState<Worktree | null>(null);
  const [startingInstances, setStartingInstances] = useState<Set<string>>(new Set());
  const [copiedWorktreeId, setCopiedWorktreeId] = useState<string | null>(null);
  const [refreshingRepositories, setRefreshingRepositories] = useState<Set<string>>(new Set());
  const [expandedWorktrees, setExpandedWorktrees] = useState<Set<string>>(new Set());

  const handleDirectorySelect = (path: string) => {
    onAddRepository(path);
    setShowDirectoryBrowser(false);
  };

  const handleCreateWorktree = (repositoryId: string) => {
    if (newBranchName.trim()) {
      onCreateWorktreeAndStartInstance(repositoryId, newBranchName.trim(), selectedAgent);
      setNewBranchName('');
      setShowNewWorktreeForm(null);
      setSelectedAgent(defaultAgent);
    }
  };

  const getWorktreeStatus = (worktree: Worktree) => {
    const worktreeInstances = instances.filter(i => i.worktreeId === worktree.id);
    if (worktreeInstances.length === 0) return { status: 'none', label: 'No Instance' };
    
    // Since we enforce single instance per worktree, just get the first (and only) instance
    const instance = worktreeInstances[0];
    
    switch (instance.status) {
      case 'running':
        return { status: 'running', label: `Running · ${instance.agentType.toUpperCase()}` };
      case 'starting':
        return { status: 'starting', label: `Starting · ${instance.agentType.toUpperCase()}` };
      case 'error':
        return { status: 'error', label: `Error · ${instance.agentType.toUpperCase()}` };
      case 'stopped':
      default:
        return { status: 'stopped', label: `Stopped · ${instance.agentType.toUpperCase()}` };
    }
  };

  const getBranchDisplayName = (branch: string) => {
    // Extract the branch name from refs/heads/branch-name or just return branch name
    return branch.replace(/^refs\/heads\//, '');
  };

  const toggleWorktreeExpansion = (worktreeId: string) => {
    setExpandedWorktrees(prev => {
      const newSet = new Set(prev);
      if (newSet.has(worktreeId)) {
        newSet.delete(worktreeId);
      } else {
        newSet.add(worktreeId);
      }
      return newSet;
    });
  };

  const getWorktreeInstanceCounts = (worktreeId: string) => {
    const worktreeInstances = instances.filter(i => i.worktreeId === worktreeId);
    return {
      running: worktreeInstances.filter(i => i.status === 'running').length,
      starting: worktreeInstances.filter(i => i.status === 'starting').length,
      stopped: worktreeInstances.filter(i => i.status === 'stopped').length,
      error: worktreeInstances.filter(i => i.status === 'error').length,
      total: worktreeInstances.length
    };
  };

  const handleWorktreeSelect = async (worktreeId: string) => {
    // Mark this worktree as having an instance being started
    setStartingInstances(prev => new Set(prev).add(worktreeId));

    try {
      await onSelectWorktree(worktreeId);
    } finally {
      // Remove from starting instances after a delay to let the status update
      setTimeout(() => {
        setStartingInstances(prev => {
          const newSet = new Set(prev);
          newSet.delete(worktreeId);
          return newSet;
        });
      }, 2000);
    }
  };

  const handleCopyWorktreeLink = async (worktreeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('worktree', worktreeId);
    const linkUrl = currentUrl.toString();

    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopiedWorktreeId(worktreeId);
      setTimeout(() => setCopiedWorktreeId(null), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
      // Fallback: show the URL in a prompt
      prompt('Copy this link:', linkUrl);
    }
  };

  const handleRefreshMainBranch = async (repositoryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    setRefreshingRepositories(prev => new Set(prev).add(repositoryId));
    
    try {
      await onRefreshMainBranch(repositoryId);
    } catch (error) {
      console.error('Failed to refresh main branch:', error);
      // Could add error notification here
    } finally {
      setRefreshingRepositories(prev => {
        const newSet = new Set(prev);
        newSet.delete(repositoryId);
        return newSet;
      });
    }
  };

  return (
    <div className={`left-panel ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {!isCollapsed && <h3 style={{ margin: 0, color: '#ffffff' }}>Repositories</h3>}
          <button
            onClick={onToggleCollapse}
            className="collapse-toggle-btn"
            title={isCollapsed ? 'Expand panel' : 'Collapse panel'}
            style={{
              background: 'transparent',
              border: '1px solid #555',
              color: '#ffffff',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px'
            }}
          >
            {isCollapsed ? '▶' : '◀'}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          <div className="add-repo-section">
            <button 
              onClick={() => setShowDirectoryBrowser(true)}
              className="add-repo-btn"
            >
              <span>+</span>
              Add Repository
            </button>
          </div>

          <div className="panel-content">
            {repositories.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#666', marginTop: '40px' }}>
                <p>No repositories added</p>
                <p style={{ fontSize: '12px' }}>Click "Add Repository" to get started</p>
              </div>
            ) : (
              <div className="repository-list">
                {repositories.map(repo => (
                  <div key={repo.id} className="repository-item">
                    <div className="repository-header">
                      <div className="repository-info">
                        <h4
                          onClick={() => onSelectRepository?.(repo.id)}
                          style={{
                            cursor: 'pointer',
                            color: selectedRepositoryId === repo.id ? '#58a6ff' : 'inherit',
                            transition: 'color 0.2s'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = '#58a6ff'}
                          onMouseLeave={(e) => e.currentTarget.style.color = selectedRepositoryId === repo.id ? '#58a6ff' : ''}
                        >
                          {repo.name}
                        </h4>
                        <p>{repo.path}</p>
                        <div style={{ 
                          fontSize: '12px', 
                          color: '#888', 
                          marginTop: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}>
                          <span>Main: <strong>{repo.mainBranch}</strong></span>
                          <button
                            onClick={(e) => handleRefreshMainBranch(repo.id, e)}
                            disabled={refreshingRepositories.has(repo.id)}
                            style={{
                              background: '#6c757d',
                              color: '#fff',
                              border: 'none',
                              padding: '2px 6px',
                              borderRadius: '3px',
                              cursor: refreshingRepositories.has(repo.id) ? 'not-allowed' : 'pointer',
                              fontSize: '10px',
                              opacity: refreshingRepositories.has(repo.id) ? 0.6 : 1
                            }}
                            title={refreshingRepositories.has(repo.id) ? 'Refreshing...' : 'Refresh main branch'}
                          >
                            {refreshingRepositories.has(repo.id) ? '↻' : '⟳'}
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={() => { setShowNewWorktreeForm(repo.id); setSelectedAgent(defaultAgent); }}
                        className="add-worktree-btn"
                        title="Create new worktree and start agent instance"
                      >
                        +
                      </button>
                    </div>

                    {showNewWorktreeForm === repo.id && (
                      <div style={{ padding: '12px 16px', background: '#2a2a2a', borderTop: '1px solid #444' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <input
                            type="text"
                            value={newBranchName}
                            onChange={(e) => setNewBranchName(e.target.value)}
                            placeholder="Branch name (e.g., feature-xyz)"
                            className="input"
                            style={{ width: '100%', fontSize: '12px', padding: '6px 8px' }}
                            onKeyPress={(e) => e.key === 'Enter' && handleCreateWorktree(repo.id)}
                            autoFocus
                          />
                          <AgentSelector
                            agents={agents}
                            value={selectedAgent}
                            onChange={setSelectedAgent}
                            style={{ width: '100%' }}
                          />
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => handleCreateWorktree(repo.id)}
                              disabled={!newBranchName.trim()}
                              className="button"
                              style={{ flex: 1, fontSize: '12px', padding: '6px 12px' }}
                            >
                              Create
                            </button>
                            <button
                              onClick={() => {
                                setShowNewWorktreeForm(null);
                                setNewBranchName('');
                              }}
                              className="button secondary"
                              style={{ flex: 1, fontSize: '12px', padding: '6px 12px' }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Show all Bob-managed worktrees (main worktrees are excluded from data) */}
                    {repo.worktrees.length > 0 && (
                      <div className="worktrees-list" style={{ maxHeight: 'none' }}>
                        {repo.worktrees.map(worktree => {
                          const isSelected = selectedWorktreeId === worktree.id;
                          const isExpanded = expandedWorktrees.has(worktree.id);
                          const counts = getWorktreeInstanceCounts(worktree.id);
                          const worktreeInstances = instances.filter(i => i.worktreeId === worktree.id);

                          return (
                            <div
                              key={worktree.id}
                              style={{
                                borderTop: '1px solid #444',
                                background: isSelected ? '#007acc15' : 'transparent'
                              }}
                            >
                              {/* Worktree Header */}
                              <div
                                onClick={() => handleWorktreeSelect(worktree.id)}
                                style={{
                                  padding: '12px 16px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '6px'
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleWorktreeExpansion(worktree.id);
                                      }}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        color: '#888',
                                        cursor: 'pointer',
                                        fontSize: '10px',
                                        padding: '0 4px',
                                        display: counts.total > 0 ? 'block' : 'none'
                                      }}
                                    >
                                      {isExpanded ? '▼' : '▶'}
                                    </button>
                                    <div className="worktree-name" style={{ fontSize: '13px', fontWeight: 500 }}>
                                      {getBranchDisplayName(worktree.branch)}
                                    </div>
                                  </div>

                                  {/* Status count badges */}
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    {counts.running > 0 && (
                                      <span style={{
                                        fontSize: '10px',
                                        padding: '2px 6px',
                                        borderRadius: '10px',
                                        background: '#28a745',
                                        color: '#fff',
                                        fontWeight: 'bold'
                                      }}>
                                        {counts.running}
                                      </span>
                                    )}
                                    {counts.starting > 0 && (
                                      <span style={{
                                        fontSize: '10px',
                                        padding: '2px 6px',
                                        borderRadius: '10px',
                                        background: '#ffc107',
                                        color: '#000',
                                        fontWeight: 'bold'
                                      }}>
                                        {counts.starting}
                                      </span>
                                    )}
                                    {counts.stopped > 0 && (
                                      <span style={{
                                        fontSize: '10px',
                                        padding: '2px 6px',
                                        borderRadius: '10px',
                                        background: '#6c757d',
                                        color: '#fff',
                                        fontWeight: 'bold'
                                      }}>
                                        {counts.stopped}
                                      </span>
                                    )}
                                    {counts.error > 0 && (
                                      <span style={{
                                        fontSize: '10px',
                                        padding: '2px 6px',
                                        borderRadius: '10px',
                                        background: '#dc3545',
                                        color: '#fff',
                                        fontWeight: 'bold'
                                      }}>
                                        {counts.error}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Repository location */}
                                <div className="worktree-path" style={{ fontSize: '11px', color: '#888', paddingLeft: counts.total > 0 ? '20px' : '0' }}>
                                  {worktree.path}
                                </div>
                              </div>

                              {/* Agent instances dropdown */}
                              {isExpanded && worktreeInstances.length > 0 && (
                                <div style={{
                                  background: '#1a1a1a',
                                  borderTop: '1px solid #333',
                                  padding: '8px 16px 8px 36px'
                                }}>
                                  {worktreeInstances.map(instance => (
                                    <div
                                      key={instance.id}
                                      style={{
                                        padding: '6px 8px',
                                        marginBottom: '4px',
                                        background: '#2a2a2a',
                                        borderRadius: '4px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        fontSize: '11px'
                                      }}
                                    >
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <AgentBadge
                                          agentType={instance.agentType}
                                          agents={agents}
                                          compact={true}
                                        />
                                        <span style={{ color: '#888' }}>•</span>
                                        <span style={{ color: '#e5e5e5' }}>
                                          {instance.id.slice(-8)}
                                        </span>
                                      </div>
                                      <span style={{
                                        fontSize: '10px',
                                        padding: '2px 6px',
                                        borderRadius: '3px',
                                        background:
                                          instance.status === 'running' ? '#28a745' :
                                          instance.status === 'starting' ? '#ffc107' :
                                          instance.status === 'error' ? '#dc3545' : '#6c757d',
                                        color: instance.status === 'starting' ? '#000' : '#fff'
                                      }}>
                                        {instance.status}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Quick access collapsed view */}
      {isCollapsed && repositories.length > 0 && (
        <div className="collapsed-content">
          {repositories.map(repo => 
            repo.worktrees.map(worktree => {
                const status = getWorktreeStatus(worktree);
                const isSelected = selectedWorktreeId === worktree.id;
                const isStarting = startingInstances.has(worktree.id);
                
                return (
                  <div
                    key={worktree.id}
                    className={`collapsed-worktree-item ${isSelected ? 'active' : ''}`}
                    onClick={() => handleWorktreeSelect(worktree.id)}
                    title={`${getBranchDisplayName(worktree.branch)} - ${worktree.path}`}
                    style={{
                      padding: '8px 12px',
                      margin: '4px 0',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      background: isSelected ? '#007acc' : '#2a2a2a',
                      border: '1px solid #444',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'column',
                      gap: '4px'
                    }}
                  >
                    <div style={{
                      fontSize: '11px',
                      fontWeight: 'bold',
                      color: '#fff',
                      textAlign: 'center',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      width: '100%'
                    }}>
                      {getBranchDisplayName(worktree.branch)}
                    </div>
                    <div
                      style={{
                        fontSize: '8px',
                        padding: '1px 4px',
                        borderRadius: '2px',
                        backgroundColor:
                          isStarting ? '#ffc107' :
                          status.status === 'running' ? '#28a745' :
                          status.status === 'starting' ? '#ffc107' :
                          status.status === 'error' ? '#dc3545' :
                          status.status === 'stopped' ? '#6c757d' :
                          status.status === 'none' ? '#888' : '#444',
                        color:
                          isStarting || status.status === 'starting' ? '#000' : '#fff'
                      }}
                    >
                      {isStarting ? 'Starting...' : status.label}
                    </div>
                  </div>
                );
              })
          )}
        </div>
      )}

      {showDirectoryBrowser && (
        <DirectoryBrowser
          onSelectDirectory={handleDirectorySelect}
          onClose={() => setShowDirectoryBrowser(false)}
        />
      )}
      
      {worktreeToDelete && (
        <DeleteWorktreeModal
          worktree={worktreeToDelete}
          onClose={() => setWorktreeToDelete(null)}
          onConfirm={onDeleteWorktree}
        />
      )}
    </div>
  );
};
