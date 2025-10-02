import React, { useState, useEffect, useRef } from 'react';
import { ClaudeInstance, Worktree, AgentType, AgentInfo } from '../types';
import { TerminalComponent } from './Terminal';
import { api } from '../api';
import { sessionCache } from '../services/SessionCache';

interface AgentPanelProps {
  selectedWorktree: Worktree | null;
  selectedInstance: ClaudeInstance | null;
  onCreateTerminalSession: (instanceId: string) => Promise<string>;
  onCreateDirectoryTerminalSession: (instanceId: string) => Promise<string>;
  onCloseTerminalSession: (sessionId: string) => void;
  onRestartInstance: (instanceId: string) => Promise<void>;
  onStopInstance: (instanceId: string) => Promise<void>;
  onDeleteWorktree: (worktreeId: string, force: boolean) => Promise<void>;
  error: string | null;
  isLeftPanelCollapsed: boolean;
}

// Comment types
interface DiffComment {
  id: string;
  file: string;
  line: number;
  type: 'suggestion' | 'warning' | 'error' | 'user';
  message: string;
  severity: 'low' | 'medium' | 'high';
  isAI?: boolean;
  userReply?: string;
  isDismissed?: boolean;
}

// Inline comment component
const InlineComment: React.FC<{
  comment: DiffComment;
  onReply?: (commentId: string, reply: string) => void;
  onDismiss?: (commentId: string) => void;
}> = ({ comment, onReply, onDismiss }) => {
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState(comment.userReply || '');

  const getIconAndColor = () => {
    switch (comment.type) {
      case 'error':
        return { icon: '❌', color: '#f85149', bgColor: '#67060c1a' };
      case 'warning':
        return { icon: '⚠️', color: '#f59e0b', bgColor: '#92400e1a' };
      case 'suggestion':
        return { icon: '💡', color: '#58a6ff', bgColor: '#0969da1a' };
      case 'user':
        return { icon: '💬', color: '#d2a8ff', bgColor: '#6f42c11a' };
      default:
        return { icon: '📝', color: '#8b949e', bgColor: '#21262d' };
    }
  };

  const { icon, color, bgColor } = getIconAndColor();

  return (
    <div style={{
      backgroundColor: bgColor,
      border: `1px solid ${color}33`,
      borderRadius: '6px',
      margin: '4px 0',
      padding: '8px',
      fontSize: '12px'
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <span style={{ fontSize: '14px' }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ color, fontWeight: 'bold', textTransform: 'capitalize' }}>
              {comment.type} {comment.isAI && '(AI)'}
            </span>
            <span style={{ color: '#8b949e', fontSize: '10px' }}>
              Line {comment.line}
            </span>
            {comment.severity && (
              <span style={{
                backgroundColor: comment.severity === 'high' ? '#f85149' :
                                comment.severity === 'medium' ? '#f59e0b' : '#3fb950',
                color: '#fff',
                padding: '2px 6px',
                borderRadius: '10px',
                fontSize: '10px',
                fontWeight: 'bold'
              }}>
                {comment.severity}
              </span>
            )}
          </div>
          <div style={{ color: '#e6edf3', lineHeight: '1.4', marginBottom: '8px' }}>
            {comment.message}
          </div>

          {comment.userReply && (
            <div style={{
              backgroundColor: '#21262d',
              border: '1px solid #30363d',
              borderRadius: '4px',
              padding: '6px',
              marginBottom: '8px'
            }}>
              <div style={{ color: '#8b949e', fontSize: '10px', marginBottom: '2px' }}>Your reply:</div>
              <div style={{ color: '#e6edf3', fontSize: '11px' }}>{comment.userReply}</div>
            </div>
          )}

          {showReply && (
            <div style={{ marginTop: '8px' }}>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Add your reply or additional context..."
                style={{
                  width: '100%',
                  minHeight: '60px',
                  backgroundColor: '#21262d',
                  border: '1px solid #30363d',
                  borderRadius: '4px',
                  color: '#e6edf3',
                  padding: '6px',
                  fontSize: '11px',
                  resize: 'vertical'
                }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <button
                  onClick={() => {
                    if (onReply && replyText.trim()) {
                      onReply(comment.id, replyText.trim());
                      setShowReply(false);
                    }
                  }}
                  style={{
                    backgroundColor: '#238636',
                    border: 'none',
                    color: '#fff',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  Save Reply
                </button>
                <button
                  onClick={() => setShowReply(false)}
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid #30363d',
                    color: '#8b949e',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            {!showReply && (
              <button
                onClick={() => setShowReply(true)}
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid #30363d',
                  color: '#8b949e',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                Reply
              </button>
            )}
            {onDismiss && (
              <button
                onClick={() => onDismiss(comment.id)}
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid #30363d',
                  color: '#8b949e',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Enhanced unified diff view component with comments
const UnifiedDiffView: React.FC<{
  gitDiff: string;
  comments?: DiffComment[];
  onAddComment?: (file: string, line: number, message: string) => void;
  onReplyToComment?: (commentId: string, reply: string) => void;
  onDismissComment?: (commentId: string) => void;
}> = ({ gitDiff, comments = [], onAddComment, onReplyToComment, onDismissComment }) => {
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const [showAddComment, setShowAddComment] = useState<{ file: string; line: number } | null>(null);
  const [newCommentText, setNewCommentText] = useState('');

  const parseLineNumber = (line: string): number | null => {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      return match ? parseInt(match[1]) : null;
    }
    return null;
  };

  const getActualLineNumber = (lineIndex: number, lines: string[]): number | null => {
    let currentLineNumber = 1;

    for (let i = 0; i <= lineIndex; i++) {
      const line = lines[i];
      if (line.startsWith('@@')) {
        const newLineNumber = parseLineNumber(line);
        if (newLineNumber) currentLineNumber = newLineNumber;
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        if (i === lineIndex) return currentLineNumber;
        currentLineNumber++;
      } else if (!line.startsWith('-') && !line.startsWith('+++') && !line.startsWith('---') &&
                 !line.startsWith('new file') && !line.startsWith('index') && !line.startsWith('diff --git')) {
        if (i === lineIndex) return currentLineNumber;
        currentLineNumber++;
      }
    }
    return null;
  };

  const lines = gitDiff.split('\n');

  // Pre-process lines to avoid state updates during render
  const processedLines = React.useMemo(() => {
    let currentFile = '';
    return lines.map((line, index) => {
      if (line.startsWith('diff --git')) {
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match) {
          currentFile = match[2];
        }
      }
      return {
        line,
        index,
        currentFile,
        actualLineNumber: getActualLineNumber(index, lines)
      };
    });
  }, [gitDiff]);

  return (
    <div style={{
      background: '#0d1117',
      border: '1px solid #30363d',
      borderRadius: '6px',
      overflow: 'hidden',
      fontSize: '12px',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
    }}>
      {processedLines.map(({ line, index, currentFile, actualLineNumber }) => {
        let lineStyle: React.CSSProperties = {
          padding: '0 8px',
          margin: 0,
          minHeight: '20px',
          lineHeight: '20px',
          whiteSpace: 'pre',
          position: 'relative'
        };

        const lineComments = comments.filter(c =>
          c.file === currentFile && c.line === actualLineNumber
        );

        if (line.startsWith('diff --git')) {
          lineStyle = {
            ...lineStyle,
            backgroundColor: '#21262d',
            color: '#f0f6fc',
            fontWeight: 'bold',
            borderBottom: '1px solid #30363d'
          };
        } else if (line.startsWith('@@')) {
          lineStyle = {
            ...lineStyle,
            backgroundColor: '#0969da1a',
            color: '#58a6ff'
          };
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          lineStyle = {
            ...lineStyle,
            backgroundColor: '#0361491a',
            color: '#3fb950'
          };
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          lineStyle = {
            ...lineStyle,
            backgroundColor: '#67060c1a',
            color: '#f85149'
          };
        } else if (line.startsWith('+++') || line.startsWith('---')) {
          lineStyle = {
            ...lineStyle,
            color: '#8b949e',
            fontWeight: 'bold'
          };
        } else if (line.startsWith('new file mode') || line.startsWith('index')) {
          lineStyle = {
            ...lineStyle,
            color: '#8b949e'
          };
        } else {
          lineStyle = {
            ...lineStyle,
            color: '#e6edf3'
          };
        }

        return (
          <div key={index}>
            <div
              style={{
                ...lineStyle,
                display: 'flex',
                alignItems: 'center'
              }}
              onMouseEnter={() => setHoveredLine(index)}
              onMouseLeave={() => setHoveredLine(null)}
            >
              <span style={{ flex: 1 }}>{line || ' '}</span>

              {/* Add comment button for relevant lines */}
              {actualLineNumber && currentFile && onAddComment &&
               (line.startsWith('+') || (!line.startsWith('-') && !line.startsWith('@@'))) &&
               hoveredLine === index && (
                <button
                  onClick={() => setShowAddComment({ file: currentFile, line: actualLineNumber })}
                  style={{
                    backgroundColor: '#238636',
                    border: 'none',
                    color: '#fff',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    cursor: 'pointer',
                    marginLeft: '8px'
                  }}
                >
                  💬
                </button>
              )}
            </div>

            {/* Show add comment form */}
            {showAddComment && showAddComment.file === currentFile &&
             showAddComment.line === actualLineNumber && (
              <div style={{
                backgroundColor: '#21262d',
                border: '1px solid #30363d',
                borderRadius: '6px',
                margin: '4px 8px',
                padding: '8px'
              }}>
                <textarea
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  placeholder="Add your comment about this line..."
                  style={{
                    width: '100%',
                    minHeight: '60px',
                    backgroundColor: '#0d1117',
                    border: '1px solid #30363d',
                    borderRadius: '4px',
                    color: '#e6edf3',
                    padding: '6px',
                    fontSize: '11px',
                    resize: 'vertical'
                  }}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                  <button
                    onClick={() => {
                      if (onAddComment && newCommentText.trim()) {
                        onAddComment(showAddComment.file, showAddComment.line, newCommentText.trim());
                        setNewCommentText('');
                        setShowAddComment(null);
                      }
                    }}
                    style={{
                      backgroundColor: '#238636',
                      border: 'none',
                      color: '#fff',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      cursor: 'pointer'
                    }}
                  >
                    Add Comment
                  </button>
                  <button
                    onClick={() => {
                      setShowAddComment(null);
                      setNewCommentText('');
                    }}
                    style={{
                      backgroundColor: 'transparent',
                      border: '1px solid #30363d',
                      color: '#8b949e',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Show comments for this line */}
            {lineComments.length > 0 && (
              <div style={{ margin: '0 8px' }}>
                {lineComments.map(comment => (
                  <InlineComment
                    key={comment.id}
                    comment={comment}
                    onReply={onReplyToComment}
                    onDismiss={onDismissComment}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// Split diff view component
const SplitDiffView: React.FC<{ gitDiff: string }> = ({ gitDiff }) => {
  const parsedDiff = parseDiffForSplitView(gitDiff);

  return (
    <div style={{
      background: '#0d1117',
      border: '1px solid #30363d',
      borderRadius: '6px',
      overflow: 'hidden',
      fontSize: '12px',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
    }}>
      {parsedDiff.map((file, fileIndex) => (
        <div key={fileIndex}>
          {/* File header */}
          <div style={{
            backgroundColor: '#21262d',
            color: '#f0f6fc',
            fontWeight: 'bold',
            padding: '8px',
            borderBottom: '1px solid #30363d'
          }}>
            {file.fileName}
          </div>

          {/* Split view table */}
          <div style={{ display: 'flex', width: '100%' }}>
            {/* Left side (old/removed) */}
            <div style={{ flex: 1, borderRight: '1px solid #30363d' }}>
              {file.chunks.map((chunk, chunkIndex) => (
                <div key={`left-${chunkIndex}`}>
                  {chunk.oldLines.map((line, lineIndex) => (
                    <div key={lineIndex} style={{
                      padding: '0 8px',
                      minHeight: '20px',
                      lineHeight: '20px',
                      backgroundColor: line.type === 'removed' ? '#67060c1a' : 'transparent',
                      color: line.type === 'removed' ? '#f85149' : '#8b949e'
                    }}>
                      {line.content || ' '}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Right side (new/added) */}
            <div style={{ flex: 1 }}>
              {file.chunks.map((chunk, chunkIndex) => (
                <div key={`right-${chunkIndex}`}>
                  {chunk.newLines.map((line, lineIndex) => (
                    <div key={lineIndex} style={{
                      padding: '0 8px',
                      minHeight: '20px',
                      lineHeight: '20px',
                      backgroundColor: line.type === 'added' ? '#0361491a' : 'transparent',
                      color: line.type === 'added' ? '#3fb950' : '#8b949e'
                    }}>
                      {line.content || ' '}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// Helper function to parse diff for split view
const parseDiffForSplitView = (gitDiff: string) => {
  const lines = gitDiff.split('\n');
  const files: Array<{
    fileName: string;
    chunks: Array<{
      oldLines: Array<{ content: string; type: 'context' | 'removed' | 'empty' }>;
      newLines: Array<{ content: string; type: 'context' | 'added' | 'empty' }>;
    }>;
  }> = [];

  let currentFile: typeof files[0] | null = null;
  let currentChunk: typeof files[0]['chunks'][0] | null = null;

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      // Start new file
      const fileName = line.split(' b/')[1] || line.split(' ')[3];
      currentFile = { fileName, chunks: [] };
      files.push(currentFile);
    } else if (line.startsWith('@@') && currentFile) {
      // Start new chunk
      currentChunk = { oldLines: [], newLines: [] };
      currentFile.chunks.push(currentChunk);
    } else if (currentChunk && currentFile) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        // Added line - only in new/right side
        currentChunk.oldLines.push({ content: '', type: 'empty' });
        currentChunk.newLines.push({ content: line.slice(1), type: 'added' });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // Removed line - only in old/left side
        currentChunk.oldLines.push({ content: line.slice(1), type: 'removed' });
        currentChunk.newLines.push({ content: '', type: 'empty' });
      } else if (!line.startsWith('+++') && !line.startsWith('---') && !line.startsWith('new file') && !line.startsWith('index')) {
        // Context line - in both sides
        const content = line.startsWith(' ') ? line.slice(1) : line;
        if (content.trim()) {
          currentChunk.oldLines.push({ content, type: 'context' });
          currentChunk.newLines.push({ content, type: 'context' });
        }
      }
    }
  }

  return files;
};

// System Status Dashboard Component
const SystemStatusDashboard: React.FC = () => {
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    const loadSystemStatus = async () => {
      try {
        if (!loading) setIsUpdating(true);
        const status = await api.getSystemStatus();
        setSystemStatus(status);
      } catch (error) {
        console.error('Failed to load system status:', error);
      } finally {
        setLoading(false);
        setIsUpdating(false);
      }
    };

    loadSystemStatus();
    const interval = setInterval(loadSystemStatus, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#888'
      }}>
        Loading system status...
      </div>
    );
  }

  if (!systemStatus) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#888'
      }}>
        Failed to load system status
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return '#3fb950';
      case 'not_authenticated': return '#f59e0b';
      case 'not_available': return '#f85149';
      default: return '#8b949e';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'available': return '✅';
      case 'not_authenticated': return '⚠️';
      case 'not_available': return '❌';
      default: return '❓';
    }
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatMemory = (bytes: number) => {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div style={{
      flex: 1,
      padding: '24px',
      overflow: 'auto'
    }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <h2 style={{ color: '#fff', margin: 0, fontSize: '24px' }}>System Status</h2>
          {isUpdating && (
            <div style={{
              width: '8px',
              height: '8px',
              backgroundColor: '#3fb950',
              borderRadius: '50%',
              animation: 'pulse 1.5s ease-in-out infinite'
            }} />
          )}
        </div>
        <p style={{ color: '#888', margin: 0, fontSize: '14px' }}>
          Monitor Bob system health and dependency status • Updates every 10 seconds
        </p>
      </div>

      <style>{`
        @keyframes pulse {
          0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.7);
          }
          70% {
            transform: scale(1);
            box-shadow: 0 0 0 10px rgba(63, 185, 80, 0);
          }
          100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(63, 185, 80, 0);
          }
        }
      `}</style>

      {/* System Dependencies */}
      <div style={{
        backgroundColor: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: '8px',
        padding: '24px',
        marginBottom: '24px'
      }}>
        <h3 style={{ color: '#fff', margin: 0, marginBottom: '20px', fontSize: '18px' }}>System Dependencies</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Agents Status */}
          {(systemStatus.agents && Array.isArray(systemStatus.agents) ? systemStatus.agents : [])
            .map((agent: any, idx: number) => {
              const status = !agent.isAvailable
                ? 'not_available'
                : agent.isAuthenticated === false
                ? 'not_authenticated'
                : 'available';
              return (
                <div key={agent.type || idx} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '16px',
                  backgroundColor: '#0d1117',
                  borderRadius: '6px',
                  border: '1px solid #21262d'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '20px' }}>{getStatusIcon(status)}</span>
                    <div>
                      <div style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>{agent.name}</div>
                      <div style={{ color: '#888', fontSize: '12px' }}>
                        {status === 'available' ? 'Ready for AI-powered features' : (agent.statusMessage || 'Unavailable')}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      color: getStatusColor(status),
                      fontSize: '12px',
                      fontWeight: 'bold',
                      marginBottom: '2px'
                    }}>
                      {String(status).replace('_', ' ').toUpperCase()}
                    </div>
                    {agent.version && (
                      <div style={{ color: '#666', fontSize: '10px' }}>
                        {agent.version}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

          {/* Fallback Claude status if agents array not present */}
          {(!systemStatus.agents || !Array.isArray(systemStatus.agents)) && systemStatus.claude && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px',
              backgroundColor: '#0d1117',
              borderRadius: '6px',
              border: '1px solid #21262d'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '20px' }}>{getStatusIcon(systemStatus.claude.status)}</span>
                <div>
                  <div style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>Claude CLI</div>
                  <div style={{ color: '#888', fontSize: '12px' }}>
                    {systemStatus.claude.status === 'available' ? 'Ready for AI-powered features' : 'Required for git analysis and PR generation'}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  color: getStatusColor(systemStatus.claude.status),
                  fontSize: '12px',
                  fontWeight: 'bold',
                  marginBottom: '2px'
                }}>
                  {systemStatus.claude.status.replace('_', ' ').toUpperCase()}
                </div>
                {systemStatus.claude.version && (
                  <div style={{ color: '#666', fontSize: '10px' }}>
                    {systemStatus.claude.version}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* GitHub CLI Status */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px',
            backgroundColor: '#0d1117',
            borderRadius: '6px',
            border: '1px solid #21262d'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '20px' }}>{getStatusIcon(systemStatus.github.status)}</span>
              <div>
                <div style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>GitHub CLI</div>
                <div style={{ color: '#888', fontSize: '12px' }}>
                  {systemStatus.github.status === 'available' ? 'Ready for PR operations' :
                   systemStatus.github.status === 'not_authenticated' ? 'Run: gh auth login' :
                   'Required for PR creation and updates'}
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                color: getStatusColor(systemStatus.github.status),
                fontSize: '12px',
                fontWeight: 'bold',
                marginBottom: '2px'
              }}>
                {systemStatus.github.status.replace('_', ' ').toUpperCase()}
              </div>
              {systemStatus.github.user && (
                <div style={{ color: '#666', fontSize: '10px' }}>
                  @{systemStatus.github.user}
                </div>
              )}
              {systemStatus.github.version && (
                <div style={{ color: '#666', fontSize: '10px' }}>
                  {systemStatus.github.version.split(' ')[0]}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
        marginBottom: '24px'
      }}>
        <div style={{
          backgroundColor: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '8px',
          padding: '20px'
        }}>
          <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>REPOSITORIES</div>
          <div style={{
            color: '#58a6ff',
            fontSize: '28px',
            fontWeight: 'bold'
          }}>
            {systemStatus.metrics.repositories}
          </div>
        </div>

        <div style={{
          backgroundColor: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '8px',
          padding: '20px'
        }}>
          <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>WORKTREES</div>
          <div style={{
            color: '#3fb950',
            fontSize: '28px',
            fontWeight: 'bold'
          }}>
            {systemStatus.metrics.worktrees}
          </div>
        </div>

        <div style={{
          backgroundColor: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '8px',
          padding: '20px'
        }}>
          <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>ACTIVE INSTANCES</div>
          <div style={{
            color: '#f59e0b',
            fontSize: '28px',
            fontWeight: 'bold'
          }}>
            {systemStatus.metrics.activeInstances}
          </div>
          <div style={{ color: '#666', fontSize: '10px', marginTop: '4px' }}>
            of {systemStatus.metrics.totalInstances} total
          </div>
        </div>
      </div>

      {/* Server Info */}
      <div style={{
        backgroundColor: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: '8px',
        padding: '24px'
      }}>
        <h3 style={{ color: '#fff', margin: 0, marginBottom: '16px', fontSize: '18px' }}>Server Information</h3>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '20px'
        }}>
          <div>
            <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>UPTIME</div>
            <div style={{ color: '#d2a8ff', fontSize: '20px', fontWeight: 'bold' }}>
              {formatUptime(systemStatus.server.uptime)}
            </div>
          </div>
          <div>
            <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>MEMORY USAGE</div>
            <div style={{ color: '#f85149', fontSize: '20px', fontWeight: 'bold' }}>
              {formatMemory(systemStatus.server.memory.heapUsed)}
            </div>
            <div style={{ color: '#666', fontSize: '10px' }}>
              / {formatMemory(systemStatus.server.memory.heapTotal)} heap
            </div>
          </div>
          <div>
            <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>NODE VERSION</div>
            <div style={{ color: '#8b949e', fontSize: '20px', fontWeight: 'bold' }}>
              {systemStatus.server.nodeVersion}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const AgentPanel: React.FC<AgentPanelProps> = ({
  selectedWorktree,
  selectedInstance,
  onCreateTerminalSession,
  onCreateDirectoryTerminalSession,
  onCloseTerminalSession,
  onRestartInstance,
  onStopInstance,
  onDeleteWorktree,
  error,
  isLeftPanelCollapsed
}) => {
  // Suppress TypeScript warning for unused parameter
  // This parameter is part of the interface for future UI responsiveness features
  void isLeftPanelCollapsed;

  // Agent instance selection state
  const [allInstances, setAllInstances] = useState<ClaudeInstance[]>([]);
  const [currentInstanceId, setCurrentInstanceId] = useState<string | null>(null);
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([]);
  const [showNewAgentDropdown, setShowNewAgentDropdown] = useState(false);
  const [isStartingNewAgent, setIsStartingNewAgent] = useState(false);

  const [claudeTerminalSessionId, setClaudeTerminalSessionId] = useState<string | null>(null);
  const [directoryTerminalSessionId, setDirectoryTerminalSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'claude' | 'directory' | 'git' | 'notes'>('dashboard');
  const [isCreatingClaudeSession, setIsCreatingClaudeSession] = useState(false);
  const [isCreatingDirectorySession, setIsCreatingDirectorySession] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const lastAutoConnectInstance = useRef<string>('');

  // Track all session IDs for all instances to keep them warm
  const [allInstanceSessions, setAllInstanceSessions] = useState<Map<string, { claude: string | null; directory: string | null }>>(new Map());

  // Git state
  const [gitDiff, setGitDiff] = useState<string>('');
  const [gitLoading, setGitLoading] = useState(false);
  const [gitCommitMessage, setGitCommitMessage] = useState<string>('');
  const [isGeneratingCommit, setIsGeneratingCommit] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isUpdatingPR, setIsUpdatingPR] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [showDenyConfirmation, setShowDenyConfirmation] = useState(false);
  const [deleteWorktreeOnDeny, setDeleteWorktreeOnDeny] = useState(false);
  const [diffViewMode, setDiffViewMode] = useState<'unified' | 'split'>('unified');

  // Analysis and comments state
  const [comments, setComments] = useState<DiffComment[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [analysisSummary, setAnalysisSummary] = useState<string>('');
  const [currentAnalysisId, setCurrentAnalysisId] = useState<string | null>(null);
  const [isApplyingFixes, setIsApplyingFixes] = useState(false);

  // Notes state
  const [notesContent, setNotesContent] = useState<string>('');
  const [notesFileName, setNotesFileName] = useState<string>('');
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [autoSaveTimeout, setAutoSaveTimeout] = useState<NodeJS.Timeout | null>(null);

  // Load available agents on mount
  useEffect(() => {
    const loadAgents = async () => {
      try {
        const agents = await api.getAgents();
        setAvailableAgents(agents as AgentInfo[]);
      } catch (error) {
        console.error('Failed to load agents:', error);
      }
    };
    loadAgents();
  }, []);

  // Load all instances for the worktree and select the first one
  useEffect(() => {
    const loadInstances = async () => {
      if (!selectedWorktree) {
        setAllInstances([]);
        setCurrentInstanceId(null);
        return;
      }

      try {
        const instances = await api.getInstances();
        const worktreeInstances = instances.filter(i => i.worktreeId === selectedWorktree.id);
        setAllInstances(worktreeInstances);

        // Auto-select: prefer running instance, or first instance, or null
        if (currentInstanceId && worktreeInstances.some(i => i.id === currentInstanceId)) {
          // Keep current selection if still valid
        } else if (worktreeInstances.length > 0) {
          const runningInstance = worktreeInstances.find(i => i.status === 'running');
          setCurrentInstanceId(runningInstance?.id || worktreeInstances[0].id);
        } else {
          setCurrentInstanceId(null);
        }
      } catch (error) {
        console.error('Failed to load instances:', error);
      }
    };

    loadInstances();
    const interval = setInterval(loadInstances, 3000); // Refresh every 3 seconds
    return () => clearInterval(interval);
  }, [selectedWorktree?.id]);

  // Get the currently selected instance object
  const currentInstance = allInstances.find(i => i.id === currentInstanceId) || null;

  // Keep all running instances warm with terminal sessions
  useEffect(() => {
    const ensureInstanceSessions = async () => {
      const runningInstances = allInstances.filter(i => i.status === 'running');

      for (const instance of runningInstances) {
        const cached = sessionCache.get(instance.id);
        const sessions = allInstanceSessions.get(instance.id) || { claude: null, directory: null };

        // Create Claude session if it doesn't exist
        if (!sessions.claude && !cached?.claude) {
          try {
            const sessionId = await onCreateTerminalSession(instance.id);
            sessionCache.setClaude(instance.id, sessionId);
            setAllInstanceSessions(prev => new Map(prev).set(instance.id, { ...sessions, claude: sessionId }));
          } catch (error) {
            console.error(`Failed to create Claude session for instance ${instance.id}:`, error);
          }
        } else if (cached?.claude && !sessions.claude) {
          setAllInstanceSessions(prev => new Map(prev).set(instance.id, { ...sessions, claude: cached.claude }));
        }
      }
    };

    ensureInstanceSessions();
  }, [allInstances]);

  useEffect(() => {
    // On instance switch, reuse cached sessionIds if present; do not clear
    if (currentInstance?.id) {
      const cached = sessionCache.get(currentInstance.id);
      const instanceSessions = allInstanceSessions.get(currentInstance.id);

      // Prioritize cached sessions, then check allInstanceSessions
      if (cached?.claude) {
        setClaudeTerminalSessionId(cached.claude);
      } else if (instanceSessions?.claude) {
        setClaudeTerminalSessionId(instanceSessions.claude);
        sessionCache.setClaude(currentInstance.id, instanceSessions.claude);
      } else {
        setClaudeTerminalSessionId(null);
      }

      if (cached?.directory) {
        setDirectoryTerminalSessionId(cached.directory);
      } else if (instanceSessions?.directory) {
        setDirectoryTerminalSessionId(instanceSessions.directory);
        sessionCache.setDirectory(currentInstance.id, instanceSessions.directory);
      } else {
        setDirectoryTerminalSessionId(null);
      }

      // Reset git and analysis UI only; terminals persist via wsManager
      setGitDiff('');
      setGitCommitMessage('');
      setComments([]);
      setAnalysisComplete(false);
      setAnalysisSummary('');
      setCurrentAnalysisId(null);
      // Clear notes state when switching
      setNotesContent('');
      setNotesFileName('');
      setUnsavedChanges(false);
      if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
        setAutoSaveTimeout(null);
      }
    }
  }, [currentInstance?.id, allInstanceSessions]);

  // Auto-connect to existing terminal sessions or create new ones when instance first becomes running
  useEffect(() => {
    if (currentInstance &&
        currentInstance.status === 'running' &&
        !claudeTerminalSessionId &&
        !directoryTerminalSessionId &&
        !isCreatingClaudeSession &&
        !isCreatingDirectorySession) {

      // Only proceed if this is a new instance or status change to running
      const currentInstanceKey = `${currentInstance.id}-${currentInstance.status}`;

      if (lastAutoConnectInstance.current !== currentInstanceKey) {
        lastAutoConnectInstance.current = currentInstanceKey;

        console.log(`Auto-connecting to instance ${currentInstance.id} (status: ${currentInstance.status})`);

        // Add a small delay to ensure state has settled after instance switch
        const timeoutId = setTimeout(() => {
          checkExistingSessionsOrConnect();
        }, 100);

        return () => clearTimeout(timeoutId);
      }
    }
  }, [currentInstance?.status, currentInstance?.id]); // Remove session IDs from dependencies

  const handleOpenClaudeTerminal = async () => {
    if (!currentInstance || currentInstance.status !== 'running') return;

    setIsCreatingClaudeSession(true);
    try {
      // First check for existing Claude session
      const existingSessions = await api.getTerminalSessions(currentInstance.id);
      const claudeSession = existingSessions.find(s => s.type === 'claude');

      if (claudeSession) {
        // Rejoin existing session
        setClaudeTerminalSessionId(claudeSession.id);
        if (selectedInstance) sessionCache.setClaude(selectedInstance.id, claudeSession.id);
      } else {
        // Create new session
        const sessionId = await onCreateTerminalSession(currentInstance.id);
        setClaudeTerminalSessionId(sessionId);
        sessionCache.setClaude(selectedInstance.id, sessionId);
      }
      setActiveTab('claude');
    } catch (error) {
      console.error('Failed to create Claude terminal session:', error);
      // Error will be shown via the error prop from parent component
    } finally {
      setIsCreatingClaudeSession(false);
    }
  };

  const handleOpenDirectoryTerminal = async () => {
    if (!currentInstance) return;

    setIsCreatingDirectorySession(true);
    try {
      // First check for existing directory session
      const existingSessions = await api.getTerminalSessions(currentInstance.id);
      const directorySession = existingSessions.find(s => s.type === 'directory');

      if (directorySession) {
        // Rejoin existing session
        setDirectoryTerminalSessionId(directorySession.id);
        if (selectedInstance) sessionCache.setDirectory(selectedInstance.id, directorySession.id);
      } else {
        // Create new session
        const sessionId = await onCreateDirectoryTerminalSession(currentInstance.id);
        setDirectoryTerminalSessionId(sessionId);
        sessionCache.setDirectory(selectedInstance.id, sessionId);
      }
      setActiveTab('directory');
    } catch (error) {
      console.error('Failed to create directory terminal session:', error);
    } finally {
      setIsCreatingDirectorySession(false);
    }
  };

  const handleCloseTerminal = (terminalType: 'claude' | 'directory') => {
    if (terminalType === 'claude' && claudeTerminalSessionId) {
      onCloseTerminalSession(claudeTerminalSessionId);
      setClaudeTerminalSessionId(null);
      if (selectedInstance) sessionCache.clearClaude(selectedInstance.id);
    } else if (terminalType === 'directory' && directoryTerminalSessionId) {
      onCloseTerminalSession(directoryTerminalSessionId);
      setDirectoryTerminalSessionId(null);
      if (selectedInstance) sessionCache.clearDirectory(selectedInstance.id);
    }
  };

  const handleRestartInstance = async () => {
    if (!currentInstance) return;

    setIsRestarting(true);
    try {
      // Close any existing terminal sessions
      if (claudeTerminalSessionId) {
        onCloseTerminalSession(claudeTerminalSessionId);
        setClaudeTerminalSessionId(null);
        if (currentInstance) sessionCache.clearClaude(currentInstance.id);
      }
      if (directoryTerminalSessionId) {
        onCloseTerminalSession(directoryTerminalSessionId);
        setDirectoryTerminalSessionId(null);
        if (currentInstance) sessionCache.clearDirectory(currentInstance.id);
      }

      await onRestartInstance(currentInstance.id);
    } catch (error) {
      console.error('Failed to restart instance:', error);
    } finally {
      setIsRestarting(false);
    }
  };

  const handleStopInstance = async () => {
    if (!currentInstance) return;

    setIsStopping(true);
    try {
      // Close any existing terminal sessions
      if (claudeTerminalSessionId) {
        onCloseTerminalSession(claudeTerminalSessionId);
        setClaudeTerminalSessionId(null);
        if (currentInstance) sessionCache.clearClaude(currentInstance.id);
      }
      if (directoryTerminalSessionId) {
        onCloseTerminalSession(directoryTerminalSessionId);
        setDirectoryTerminalSessionId(null);
         if (currentInstance) sessionCache.clearDirectory(currentInstance.id);
      }

      await onStopInstance(currentInstance.id);
    } catch (error) {
      console.error('Failed to stop instance:', error);
    } finally {
      setIsStopping(false);
    }
  };

  const handleStartNewAgent = async (agentType: AgentType) => {
    if (!selectedWorktree) return;

    setIsStartingNewAgent(true);
    setShowNewAgentDropdown(false);

    try {
      const newInstance = await api.startInstance(selectedWorktree.id, agentType);
      // Refresh instances list
      const instances = await api.getInstances();
      const worktreeInstances = instances.filter(i => i.worktreeId === selectedWorktree.id);
      setAllInstances(worktreeInstances);
      // Select the new instance
      setCurrentInstanceId(newInstance.id);
    } catch (error) {
      console.error('Failed to start new agent:', error);
    } finally {
      setIsStartingNewAgent(false);
    }
  };

  const handleDeleteInstance = async (instanceId: string) => {
    setIsDeleting(instanceId);
    try {
      // Close any cached sessions
      const cached = sessionCache.get(instanceId);
      if (cached?.claude) {
        onCloseTerminalSession(cached.claude);
        sessionCache.clearClaude(instanceId);
      }
      if (cached?.directory) {
        onCloseTerminalSession(cached.directory);
        sessionCache.clearDirectory(instanceId);
      }

      // Remove from allInstanceSessions
      setAllInstanceSessions(prev => {
        const newMap = new Map(prev);
        newMap.delete(instanceId);
        return newMap;
      });

      // Delete the instance
      await api.stopInstance(instanceId);

      // Refresh instances list
      const instances = await api.getInstances();
      const worktreeInstances = instances.filter(i => i.worktreeId === selectedWorktree?.id);
      setAllInstances(worktreeInstances);

      // If the deleted instance was selected, select another one
      if (currentInstanceId === instanceId) {
        const runningInstance = worktreeInstances.find(i => i.status === 'running');
        setCurrentInstanceId(runningInstance?.id || worktreeInstances[0]?.id || null);
        setClaudeTerminalSessionId(null);
        setDirectoryTerminalSessionId(null);
      }
    } catch (error) {
      console.error('Failed to delete instance:', error);
    } finally {
      setIsDeleting(null);
    }
  };

  const handleClearStoppedInstances = async () => {
    const stoppedInstances = allInstances.filter(i => i.status === 'stopped' || i.status === 'error');

    if (stoppedInstances.length === 0) return;

    if (!confirm(`Clear ${stoppedInstances.length} stopped/error instance(s)?`)) {
      return;
    }

    try {
      // Delete all stopped instances
      await Promise.all(stoppedInstances.map(instance => {
        // Close any cached sessions
        const cached = sessionCache.get(instance.id);
        if (cached?.claude) {
          onCloseTerminalSession(cached.claude);
          sessionCache.clearClaude(instance.id);
        }
        if (cached?.directory) {
          onCloseTerminalSession(cached.directory);
          sessionCache.clearDirectory(instance.id);
        }

        // Remove from allInstanceSessions
        setAllInstanceSessions(prev => {
          const newMap = new Map(prev);
          newMap.delete(instance.id);
          return newMap;
        });

        return api.stopInstance(instance.id);
      }));

      // Refresh instances list
      const instances = await api.getInstances();
      const worktreeInstances = instances.filter(i => i.worktreeId === selectedWorktree?.id);
      setAllInstances(worktreeInstances);

      // If the current instance was deleted, select another one
      if (currentInstanceId && stoppedInstances.some(i => i.id === currentInstanceId)) {
        const runningInstance = worktreeInstances.find(i => i.status === 'running');
        setCurrentInstanceId(runningInstance?.id || worktreeInstances[0]?.id || null);
        setClaudeTerminalSessionId(null);
        setDirectoryTerminalSessionId(null);
      }
    } catch (error) {
      console.error('Failed to clear stopped instances:', error);
    }
  };

  const checkExistingSessionsOrConnect = async () => {
    if (!currentInstance) return;

    console.log(`checkExistingSessionsOrConnect called for instance ${currentInstance.id}`);

    try {
      // Check for existing terminal sessions
      const existingSessions = await api.getTerminalSessions(currentInstance.id);
      console.log(`Found ${existingSessions.length} existing sessions for instance ${currentInstance.id}:`, existingSessions);
      
      // Look for existing Claude and directory sessions
      const claudeSession = existingSessions.find(s => s.type === 'claude');
      const directorySession = existingSessions.find(s => s.type === 'directory');
      
      if (claudeSession) {
        // Rejoin existing Claude session without changing tabs
        console.log(`Rejoining existing Claude session: ${claudeSession.id}, current activeTab: ${activeTab}`);
        setClaudeTerminalSessionId(claudeSession.id);
      }

      if (directorySession) {
        // Rejoin existing directory session without changing tabs
        console.log(`Rejoining existing directory session: ${directorySession.id}, current activeTab: ${activeTab}`);
        setDirectoryTerminalSessionId(directorySession.id);
      }

      // Don't automatically create sessions or switch tabs - let user choose from dashboard
    } catch (error) {
      console.error('Failed to check existing sessions:', error);
      // Don't create sessions automatically on error - stay on dashboard
    }
  };

  // Git operations
  const loadGitDiff = async () => {
    if (!selectedWorktree) return;

    setGitLoading(true);
    try {
      const diff = await api.getGitDiff(selectedWorktree.id);
      setGitDiff(diff);

      // Load existing analysis and comments for current git state
      try {
        const analysisData = await api.getAnalysis(selectedWorktree.id);
        if (analysisData.analysis) {
          setAnalysisComplete(true);
          setAnalysisSummary(analysisData.analysis.summary);
          setCurrentAnalysisId(analysisData.analysis.id);

          // Convert backend format to frontend format
          const frontendComments: DiffComment[] = analysisData.comments.map(comment => ({
            id: comment.id,
            file: comment.file,
            line: comment.line,
            type: comment.type,
            message: comment.message,
            severity: comment.severity,
            isAI: comment.isAI,
            userReply: comment.userReply
          }));
          setComments(frontendComments);
        } else {
          // No existing analysis
          setAnalysisComplete(false);
          setAnalysisSummary('');
          setCurrentAnalysisId(null);
          setComments([]);
        }
      } catch (analysisError) {
        console.error('Failed to load existing analysis:', analysisError);
        // Continue without analysis if it fails
        setAnalysisComplete(false);
        setAnalysisSummary('');
        setCurrentAnalysisId(null);
        setComments([]);
      }
    } catch (error) {
      console.error('Failed to load git diff:', error);
      setGitDiff('');
    } finally {
      setGitLoading(false);
    }
  };

  const handleAcceptChanges = async () => {
    if (!selectedWorktree) return;

    setIsGeneratingCommit(true);
    try {
      // Generate commit message using Claude, including comments context
      const result = await api.generateCommitMessage(selectedWorktree.id, comments);
      setGitCommitMessage(result.commitMessage);

      // Auto-commit the changes
      setIsCommitting(true);
      await api.commitChanges(selectedWorktree.id, result.commitMessage);

      // Refresh git diff (should be empty now)
      await loadGitDiff();

      // Clear comments since changes were accepted
      setComments([]);
      setAnalysisComplete(false);
      setAnalysisSummary('');
      setCurrentAnalysisId(null);

      // Smart PR management: create new PR or update existing one
      try {
        // First try to update existing PR
        try {
          const updateResult = await api.updatePullRequest(selectedWorktree.id);
          console.log('Updated existing PR:', updateResult.title);
        } catch (updateError: any) {
          // No existing PR found, create a new one
          if (updateError.message?.includes('No pull request found')) {
            const createResult = await api.createPullRequest(selectedWorktree.id);
            console.log('Created new PR:', createResult.title);
          } else {
            // Update failed for other reasons, try creating
            await api.createPullRequest(selectedWorktree.id);
          }
        }
      } catch (prError) {
        console.warn('Failed to manage pull request:', prError);
      }

    } catch (error) {
      console.error('Failed to accept changes:', error);
    } finally {
      setIsGeneratingCommit(false);
      setIsCommitting(false);
    }
  };

  const handleUpdatePR = async () => {
    if (!selectedWorktree) return;

    setIsUpdatingPR(true);
    try {
      const result = await api.updatePullRequest(selectedWorktree.id);
      console.log('PR updated successfully:', result.title);
    } catch (error: any) {
      if (error.message?.includes('No pull request found')) {
        // No existing PR, create one
        try {
          const createResult = await api.createPullRequest(selectedWorktree.id);
          console.log('Created new PR since none existed:', createResult.title);
        } catch (createError) {
          console.error('Failed to create PR:', createError);
        }
      } else {
        console.error('Failed to update PR:', error);
      }
    } finally {
      setIsUpdatingPR(false);
    }
  };

  const handleDenyChanges = () => {
    setShowDenyConfirmation(true);
  };

  const confirmDenyChanges = async () => {
    if (!selectedWorktree) return;

    setIsReverting(true);
    try {
      if (deleteWorktreeOnDeny) {
        // Comprehensive cleanup: stop instance, revert changes, and delete worktree

        // 1. Stop the Agent instance if running
        if (currentInstance) {
          console.log('Stopping instance before worktree deletion...');
          await onStopInstance(currentInstance.id);
        }

        // 2. Close any terminal sessions
        if (claudeTerminalSessionId) {
          onCloseTerminalSession(claudeTerminalSessionId);
          setClaudeTerminalSessionId(null);
          if (selectedInstance) sessionCache.clearClaude(selectedInstance.id);
        }
        if (directoryTerminalSessionId) {
          onCloseTerminalSession(directoryTerminalSessionId);
          setDirectoryTerminalSessionId(null);
          if (selectedInstance) sessionCache.clearDirectory(selectedInstance.id);
        }

        // 3. Delete the worktree entirely (this also reverts changes)
        console.log('Deleting worktree...');
        await onDeleteWorktree(selectedWorktree.id, false);

        // Note: onDeleteWorktree should handle clearing the selection and refreshing data
      } else {
        // Just revert changes, keep worktree
        await api.revertChanges(selectedWorktree.id);
        await loadGitDiff(); // Should be empty now

        // Clear comments since changes were reverted
        setComments([]);
        setAnalysisComplete(false);
        setAnalysisSummary('');
        setCurrentAnalysisId(null);
      }

    } catch (error) {
      console.error('Failed to deny changes:', error);
    } finally {
      setIsReverting(false);
      setShowDenyConfirmation(false);
      setDeleteWorktreeOnDeny(false); // Reset checkbox state
    }
  };

  // Analysis and comment operations
  const handleAnalyzeDiff = async () => {
    if (!selectedWorktree) return;

    setIsAnalyzing(true);
    try {
      const result = await api.analyzeDiff(selectedWorktree.id);

      // Set the analysis ID from the database
      setCurrentAnalysisId(result.analysis.analysisId);

      // Convert API response to DiffComment format
      const newComments: DiffComment[] = result.analysis.comments.map((comment, index) => ({
        id: `ai-${Date.now()}-${index}`,
        file: comment.file,
        line: comment.line,
        type: comment.type,
        message: comment.message,
        severity: comment.severity,
        isAI: true
      }));

      setComments(newComments);
      setAnalysisSummary(result.analysis.summary);
      setAnalysisComplete(true);
    } catch (error) {
      console.error('Failed to analyze diff:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAddComment = async (file: string, line: number, message: string) => {
    if (!selectedWorktree || !currentAnalysisId) return;

    try {
      const newComment = await api.addComment(selectedWorktree.id, {
        analysisId: currentAnalysisId,
        file,
        line,
        message
      });

      const frontendComment: DiffComment = {
        id: newComment.id,
        file: newComment.file,
        line: newComment.line,
        type: newComment.type,
        message: newComment.message,
        severity: newComment.severity,
        isAI: newComment.isAI
      };

      setComments(prev => [...prev, frontendComment]);
    } catch (error) {
      console.error('Failed to add comment:', error);
    }
  };

  const handleApplyFixes = async () => {
    if (!selectedWorktree) return;

    setIsApplyingFixes(true);
    try {
      const result = await api.applyCodeFixes(selectedWorktree.id);

      if (result.success) {
        // Success message
        console.log(`Applied ${result.fixesApplied} fixes to ${result.filesModified || 0} files`);

        // Refresh the git diff to show the applied changes
        try {
          const diff = await api.getGitDiff(selectedWorktree.id);
          setGitDiff(diff);
        } catch (error) {
          console.error('Failed to refresh git diff:', error);
        }

        // Optionally clear comments since fixes have been applied
        if (result.fixesApplied > 0) {
          setComments([]);
          setAnalysisComplete(false);
          setCurrentAnalysisId(null);
        }

        // You could show a toast notification here
        alert(`Successfully applied ${result.fixesApplied} code fixes!`);
      } else {
        console.error('Failed to apply fixes:', result.error);
        alert(`Failed to apply fixes: ${result.error}`);
      }
    } catch (error) {
      console.error('Error applying fixes:', error);
      alert('Failed to apply code fixes. Please try again.');
    } finally {
      setIsApplyingFixes(false);
    }
  };

  const handleReplyToComment = async (commentId: string, reply: string) => {
    if (!selectedWorktree) return;

    try {
      await api.updateComment(selectedWorktree.id, commentId, { userReply: reply });

      setComments(prev => prev.map(comment =>
        comment.id === commentId
          ? { ...comment, userReply: reply }
          : comment
      ));
    } catch (error) {
      console.error('Failed to reply to comment:', error);
    }
  };

  const handleDismissComment = async (commentId: string) => {
    if (!selectedWorktree) return;

    try {
      await api.updateComment(selectedWorktree.id, commentId, { isDismissed: true });

      setComments(prev => prev.filter(comment => comment.id !== commentId));
    } catch (error) {
      console.error('Failed to dismiss comment:', error);
    }
  };

  // Notes operations
  const loadNotes = async () => {
    if (!selectedWorktree) return;

    setIsLoadingNotes(true);
    try {
      const notesData = await api.getNotes(selectedWorktree.id);
      setNotesContent(notesData.content);
      setNotesFileName(notesData.fileName);
      setUnsavedChanges(false);
    } catch (error) {
      console.error('Failed to load notes:', error);
      setNotesContent('');
      setNotesFileName('');
    } finally {
      setIsLoadingNotes(false);
    }
  };

  const saveNotes = async (content: string) => {
    if (!selectedWorktree) return;

    setIsSavingNotes(true);
    try {
      const result = await api.saveNotes(selectedWorktree.id, content);
      setNotesFileName(result.fileName);
      setUnsavedChanges(false);
      console.log('Notes saved:', result.message);
    } catch (error) {
      console.error('Failed to save notes:', error);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleNotesChange = (content: string) => {
    setNotesContent(content);
    setUnsavedChanges(true);

    // Clear existing timeout
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }

    // Set new auto-save timeout (save after 2 seconds of no typing)
    const timeout = setTimeout(() => {
      saveNotes(content);
    }, 2000);

    setAutoSaveTimeout(timeout);
  };


  // Load git diff when switching to git tab
  useEffect(() => {
    if (activeTab === 'git' && selectedWorktree) {
      loadGitDiff();
    }
  }, [activeTab, selectedWorktree?.id]);

  // Load notes when switching to notes tab
  useEffect(() => {
    if (activeTab === 'notes' && selectedWorktree) {
      loadNotes();
    }
  }, [activeTab, selectedWorktree?.id]);

  // Cleanup autosave timeout on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
      }
    };
  }, [autoSaveTimeout]);

  if (!selectedWorktree) {
    return (
      <div className="right-panel">
        <div className="panel-header">
          <h3 style={{ margin: 0, color: '#ffffff' }}>Dashboard</h3>
        </div>
        <SystemStatusDashboard />
      </div>
    );
  }

  // Determine available agents that are ready to start
  const readyAgents = availableAgents.filter(a => a.isAvailable && (a.isAuthenticated ?? true));

  if (allInstances.length === 0 && !isStartingNewAgent) {
    return (
      <div className="right-panel">
        <div className="panel-header">
          <div>
            <h3 style={{ margin: 0, color: '#ffffff' }}>Agent Instances</h3>
            <span style={{ fontSize: '12px', color: '#888' }}>
              {selectedWorktree.branch} • {selectedWorktree.path}
            </span>
          </div>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowNewAgentDropdown(!showNewAgentDropdown)}
              style={{
                backgroundColor: '#28a745',
                border: 'none',
                color: '#fff',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              + New Agent
            </button>
            {showNewAgentDropdown && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '4px',
                backgroundColor: '#2d3748',
                border: '1px solid #4a5568',
                borderRadius: '6px',
                zIndex: 1000,
                minWidth: '200px',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)'
              }}>
                {readyAgents.length > 0 ? readyAgents.map(agent => (
                  <button
                    key={agent.type}
                    onClick={() => handleStartNewAgent(agent.type)}
                    style={{
                      width: '100%',
                      padding: '10px 16px',
                      backgroundColor: 'transparent',
                      border: 'none',
                      color: '#fff',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '13px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#4a5568'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <div style={{ fontWeight: 'bold' }}>{agent.name}</div>
                    <div style={{ fontSize: '11px', color: '#888' }}>{agent.statusMessage || 'Ready'}</div>
                  </button>
                )) : (
                  <div style={{ padding: '12px', color: '#888', fontSize: '12px' }}>
                    No agents available
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="empty-terminal">
          <div>
            <h4 style={{ color: '#666', marginBottom: '8px' }}>No Agent instances</h4>
            <p style={{ color: '#888', fontSize: '14px' }}>
              Start a new agent instance to begin working
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!currentInstance) {
    return null; // Loading state
  }

  return (
    <div className="right-panel">
      <div className="panel-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, color: '#ffffff', marginBottom: '4px' }}>Agent Instances</h3>
            <div style={{ fontSize: '12px', color: '#888' }}>
              {selectedWorktree.branch} • {selectedWorktree.path}
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {/* Clear Stopped Button */}
            {allInstances.some(i => i.status === 'stopped' || i.status === 'error') && (
              <button
                onClick={handleClearStoppedInstances}
                style={{
                  backgroundColor: '#6c757d',
                  border: 'none',
                  color: '#fff',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
                title="Clear all stopped/error instances"
              >
                Clear Stopped
              </button>
            )}

            {/* New Agent Button */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowNewAgentDropdown(!showNewAgentDropdown)}
                disabled={isStartingNewAgent}
                style={{
                  backgroundColor: '#28a745',
                  border: 'none',
                  color: '#fff',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  cursor: isStartingNewAgent ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                  opacity: isStartingNewAgent ? 0.6 : 1
                }}
              >
                {isStartingNewAgent ? 'Starting...' : '+ New Agent'}
              </button>
            {showNewAgentDropdown && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '4px',
                backgroundColor: '#2d3748',
                border: '1px solid #4a5568',
                borderRadius: '6px',
                zIndex: 1000,
                minWidth: '200px',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)'
              }}>
                {readyAgents.length > 0 ? readyAgents.map(agent => (
                  <button
                    key={agent.type}
                    onClick={() => handleStartNewAgent(agent.type)}
                    style={{
                      width: '100%',
                      padding: '10px 16px',
                      backgroundColor: 'transparent',
                      border: 'none',
                      color: '#fff',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '13px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#4a5568'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <div style={{ fontWeight: 'bold' }}>{agent.name}</div>
                    <div style={{ fontSize: '11px', color: '#888' }}>{agent.statusMessage || 'Ready'}</div>
                  </button>
                )) : (
                  <div style={{ padding: '12px', color: '#888', fontSize: '12px' }}>
                    No agents available
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        </div>

        {/* Agent Instance List */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxHeight: '200px',
          overflowY: 'auto',
          padding: '8px',
          backgroundColor: '#0d1117',
          borderRadius: '6px',
          border: '1px solid #30363d'
        }}>
          {allInstances.map(instance => {
            const isSelected = instance.id === currentInstanceId;
            const isConnected = (instance.id === currentInstanceId &&
                                (claudeTerminalSessionId || directoryTerminalSessionId));

            return (
              <div
                key={instance.id}
                onClick={() => setCurrentInstanceId(instance.id)}
                style={{
                  padding: '12px',
                  backgroundColor: isSelected ? '#21262d' : 'transparent',
                  border: `1px solid ${isSelected ? '#58a6ff' : '#30363d'}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = '#161b22';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{
                      fontWeight: 'bold',
                      color: '#fff',
                      fontSize: '13px',
                      textTransform: 'uppercase'
                    }}>
                      {instance.agentType}
                    </span>

                    {/* Status Badge */}
                    <span style={{
                      fontSize: '10px',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      backgroundColor:
                        instance.status === 'running' ? '#28a745' :
                        instance.status === 'starting' ? '#ffc107' :
                        instance.status === 'stopped' ? '#6c757d' : '#dc3545',
                      color: instance.status === 'starting' ? '#000' : '#fff'
                    }}>
                      {instance.status}
                    </span>

                    {/* Connected Badge */}
                    {isConnected && (
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        backgroundColor: '#0969da',
                        color: '#fff'
                      }}>
                        ● connected
                      </span>
                    )}

                    {/* Selected Indicator */}
                    {isSelected && (
                      <span style={{
                        fontSize: '10px',
                        color: '#58a6ff'
                      }}>
                        ◄ active
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: '11px', color: '#8b949e' }}>
                    ID: {instance.id.slice(-8)}
                    {instance.pid && <span> • PID: {instance.pid}</span>}
                    {instance.port && <span> • Port: {instance.port}</span>}
                    {(() => {
                      const cached = sessionCache.get(instance.id);
                      const sessions = allInstanceSessions.get(instance.id);
                      const terminalId = cached?.claude || sessions?.claude;
                      return terminalId ? <span> • Terminal: {terminalId.slice(-8)}</span> : null;
                    })()}
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '6px', marginLeft: '12px' }}>
                  {instance.status === 'running' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setCurrentInstanceId(instance.id);
                        handleStopInstance();
                      }}
                      disabled={isStopping && instance.id === currentInstanceId}
                      style={{
                        backgroundColor: '#dc3545',
                        border: 'none',
                        color: '#fff',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '10px',
                        opacity: (isStopping && instance.id === currentInstanceId) ? 0.6 : 1
                      }}
                    >
                      {(isStopping && instance.id === currentInstanceId) ? 'Stopping...' : 'Stop'}
                    </button>
                  )}

                  {(instance.status === 'stopped' || instance.status === 'error') && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurrentInstanceId(instance.id);
                          handleRestartInstance();
                        }}
                        disabled={isRestarting && instance.id === currentInstanceId}
                        style={{
                          backgroundColor: '#238636',
                          border: 'none',
                          color: '#fff',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '10px',
                          opacity: (isRestarting && instance.id === currentInstanceId) ? 0.6 : 1
                        }}
                      >
                        {(isRestarting && instance.id === currentInstanceId) ? 'Restarting...' : 'Restart'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteInstance(instance.id);
                        }}
                        disabled={isDeleting === instance.id}
                        style={{
                          backgroundColor: '#6c757d',
                          border: 'none',
                          color: '#fff',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '10px',
                          opacity: isDeleting === instance.id ? 0.6 : 1
                        }}
                      >
                        {isDeleting === instance.id ? 'Removing...' : 'Remove'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div style={{ 
          background: '#2d1b1b', 
          border: '1px solid #5a1f1f', 
          color: '#ff6b6b', 
          padding: '12px 16px', 
          fontSize: '14px',
          borderBottom: '1px solid #333'
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Tabbed interface */}
      <div style={{ display: 'flex', borderBottom: '1px solid #444' }}>
        <button
          onClick={() => {
            setActiveTab('dashboard');
          }}
          style={{
            background: activeTab === 'dashboard' ? '#444' : 'transparent',
            border: 'none',
            color: '#fff',
            padding: '12px 24px',
            cursor: 'pointer',
            borderBottom: activeTab === 'dashboard' ? '2px solid #007acc' : '2px solid transparent',
            fontSize: '13px'
          }}
        >
          Dashboard
        </button>
        <button
          onClick={() => {
            setActiveTab('claude');
            // If switching to Claude tab but no session exists, check for existing sessions
            if (!claudeTerminalSessionId && currentInstance?.status === 'running') {
              setTimeout(() => handleOpenClaudeTerminal(), 100);
            }
          }}
          style={{
            background: activeTab === 'claude' ? '#444' : 'transparent',
            border: 'none',
            color: '#fff',
            padding: '12px 24px',
            cursor: 'pointer',
            borderBottom: activeTab === 'claude' ? '2px solid #007acc' : '2px solid transparent',
            fontSize: '13px'
          }}
        >
          Agent {claudeTerminalSessionId && '●'}
        </button>
        <button
          onClick={() => {
            setActiveTab('directory');
            // If switching to Terminal tab but no session exists, check for existing sessions
            if (!directoryTerminalSessionId && currentInstance?.status === 'running') {
              setTimeout(() => handleOpenDirectoryTerminal(), 100);
            }
          }}
          style={{
            background: activeTab === 'directory' ? '#444' : 'transparent',
            border: 'none',
            color: '#fff',
            padding: '12px 24px',
            cursor: 'pointer',
            borderBottom: activeTab === 'directory' ? '2px solid #007acc' : '2px solid transparent',
            fontSize: '13px'
          }}
        >
          Terminal {directoryTerminalSessionId && '●'}
        </button>
        <button
          onClick={() => {
            setActiveTab('git');
          }}
          style={{
            background: activeTab === 'git' ? '#444' : 'transparent',
            border: 'none',
            color: '#fff',
            padding: '12px 24px',
            cursor: 'pointer',
            borderBottom: activeTab === 'git' ? '2px solid #007acc' : '2px solid transparent',
            fontSize: '13px'
          }}
        >
          Git {gitDiff && gitDiff.trim() && '●'}
        </button>
        <button
          onClick={() => {
            setActiveTab('notes');
          }}
          style={{
            background: activeTab === 'notes' ? '#444' : 'transparent',
            border: 'none',
            color: '#fff',
            padding: '12px 24px',
            cursor: 'pointer',
            borderBottom: activeTab === 'notes' ? '2px solid #007acc' : '2px solid transparent',
            fontSize: '13px'
          }}
        >
          Notes {unsavedChanges && '●'}
        </button>
      </div>

      <div className="terminal-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Dashboard Tab */}
        <div style={{
          display: activeTab === 'dashboard' ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          padding: '20px',
          overflowY: 'auto'
        }}>
          <div style={{ maxWidth: '800px' }}>
            <h2 style={{ color: '#fff', marginBottom: '20px' }}>Worktree Overview</h2>

            {/* Worktree Info */}
            <div style={{
              background: '#2d2d2d',
              border: '1px solid #444',
              borderRadius: '6px',
              padding: '16px',
              marginBottom: '20px'
            }}>
              <h3 style={{ color: '#fff', marginBottom: '12px', fontSize: '16px' }}>Branch Information</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ color: '#8b949e', fontSize: '13px' }}>
                  <strong style={{ color: '#fff' }}>Branch:</strong> {selectedWorktree?.branch}
                </div>
                <div style={{ color: '#8b949e', fontSize: '13px' }}>
                  <strong style={{ color: '#fff' }}>Path:</strong> {selectedWorktree?.path}
                </div>
              </div>
            </div>

            {/* Agent Status */}
            <div style={{
              background: '#2d2d2d',
              border: '1px solid #444',
              borderRadius: '6px',
              padding: '16px',
              marginBottom: '20px'
            }}>
              <h3 style={{ color: '#fff', marginBottom: '12px', fontSize: '16px' }}>Agent Status</h3>
              {currentInstance ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ color: '#8b949e', fontSize: '13px' }}>
                    <strong style={{ color: '#fff' }}>Status:</strong>{' '}
                    <span style={{
                      color: currentInstance.status === 'running' ? '#3fb950' :
                             currentInstance.status === 'starting' ? '#f59e0b' :
                             currentInstance.status === 'error' ? '#f85149' : '#8b949e'
                    }}>
                      {currentInstance.status}
                    </span>
                  </div>
                  <div style={{ color: '#8b949e', fontSize: '13px' }}>
                    <strong style={{ color: '#fff' }}>Type:</strong> {currentInstance.agentType}
                  </div>
                  {currentInstance.pid && (
                    <div style={{ color: '#8b949e', fontSize: '13px' }}>
                      <strong style={{ color: '#fff' }}>PID:</strong> {currentInstance.pid}
                    </div>
                  )}
                  {currentInstance.port && (
                    <div style={{ color: '#8b949e', fontSize: '13px' }}>
                      <strong style={{ color: '#fff' }}>Port:</strong> {currentInstance.port}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ color: '#8b949e', fontSize: '13px' }}>
                  No agent instance running
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div style={{
              background: '#2d2d2d',
              border: '1px solid #444',
              borderRadius: '6px',
              padding: '16px'
            }}>
              <h3 style={{ color: '#fff', marginBottom: '12px', fontSize: '16px' }}>Quick Actions</h3>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => {
                    setActiveTab('claude');
                    // If switching to Claude tab but no session exists, create one
                    if (!claudeTerminalSessionId && currentInstance?.status === 'running') {
                      setTimeout(() => handleOpenClaudeTerminal(), 100);
                    }
                  }}
                  disabled={!currentInstance || currentInstance.status !== 'running'}
                  style={{
                    background: '#007acc',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: !currentInstance || currentInstance.status !== 'running' ? 'not-allowed' : 'pointer',
                    opacity: !currentInstance || currentInstance.status !== 'running' ? 0.5 : 1,
                    fontSize: '13px'
                  }}
                >
                  Open Agent Terminal
                </button>
                <button
                  onClick={() => {
                    setActiveTab('directory');
                    // If switching to Terminal tab but no session exists, create one
                    if (!directoryTerminalSessionId && currentInstance?.status === 'running') {
                      setTimeout(() => handleOpenDirectoryTerminal(), 100);
                    }
                  }}
                  style={{
                    background: '#6c757d',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '13px'
                  }}
                >
                  Open Directory Terminal
                </button>
                <button
                  onClick={() => setActiveTab('git')}
                  style={{
                    background: '#f59e0b',
                    color: '#000',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '13px'
                  }}
                >
                  View Git Changes
                </button>
                <button
                  onClick={() => setActiveTab('notes')}
                  style={{
                    background: '#8b5cf6',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '13px'
                  }}
                >
                  View Notes
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Agent Terminal */}
        <div style={{
          display: activeTab === 'claude' ? 'flex' : 'none', 
          flexDirection: 'column', 
          flex: 1,
          minHeight: 0 
        }}>
          {claudeTerminalSessionId ? (
            <>
              {console.log(`Rendering Agent TerminalComponent with sessionId: ${claudeTerminalSessionId}`)}
              <TerminalComponent
                key={claudeTerminalSessionId}
                sessionId={claudeTerminalSessionId}
                onClose={() => handleCloseTerminal('claude')}
              />
            </>
          ) : currentInstance.status === 'running' ? (
            <div className="empty-terminal" style={{ flex: 1 }}>
              <div style={{ textAlign: 'center' }}>
                <h4 style={{ color: '#666', marginBottom: '8px' }}>Agent Terminal</h4>
                {isCreatingClaudeSession ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#888' }}>
                    <div style={{
                      width: '16px',
                      height: '16px',
                      border: '2px solid #444',
                      borderTop: '2px solid #888',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }}></div>
                    Connecting to Agent...
                  </div>
                ) : (
                  <>
                    <p style={{ color: '#888', fontSize: '14px', marginBottom: '16px' }}>
                      Connect to the running Agent instance for AI assistance
                    </p>
                    <button
                      onClick={handleOpenClaudeTerminal}
                      className="button"
                      style={{ fontSize: '14px', padding: '8px 16px' }}
                    >
                      Connect to Agent
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : currentInstance.status === 'starting' ? (
            <div className="empty-terminal" style={{ flex: 1 }}>
              <div style={{ textAlign: 'center' }}>
                <h4 style={{ color: '#666', marginBottom: '8px' }}>Agent Terminal</h4>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#888' }}>
                  <div style={{ 
                    width: '16px', 
                    height: '16px', 
                    border: '2px solid #444', 
                    borderTop: '2px solid #ffc107', 
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite' 
                  }}></div>
                  Starting Agent instance...
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-terminal" style={{ flex: 1 }}>
              <div style={{ textAlign: 'center' }}>
                <h4 style={{ color: '#666', marginBottom: '8px' }}>Agent Terminal</h4>
                <p style={{ color: '#888', fontSize: '14px' }}>
                  Agent instance must be running to connect
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Directory Terminal */}
        <div style={{ 
          display: activeTab === 'directory' ? 'flex' : 'none', 
          flexDirection: 'column', 
          flex: 1,
          minHeight: 0 
        }}>
          {directoryTerminalSessionId ? (
            <TerminalComponent
              sessionId={directoryTerminalSessionId}
              onClose={() => handleCloseTerminal('directory')}
            />
          ) : (
            <div className="empty-terminal" style={{ flex: 1 }}>
              <div style={{ textAlign: 'center' }}>
                <h4 style={{ color: '#666', marginBottom: '8px' }}>Directory Terminal</h4>
                <p style={{ color: '#888', fontSize: '14px', marginBottom: '16px' }}>
                  Open a bash shell in the worktree directory
                </p>
                {!isCreatingDirectorySession ? (
                  <button
                    onClick={handleOpenDirectoryTerminal}
                    className="button"
                    style={{ fontSize: '14px', padding: '8px 16px' }}
                  >
                    Open Terminal
                  </button>
                ) : (
                  <div style={{ color: '#888' }}>Connecting...</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Git Tab */}
        <div style={{
          display: activeTab === 'git' ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          padding: '16px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            borderBottom: '1px solid #444',
            paddingBottom: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <h4 style={{ color: '#fff', margin: 0 }}>Git Changes</h4>
              {gitDiff && gitDiff.trim() && (
                <div style={{
                  display: 'flex',
                  backgroundColor: '#21262d',
                  borderRadius: '6px',
                  border: '1px solid #30363d',
                  overflow: 'hidden'
                }}>
                  <button
                    onClick={() => setDiffViewMode('unified')}
                    style={{
                      backgroundColor: diffViewMode === 'unified' ? '#0969da' : 'transparent',
                      border: 'none',
                      color: diffViewMode === 'unified' ? '#fff' : '#8b949e',
                      padding: '4px 8px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: diffViewMode === 'unified' ? 'bold' : 'normal'
                    }}
                  >
                    Unified
                  </button>
                  <button
                    onClick={() => setDiffViewMode('split')}
                    style={{
                      backgroundColor: diffViewMode === 'split' ? '#0969da' : 'transparent',
                      border: 'none',
                      color: diffViewMode === 'split' ? '#fff' : '#8b949e',
                      padding: '4px 8px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: diffViewMode === 'split' ? 'bold' : 'normal'
                    }}
                  >
                    Split
                  </button>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {gitDiff && gitDiff.trim() ? (
                <>
                  <button
                    onClick={handleAcceptChanges}
                    disabled={isGeneratingCommit || isCommitting}
                    style={{
                      backgroundColor: '#28a745',
                      border: 'none',
                      color: '#fff',
                      padding: '8px 16px',
                      borderRadius: '4px',
                      cursor: isGeneratingCommit || isCommitting ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      opacity: isGeneratingCommit || isCommitting ? 0.6 : 1
                    }}
                  >
                    {isGeneratingCommit ? (
                      <>
                        <div style={{
                          width: '12px',
                          height: '12px',
                          border: '2px solid transparent',
                          borderTop: '2px solid #fff',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite'
                        }} />
                        Generating...
                      </>
                    ) : isCommitting ? (
                      <>
                        <div style={{
                          width: '12px',
                          height: '12px',
                          border: '2px solid transparent',
                          borderTop: '2px solid #fff',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite'
                        }} />
                        Committing...
                      </>
                    ) : (
                      '✅ Accept Changes'
                    )}
                  </button>
                  <button
                    onClick={handleAnalyzeDiff}
                    disabled={isAnalyzing}
                    style={{
                      backgroundColor: '#8b5cf6',
                      border: 'none',
                      color: '#fff',
                      padding: '8px 16px',
                      borderRadius: '4px',
                      cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      opacity: isAnalyzing ? 0.6 : 1,
                      marginLeft: '8px'
                    }}
                  >
                    {isAnalyzing ? (
                      <>
                        <div style={{
                          width: '12px',
                          height: '12px',
                          border: '2px solid transparent',
                          borderTop: '2px solid #fff',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite'
                        }} />
                        Analyzing...
                      </>
                    ) : (
                      '🔍 Analyze Code'
                    )}
                  </button>
                  {/* Apply Fixes button - only show when there are non-dismissed comments */}
                  {comments.some(comment => !comment.isDismissed) && (
                    <button
                      onClick={handleApplyFixes}
                      disabled={isApplyingFixes}
                      style={{
                        backgroundColor: '#28a745',
                        border: 'none',
                        color: '#fff',
                        padding: '8px 16px',
                        borderRadius: '4px',
                        cursor: isApplyingFixes ? 'not-allowed' : 'pointer',
                        fontSize: '13px',
                        opacity: isApplyingFixes ? 0.6 : 1,
                        marginLeft: '8px'
                      }}
                    >
                      {isApplyingFixes ? (
                        <>
                          <div style={{
                            display: 'inline-block',
                            width: '12px',
                            height: '12px',
                            marginRight: '6px',
                            border: '2px solid transparent',
                            borderTop: '2px solid #fff',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite'
                          }} />
                          Applying...
                        </>
                      ) : (
                        '🔧 Apply Fixes'
                      )}
                    </button>
                  )}
                  <button
                    onClick={handleUpdatePR}
                    disabled={isUpdatingPR}
                    style={{
                      backgroundColor: '#007acc',
                      border: 'none',
                      color: '#fff',
                      padding: '8px 16px',
                      borderRadius: '4px',
                      cursor: isUpdatingPR ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      opacity: isUpdatingPR ? 0.6 : 1,
                      marginLeft: '8px'
                    }}
                  >
                    {isUpdatingPR ? (
                      <>
                        <div style={{
                          display: 'inline-block',
                          width: '12px',
                          height: '12px',
                          marginRight: '6px',
                          border: '2px solid transparent',
                          borderTop: '2px solid #fff',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite'
                        }} />
                        Updating...
                      </>
                    ) : (
                      '🔄 Update PR'
                    )}
                  </button>
                  <button
                    onClick={handleDenyChanges}
                    disabled={isReverting}
                    style={{
                      backgroundColor: '#dc3545',
                      border: 'none',
                      color: '#fff',
                      padding: '8px 16px',
                      borderRadius: '4px',
                      cursor: isReverting ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      opacity: isReverting ? 0.6 : 1,
                      marginLeft: '8px'
                    }}
                  >
                    ❌ Deny Changes
                  </button>
                </>
              ) : (
                <button
                  onClick={loadGitDiff}
                  disabled={gitLoading}
                  style={{
                    backgroundColor: '#007acc',
                    border: 'none',
                    color: '#fff',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: gitLoading ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    opacity: gitLoading ? 0.6 : 1
                  }}
                >
                  {gitLoading ? 'Loading...' : '🔄 Refresh'}
                </button>
              )}
            </div>
          </div>

          {gitLoading ? (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#888'
            }}>
              Loading git changes...
            </div>
          ) : gitDiff && gitDiff.trim() ? (
            <div style={{ flex: 1, overflow: 'auto' }}>
              {/* Analysis Summary */}
              {analysisComplete && analysisSummary && (
                <div style={{
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '6px',
                  padding: '12px',
                  marginBottom: '16px'
                }}>
                  <h5 style={{ color: '#fff', marginBottom: '8px', fontSize: '14px' }}>
                    🤖 AI Analysis Summary
                  </h5>
                  <p style={{
                    color: '#e6edf3',
                    fontSize: '12px',
                    lineHeight: '1.4',
                    margin: 0
                  }}>
                    {analysisSummary}
                  </p>
                  {comments.length > 0 && (
                    <p style={{
                      color: '#8b949e',
                      fontSize: '11px',
                      margin: '8px 0 0 0'
                    }}>
                      Found {comments.length} comment{comments.length !== 1 ? 's' : ''} on the code
                    </p>
                  )}
                </div>
              )}

              {diffViewMode === 'unified' ? (
                <UnifiedDiffView
                  gitDiff={gitDiff}
                  comments={comments}
                  onAddComment={handleAddComment}
                  onReplyToComment={handleReplyToComment}
                  onDismissComment={handleDismissComment}
                />
              ) : (
                <SplitDiffView gitDiff={gitDiff} />
              )}
              {gitCommitMessage && (
                <div style={{ marginTop: '16px' }}>
                  <h5 style={{ color: '#fff', marginBottom: '8px' }}>Generated Commit Message:</h5>
                  <pre style={{
                    background: '#2d3748',
                    border: '1px solid #4a5568',
                    borderRadius: '4px',
                    padding: '8px',
                    color: '#a0aec0',
                    fontSize: '12px',
                    fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                    whiteSpace: 'pre-wrap',
                    margin: 0
                  }}>
                    {gitCommitMessage}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              color: '#888'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>📝</div>
              <h4 style={{ color: '#666', marginBottom: '8px' }}>No Changes</h4>
              <p style={{ color: '#888', fontSize: '14px', textAlign: 'center' }}>
                Your worktree is clean. Make some changes and they'll appear here.
              </p>
            </div>
          )}

        </div>

        {/* Notes Tab */}
        <div style={{
          display: activeTab === 'notes' ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          padding: '16px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            borderBottom: '1px solid #444',
            paddingBottom: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <h4 style={{ color: '#fff', margin: 0 }}>Notes</h4>
              {notesFileName && (
                <span style={{ color: '#888', fontSize: '12px' }}>
                  {notesFileName}
                </span>
              )}
              {unsavedChanges && (
                <span style={{ color: '#ffc107', fontSize: '12px' }}>
                  ● Unsaved changes
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => saveNotes(notesContent)}
                disabled={isSavingNotes || !unsavedChanges}
                style={{
                  backgroundColor: unsavedChanges ? '#28a745' : '#555',
                  border: 'none',
                  color: '#fff',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: isSavingNotes || !unsavedChanges ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                  opacity: isSavingNotes || !unsavedChanges ? 0.6 : 1
                }}
              >
                {isSavingNotes ? 'Saving...' : 'Save Notes'}
              </button>
            </div>
          </div>

          {isLoadingNotes ? (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#888'
            }}>
              Loading notes...
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <textarea
                value={notesContent}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Add your notes here... Notes will be automatically saved as you type and stored in .bob-notes-<branch>.md in your worktree."
                style={{
                  flex: 1,
                  minHeight: '400px',
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  color: '#e5e5e5',
                  padding: '16px',
                  fontSize: '14px',
                  fontFamily: 'Monaco, Menlo, "Ubuntu Mono", Consolas, "Droid Sans Mono", monospace',
                  lineHeight: '1.5',
                  resize: 'vertical',
                  outline: 'none',
                  width: '100%',
                  boxSizing: 'border-box'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#007acc';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#444';
                }}
              />
              <div style={{
                marginTop: '12px',
                fontSize: '12px',
                color: '#666',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span>
                  Auto-save enabled • Markdown supported
                </span>
                <span>
                  {notesContent.length} characters
                </span>
              </div>
            </div>
          )}
        </div>

      </div>
      
      {/* Denial Confirmation Modal for Git tab */}
      {activeTab === 'git' && showDenyConfirmation && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: '#2d3748',
            border: '1px solid #4a5568',
            borderRadius: '8px',
            padding: '24px',
            minWidth: '450px',
            maxWidth: '550px'
          }}>
            <h3 style={{ color: '#fff', marginBottom: '16px', marginTop: 0 }}>
              ⚠️ Confirm Deny Changes
            </h3>
            <p style={{ color: '#a0aec0', marginBottom: '16px', lineHeight: '1.5' }}>
              Choose how to handle the denial of changes:
            </p>

            {/* Option Selection */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                marginBottom: '12px',
                cursor: 'pointer',
                padding: '8px',
                borderRadius: '4px',
                backgroundColor: !deleteWorktreeOnDeny ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                border: !deleteWorktreeOnDeny ? '1px solid #3b82f6' : '1px solid transparent'
              }}>
                <input
                  type="radio"
                  name="denyOption"
                  checked={!deleteWorktreeOnDeny}
                  onChange={() => setDeleteWorktreeOnDeny(false)}
                  style={{ marginTop: '2px' }}
                />
                <div>
                  <div style={{ color: '#fff', fontWeight: 'bold', marginBottom: '4px' }}>
                    🔄 Revert Changes Only
                  </div>
                  <div style={{ color: '#a0aec0', fontSize: '13px' }}>
                    Reset all files to their last committed state, but keep the worktree and instance running.
                  </div>
                </div>
              </label>

              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                cursor: 'pointer',
                padding: '8px',
                borderRadius: '4px',
                backgroundColor: deleteWorktreeOnDeny ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
                border: deleteWorktreeOnDeny ? '1px solid #ef4444' : '1px solid transparent'
              }}>
                <input
                  type="radio"
                  name="denyOption"
                  checked={deleteWorktreeOnDeny}
                  onChange={() => setDeleteWorktreeOnDeny(true)}
                  style={{ marginTop: '2px' }}
                />
                <div>
                  <div style={{ color: '#fff', fontWeight: 'bold', marginBottom: '4px' }}>
                    🗑️ Delete Entire Worktree
                  </div>
                  <div style={{ color: '#a0aec0', fontSize: '13px' }}>
                    Stop the instance, close terminals, and completely remove this worktree and all its contents.
                  </div>
                </div>
              </label>
            </div>

            <div style={{
              color: deleteWorktreeOnDeny ? '#ef4444' : '#f59e0b',
              fontSize: '13px',
              marginBottom: '20px',
              padding: '8px',
              backgroundColor: 'rgba(0, 0, 0, 0.2)',
              borderRadius: '4px',
              fontWeight: 'bold'
            }}>
              ⚠️ {deleteWorktreeOnDeny ? 'This will permanently delete the entire worktree!' : 'This will permanently revert all changes!'}
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowDenyConfirmation(false);
                  setDeleteWorktreeOnDeny(false); // Reset checkbox when cancelling
                }}
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid #4a5568',
                  color: '#a0aec0',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDenyChanges}
                disabled={isReverting}
                style={{
                  backgroundColor: deleteWorktreeOnDeny ? '#dc3545' : '#f59e0b',
                  border: 'none',
                  color: '#fff',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: isReverting ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  opacity: isReverting ? 0.6 : 1
                }}
              >
                {isReverting
                  ? (deleteWorktreeOnDeny ? 'Deleting Worktree...' : 'Reverting Changes...')
                  : (deleteWorktreeOnDeny ? 'Yes, Delete Worktree' : 'Yes, Revert Changes')
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden terminals for all instances to keep them warm */}
      {allInstances.map(instance => {
        const sessions = allInstanceSessions.get(instance.id);
        if (!sessions?.claude || instance.id === currentInstanceId) {
          // Skip if no session or this is the currently visible instance
          return null;
        }
        return (
          <div key={`hidden-${instance.id}`} style={{ display: 'none' }}>
            <TerminalComponent
              sessionId={sessions.claude}
              onClose={() => {}}
            />
          </div>
        );
      })}
    </div>
  );
};
