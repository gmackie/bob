import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { Worktree } from '../types';
import { UnifiedDiffView } from './AgentPanel';

interface GitFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'unmodified';
  staged: boolean;
  hasStaged: boolean;
  hasUnstaged: boolean;
}

interface GitPanelProps {
  selectedWorktree: Worktree;
}

export const GitPanel: React.FC<GitPanelProps> = ({ selectedWorktree }) => {
  const [files, setFiles] = useState<GitFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<GitFile | null>(null);
  const [fileDiff, setFileDiff] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [showCommitForm, setShowCommitForm] = useState(false);
  const [useAmend, setUseAmend] = useState(false);

  // Load file list
  const loadFiles = async () => {
    if (!selectedWorktree) return;

    setLoading(true);
    try {
      const result = await api.getGitFiles(selectedWorktree.id);
      setFiles(result.files);

      // If a file is selected, reload its diff
      if (selectedFile) {
        const updatedFile = result.files.find(f => f.path === selectedFile.path);
        if (updatedFile) {
          setSelectedFile(updatedFile);
          await loadFileDiff(updatedFile.path);
        } else {
          // File no longer exists, clear selection
          setSelectedFile(null);
          setFileDiff('');
        }
      }
    } catch (error) {
      console.error('Failed to load files:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load diff for a specific file
  const loadFileDiff = async (filePath: string) => {
    if (!selectedWorktree) return;

    try {
      const diff = await api.getFileDiff(selectedWorktree.id, filePath);
      setFileDiff(diff);
    } catch (error) {
      console.error('Failed to load file diff:', error);
      setFileDiff('');
    }
  };

  // Handle file selection
  const handleFileClick = (file: GitFile) => {
    setSelectedFile(file);
    loadFileDiff(file.path);
  };

  // Stage a file
  const handleStageFile = async (e: React.MouseEvent, file: GitFile) => {
    e.stopPropagation();
    try {
      await api.stageFile(selectedWorktree.id, file.path);
      await loadFiles();
    } catch (error) {
      console.error('Failed to stage file:', error);
    }
  };

  // Unstage a file
  const handleUnstageFile = async (e: React.MouseEvent, file: GitFile) => {
    e.stopPropagation();
    try {
      await api.unstageFile(selectedWorktree.id, file.path);
      await loadFiles();
    } catch (error) {
      console.error('Failed to unstage file:', error);
    }
  };

  // Revert a file
  const handleRevertFile = async (e: React.MouseEvent, file: GitFile) => {
    e.stopPropagation();

    if (!confirm(`Are you sure you want to revert all changes to ${file.path}? This cannot be undone.`)) {
      return;
    }

    try {
      await api.revertFile(selectedWorktree.id, file.path);
      await loadFiles();

      // Clear selection if this was the selected file
      if (selectedFile?.path === file.path) {
        setSelectedFile(null);
        setFileDiff('');
      }
    } catch (error) {
      console.error('Failed to revert file:', error);
    }
  };

  // Commit changes
  const handleCommit = async () => {
    if (!commitMessage.trim() && !useAmend) {
      alert('Please enter a commit message');
      return;
    }

    setIsCommitting(true);
    try {
      if (useAmend) {
        await api.commitAmend(selectedWorktree.id);
      } else {
        await api.commitChanges(selectedWorktree.id, commitMessage);
      }

      setCommitMessage('');
      setShowCommitForm(false);
      setUseAmend(false);
      await loadFiles();
      setSelectedFile(null);
      setFileDiff('');
    } catch (error: any) {
      console.error('Failed to commit:', error);
      alert(`Commit failed: ${error.message}`);
    } finally {
      setIsCommitting(false);
    }
  };

  // Load files when worktree changes
  useEffect(() => {
    loadFiles();
  }, [selectedWorktree?.id]);

  // Get status icon and color
  const getStatusDisplay = (file: GitFile) => {
    switch (file.status) {
      case 'added':
        return { icon: 'A', color: '#3fb950', label: 'Added' };
      case 'modified':
        return { icon: 'M', color: '#f59e0b', label: 'Modified' };
      case 'deleted':
        return { icon: 'D', color: '#f85149', label: 'Deleted' };
      case 'renamed':
        return { icon: 'R', color: '#58a6ff', label: 'Renamed' };
      case 'untracked':
        return { icon: 'U', color: '#8b949e', label: 'Untracked' };
      default:
        return { icon: '?', color: '#8b949e', label: 'Unknown' };
    }
  };

  const stagedFiles = files.filter(f => f.staged || f.hasStaged);
  const unstagedFiles = files.filter(f => !f.staged || f.hasUnstaged);

  return (
    <div style={{
      display: 'flex',
      height: '100%',
      overflow: 'hidden'
    }}>
      {/* Left Panel - File Tree */}
      <div style={{
        width: '320px',
        borderRight: '1px solid #30363d',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '12px',
          borderBottom: '1px solid #30363d',
          backgroundColor: '#0d1117'
        }}>
          <h4 style={{ color: '#e6edf3', margin: 0, marginBottom: '8px', fontSize: '14px' }}>
            Changes
          </h4>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowCommitForm(!showCommitForm)}
              disabled={files.length === 0}
              style={{
                flex: 1,
                backgroundColor: '#238636',
                border: 'none',
                color: '#fff',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: files.length === 0 ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                opacity: files.length === 0 ? 0.5 : 1
              }}
            >
              {showCommitForm ? 'Hide' : 'Commit'}
            </button>
            <button
              onClick={loadFiles}
              disabled={loading}
              style={{
                backgroundColor: '#21262d',
                border: '1px solid #30363d',
                color: '#e6edf3',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '12px'
              }}
            >
              {loading ? '↻' : '⟳'}
            </button>
          </div>
        </div>

        {/* Commit Form */}
        {showCommitForm && (
          <div style={{
            padding: '12px',
            borderBottom: '1px solid #30363d',
            backgroundColor: '#161b22'
          }}>
            <div style={{ marginBottom: '8px' }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: '#8b949e',
                fontSize: '12px',
                marginBottom: '6px',
                cursor: 'pointer'
              }}>
                <input
                  type="checkbox"
                  checked={useAmend}
                  onChange={(e) => setUseAmend(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                Amend last commit
              </label>
            </div>

            {!useAmend && (
              <textarea
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Commit message..."
                style={{
                  width: '100%',
                  minHeight: '60px',
                  backgroundColor: '#0d1117',
                  border: '1px solid #30363d',
                  borderRadius: '4px',
                  color: '#e6edf3',
                  padding: '8px',
                  fontSize: '12px',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  marginBottom: '8px'
                }}
              />
            )}

            <button
              onClick={handleCommit}
              disabled={isCommitting || (!useAmend && !commitMessage.trim())}
              style={{
                width: '100%',
                backgroundColor: '#238636',
                border: 'none',
                color: '#fff',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: (isCommitting || (!useAmend && !commitMessage.trim())) ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                opacity: (isCommitting || (!useAmend && !commitMessage.trim())) ? 0.6 : 1
              }}
            >
              {isCommitting ? 'Committing...' : (useAmend ? 'Amend Commit' : 'Commit Changes')}
            </button>
          </div>
        )}

        {/* File List */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '8px'
        }}>
          {loading && files.length === 0 ? (
            <div style={{ color: '#8b949e', fontSize: '12px', padding: '12px', textAlign: 'center' }}>
              Loading changes...
            </div>
          ) : files.length === 0 ? (
            <div style={{ color: '#8b949e', fontSize: '12px', padding: '12px', textAlign: 'center' }}>
              No changes
            </div>
          ) : (
            <>
              {/* Staged Files */}
              {stagedFiles.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{
                    color: '#8b949e',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    marginBottom: '6px',
                    padding: '0 4px'
                  }}>
                    Staged ({stagedFiles.length})
                  </div>
                  {stagedFiles.map(file => {
                    const { icon, color, label } = getStatusDisplay(file);
                    const isSelected = selectedFile?.path === file.path;

                    return (
                      <div
                        key={file.path}
                        onClick={() => handleFileClick(file)}
                        style={{
                          padding: '6px 8px',
                          backgroundColor: isSelected ? '#21262d' : 'transparent',
                          border: `1px solid ${isSelected ? '#58a6ff' : 'transparent'}`,
                          borderRadius: '4px',
                          cursor: 'pointer',
                          marginBottom: '2px',
                          fontSize: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) e.currentTarget.style.backgroundColor = '#161b22';
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <span style={{
                          fontWeight: 'bold',
                          color,
                          fontSize: '10px',
                          width: '14px',
                          textAlign: 'center'
                        }}>
                          {icon}
                        </span>
                        <span style={{
                          flex: 1,
                          color: '#e6edf3',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }} title={file.path}>
                          {file.path}
                        </span>
                        <button
                          onClick={(e) => handleUnstageFile(e, file)}
                          style={{
                            backgroundColor: 'transparent',
                            border: '1px solid #30363d',
                            color: '#8b949e',
                            padding: '2px 6px',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '10px'
                          }}
                          title="Unstage file"
                        >
                          −
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Unstaged Files */}
              {unstagedFiles.length > 0 && (
                <div>
                  <div style={{
                    color: '#8b949e',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    marginBottom: '6px',
                    padding: '0 4px'
                  }}>
                    Changes ({unstagedFiles.length})
                  </div>
                  {unstagedFiles.map(file => {
                    const { icon, color, label } = getStatusDisplay(file);
                    const isSelected = selectedFile?.path === file.path;

                    return (
                      <div
                        key={file.path}
                        onClick={() => handleFileClick(file)}
                        style={{
                          padding: '6px 8px',
                          backgroundColor: isSelected ? '#21262d' : 'transparent',
                          border: `1px solid ${isSelected ? '#58a6ff' : 'transparent'}`,
                          borderRadius: '4px',
                          cursor: 'pointer',
                          marginBottom: '2px',
                          fontSize: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) e.currentTarget.style.backgroundColor = '#161b22';
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <span style={{
                          fontWeight: 'bold',
                          color,
                          fontSize: '10px',
                          width: '14px',
                          textAlign: 'center'
                        }}>
                          {icon}
                        </span>
                        <span style={{
                          flex: 1,
                          color: '#e6edf3',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }} title={file.path}>
                          {file.path}
                        </span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {!file.staged && (
                            <button
                              onClick={(e) => handleStageFile(e, file)}
                              style={{
                                backgroundColor: 'transparent',
                                border: '1px solid #30363d',
                                color: '#8b949e',
                                padding: '2px 6px',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '10px'
                              }}
                              title="Stage file"
                            >
                              +
                            </button>
                          )}
                          <button
                            onClick={(e) => handleRevertFile(e, file)}
                            style={{
                              backgroundColor: 'transparent',
                              border: '1px solid #30363d',
                              color: '#f85149',
                              padding: '2px 6px',
                              borderRadius: '3px',
                              cursor: 'pointer',
                              fontSize: '10px'
                            }}
                            title="Discard changes"
                          >
                            ↺
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right Panel - Diff Viewer */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {selectedFile ? (
          <>
            {/* File Header */}
            <div style={{
              padding: '12px',
              borderBottom: '1px solid #30363d',
              backgroundColor: '#0d1117',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#e6edf3', fontSize: '14px', fontWeight: 'bold', marginBottom: '4px' }}>
                  {selectedFile.path}
                </div>
                <div style={{ color: '#8b949e', fontSize: '11px' }}>
                  {getStatusDisplay(selectedFile).label} • {selectedFile.staged ? 'Staged' : 'Not staged'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {selectedFile.staged ? (
                  <button
                    onClick={(e) => handleUnstageFile(e, selectedFile)}
                    style={{
                      backgroundColor: '#21262d',
                      border: '1px solid #30363d',
                      color: '#e6edf3',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Unstage
                  </button>
                ) : (
                  <button
                    onClick={(e) => handleStageFile(e, selectedFile)}
                    style={{
                      backgroundColor: '#238636',
                      border: 'none',
                      color: '#fff',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Stage File
                  </button>
                )}
                <button
                  onClick={(e) => handleRevertFile(e, selectedFile)}
                  style={{
                    backgroundColor: '#21262d',
                    border: '1px solid #f85149',
                    color: '#f85149',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  Discard Changes
                </button>
              </div>
            </div>

            {/* Diff Content */}
            <div style={{
              flex: 1,
              overflow: 'auto',
              padding: '16px'
            }}>
              {fileDiff ? (
                <UnifiedDiffView
                  gitDiff={fileDiff}
                  comments={[]}
                  onAddComment={() => {}}
                  onReplyToComment={() => {}}
                  onDismissComment={() => {}}
                />
              ) : (
                <div style={{ color: '#8b949e', textAlign: 'center', padding: '40px' }}>
                  Loading diff...
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            color: '#8b949e'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>📄</div>
            <div style={{ fontSize: '14px' }}>
              {files.length === 0 ? 'No changes to display' : 'Select a file to view diff'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
