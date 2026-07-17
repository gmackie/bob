import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { AgentInfo, AgentType } from '../types';

interface GitHubRepo {
  name: string;
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean;
  url: string;
}

interface GitHubRepoSelectorProps {
  onSelect: (repoFullName: string, branch: string, agentType: AgentType) => void;
  onCancel: () => void;
}

export const GitHubRepoSelector: React.FC<GitHubRepoSelectorProps> = ({ onSelect, onCancel }) => {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [filteredRepos, setFilteredRepos] = useState<GitHubRepo[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentType>('claude');
  const [loading, setLoading] = useState(true);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);

  // Load repos and agents on mount
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [reposData, agentsData] = await Promise.all([
          api.getGitHubRepos(),
          api.getAgents()
        ]);
        setRepos(reposData);
        setFilteredRepos(reposData);
        setAgents(agentsData.filter(a => a.isAvailable));
        
        // Set default agent
        const defaultAgent = agentsData.find(a => a.isAvailable && (a.isAuthenticated ?? true));
        if (defaultAgent) {
          setSelectedAgent(defaultAgent.type);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load repositories');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Filter repos based on search
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredRepos(repos);
    } else {
      const term = searchTerm.toLowerCase();
      setFilteredRepos(repos.filter(r => 
        r.name.toLowerCase().includes(term) ||
        r.nameWithOwner.toLowerCase().includes(term) ||
        (r.description && r.description.toLowerCase().includes(term))
      ));
    }
  }, [searchTerm, repos]);

  // Load branches when repo is selected
  useEffect(() => {
    if (!selectedRepo) {
      setBranches([]);
      setSelectedBranch('');
      return;
    }

    const loadBranches = async () => {
      setLoadingBranches(true);
      try {
        const [owner, repo] = selectedRepo.nameWithOwner.split('/');
        const branchList = await api.getGitHubBranches(owner, repo);
        setBranches(branchList);
        // Default to main or master
        if (branchList.includes('main')) {
          setSelectedBranch('main');
        } else if (branchList.includes('master')) {
          setSelectedBranch('master');
        } else if (branchList.length > 0) {
          setSelectedBranch(branchList[0]);
        }
      } catch (err: any) {
        console.error('Failed to load branches:', err);
        setBranches([]);
      } finally {
        setLoadingBranches(false);
      }
    };
    loadBranches();
  }, [selectedRepo]);

  const handleSubmit = useCallback(async () => {
    if (!selectedRepo || !selectedBranch) return;
    
    setIsCloning(true);
    setError(null);
    
    try {
      // Clone the repo and add to Bob
      await api.cloneGitHubRepo(selectedRepo.nameWithOwner, selectedBranch);
      onSelect(selectedRepo.nameWithOwner, selectedBranch, selectedAgent);
    } catch (err: any) {
      setError(err.message || 'Failed to clone repository');
      setIsCloning(false);
    }
  }, [selectedRepo, selectedBranch, selectedAgent, onSelect]);

  if (loading) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}>
        <div style={{
          backgroundColor: '#1e1e1e',
          padding: '40px',
          borderRadius: '8px',
          color: '#888'
        }}>
          Loading your GitHub repositories...
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        width: '600px',
        maxHeight: '80vh',
        backgroundColor: '#1e1e1e',
        borderRadius: '8px',
        border: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
          borderBottom: '1px solid #333',
          backgroundColor: '#252526'
        }}>
          <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '16px' }}>
            Add GitHub Repository
          </span>
          <button
            onClick={onCancel}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0 8px',
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px', flex: 1, overflow: 'auto' }}>
          {error && (
            <div style={{
              backgroundColor: '#5c1a1a',
              color: '#ff6b6b',
              padding: '12px',
              borderRadius: '4px',
              marginBottom: '16px',
              fontSize: '13px'
            }}>
              {error}
            </div>
          )}

          {/* Repository Search/Select */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', color: '#888', fontSize: '12px', marginBottom: '6px' }}>
              Repository
            </label>
            <input
              type="text"
              placeholder="Search your repositories..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: '#2d2d2d',
                border: '1px solid #404040',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '14px',
                marginBottom: '8px',
                boxSizing: 'border-box'
              }}
            />
            
            <div style={{
              maxHeight: '200px',
              overflowY: 'auto',
              border: '1px solid #404040',
              borderRadius: '4px',
              backgroundColor: '#2d2d2d'
            }}>
              {filteredRepos.length === 0 ? (
                <div style={{ padding: '16px', color: '#666', textAlign: 'center' }}>
                  No repositories found
                </div>
              ) : (
                filteredRepos.map(repo => (
                  <div
                    key={repo.nameWithOwner}
                    onClick={() => setSelectedRepo(repo)}
                    style={{
                      padding: '10px 12px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #333',
                      backgroundColor: selectedRepo?.nameWithOwner === repo.nameWithOwner ? '#094771' : 'transparent',
                      transition: 'background-color 0.1s'
                    }}
                    onMouseEnter={(e) => {
                      if (selectedRepo?.nameWithOwner !== repo.nameWithOwner) {
                        e.currentTarget.style.backgroundColor = '#383838';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedRepo?.nameWithOwner !== repo.nameWithOwner) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: '#fff', fontSize: '14px' }}>{repo.nameWithOwner}</span>
                      {repo.isPrivate && (
                        <span style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          backgroundColor: '#444',
                          borderRadius: '3px',
                          color: '#888'
                        }}>
                          private
                        </span>
                      )}
                    </div>
                    {repo.description && (
                      <div style={{ color: '#888', fontSize: '12px', marginTop: '4px' }}>
                        {repo.description}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Branch Select */}
          {selectedRepo && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', color: '#888', fontSize: '12px', marginBottom: '6px' }}>
                Branch
              </label>
              {loadingBranches ? (
                <div style={{ color: '#666', padding: '10px' }}>Loading branches...</div>
              ) : (
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: '#2d2d2d',
                    border: '1px solid #404040',
                    borderRadius: '4px',
                    color: '#fff',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                >
                  {branches.map(branch => (
                    <option key={branch} value={branch}>{branch}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Agent Select */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', color: '#888', fontSize: '12px', marginBottom: '6px' }}>
              AI Agent
            </label>
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value as AgentType)}
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: '#2d2d2d',
                border: '1px solid #404040',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            >
              {agents.map(agent => (
                <option key={agent.type} value={agent.type}>
                  {agent.name} {agent.isAuthenticated === false ? '(not authenticated)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '12px',
          padding: '16px 20px',
          borderTop: '1px solid #333',
          backgroundColor: '#252526'
        }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              backgroundColor: 'transparent',
              color: '#888',
              border: '1px solid #444',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedRepo || !selectedBranch || isCloning}
            style={{
              padding: '8px 16px',
              backgroundColor: selectedRepo && selectedBranch && !isCloning ? '#238636' : '#333',
              color: selectedRepo && selectedBranch && !isCloning ? '#fff' : '#666',
              border: 'none',
              borderRadius: '4px',
              cursor: selectedRepo && selectedBranch && !isCloning ? 'pointer' : 'not-allowed',
              fontSize: '13px'
            }}
          >
            {isCloning ? 'Cloning...' : 'Add Repository'}
          </button>
        </div>
      </div>
    </div>
  );
};
