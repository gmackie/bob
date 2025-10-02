import React from 'react';
import { Repository } from '../types';

interface RepositoryDashboardPanelProps {
  repository: Repository;
  isLeftPanelCollapsed: boolean;
}

export const RepositoryDashboardPanel: React.FC<RepositoryDashboardPanelProps> = ({
  repository,
  isLeftPanelCollapsed
}) => {
  // Suppress TypeScript warning for unused parameter
  void isLeftPanelCollapsed;

  return (
    <div className="right-panel">
      <div className="panel-header">
        <div>
          <h3 style={{ margin: 0, color: '#ffffff' }}>
            Repository Dashboard
          </h3>
          <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
            {repository.name} • {repository.path}
          </div>
        </div>
      </div>

      <div className="terminal-content" style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: '24px',
        overflow: 'auto'
      }}>
        {/* Repository Stats */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '16px',
          marginBottom: '24px'
        }}>
          <div style={{
            backgroundColor: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '8px',
            padding: '20px'
          }}>
            <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>MAIN BRANCH</div>
            <div style={{ color: '#58a6ff', fontSize: '20px', fontWeight: 'bold' }}>
              {repository.mainBranch}
            </div>
          </div>

          <div style={{
            backgroundColor: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '8px',
            padding: '20px'
          }}>
            <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>CURRENT BRANCH</div>
            <div style={{ color: '#3fb950', fontSize: '20px', fontWeight: 'bold' }}>
              {repository.branch}
            </div>
          </div>

          <div style={{
            backgroundColor: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '8px',
            padding: '20px'
          }}>
            <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>WORKTREES</div>
            <div style={{ color: '#d2a8ff', fontSize: '20px', fontWeight: 'bold' }}>
              {repository.worktrees.length}
            </div>
          </div>
        </div>

        {/* Repository Info */}
        <div style={{
          backgroundColor: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '8px',
          padding: '24px',
          marginBottom: '16px'
        }}>
          <h4 style={{ color: '#fff', marginTop: 0 }}>Repository Information</h4>
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#888' }}>Repository ID:</span>
              <span style={{ color: '#fff', fontFamily: 'monospace', fontSize: '12px' }}>{repository.id}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#888' }}>Path:</span>
              <span style={{ color: '#fff', fontFamily: 'monospace', fontSize: '12px', textAlign: 'right', wordBreak: 'break-all' }}>
                {repository.path}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#888' }}>Main Branch:</span>
              <span style={{ color: '#58a6ff', fontWeight: 'bold' }}>{repository.mainBranch}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#888' }}>Current Branch:</span>
              <span style={{ color: '#3fb950', fontWeight: 'bold' }}>{repository.branch}</span>
            </div>
          </div>
        </div>

        {/* Active Worktrees */}
        <div style={{
          backgroundColor: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '8px',
          padding: '24px'
        }}>
          <h4 style={{ color: '#fff', marginTop: 0, marginBottom: '16px' }}>
            Active Worktrees ({repository.worktrees.length})
          </h4>
          {repository.worktrees.length === 0 ? (
            <div style={{
              textAlign: 'center',
              color: '#666',
              padding: '40px 20px'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>🌳</div>
              <p style={{ margin: 0 }}>No worktrees created yet</p>
              <p style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>
                Create a worktree from the repository panel to get started
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '12px' }}>
              {repository.worktrees.map(worktree => (
                <div
                  key={worktree.id}
                  style={{
                    backgroundColor: '#0d1117',
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{
                      color: '#58a6ff',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      marginBottom: '4px'
                    }}>
                      {worktree.branch.replace(/^refs\/heads\//, '')}
                    </div>
                    <div style={{
                      color: '#8b949e',
                      fontSize: '12px',
                      fontFamily: 'monospace'
                    }}>
                      {worktree.path}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const url = new URL(window.location.href);
                      url.searchParams.set('worktree', worktree.id);
                      window.location.href = url.toString();
                    }}
                    style={{
                      backgroundColor: '#238636',
                      border: 'none',
                      color: '#fff',
                      padding: '8px 16px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}
                  >
                    Open →
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
