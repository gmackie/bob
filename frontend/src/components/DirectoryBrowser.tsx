import React, { useState, useEffect, useCallback } from 'react';

interface DirectoryItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
}

interface DirectoryBrowserData {
  currentPath: string;
  parent: string | null;
  items: DirectoryItem[];
}

interface DirectoryBrowserProps {
  onSelectDirectory: (path: string) => void;
  onClose: () => void;
}

export const DirectoryBrowser: React.FC<DirectoryBrowserProps> = ({
  onSelectDirectory,
  onClose
}) => {
  // Initialize lazily: load last path from localStorage, otherwise query backend for OS home
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [data, setData] = useState<DirectoryBrowserData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine initial path on mount
  useEffect(() => {
    const init = async () => {
      const saved = localStorage.getItem('bob:lastDirectoryPath');
      if (saved) {
        setCurrentPath(saved);
        return;
      }
      try {
        const resp = await fetch('/api/filesystem/home');
        if (resp.ok) {
          const json = await resp.json();
          setCurrentPath(json.path || '/');
        } else {
          setCurrentPath('/');
        }
      } catch {
        setCurrentPath('/');
      }
    };
    init();
  }, []);

  const browseDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/filesystem/browse?path=${encodeURIComponent(path)}`);
      if (!response.ok) {
        throw new Error('Failed to browse directory');
      }
      const data = await response.json();
      setData(data);
      try { localStorage.setItem('bob:lastDirectoryPath', data.currentPath); } catch {}
    } catch (err) {
      // Fallback: if the requested path is invalid, try the OS home directory once
      try {
        const resp = await fetch('/api/filesystem/home');
        if (resp.ok) {
          const json = await resp.json();
          try { localStorage.removeItem('bob:lastDirectoryPath'); } catch {}
          setLoading(false);
          setCurrentPath(json.path || '/');
          return;
        }
      } catch {}
      setError(err instanceof Error ? err.message : 'Failed to browse directory');
    } finally {
      setLoading(false);
    }
  }, []);

  // Browse whenever currentPath changes and is known
  useEffect(() => {
    if (currentPath) browseDirectory(currentPath);
  }, [currentPath, browseDirectory]);

  const handleDirectoryClick = (item: DirectoryItem) => {
    setCurrentPath(item.path);
  };

  const handleDirectoryDoubleClick = (item: DirectoryItem) => {
    if (item.isGitRepo) {
      handleSelectDirectory(item.path);
    } else {
      setCurrentPath(item.path);
    }
  };

  const handleParentClick = () => {
    if (data?.parent) {
      setCurrentPath(data.parent);
    }
  };

  const handleSelectCurrent = () => {
    if (!currentPath) return;
    onSelectDirectory(currentPath);
    onClose();
  };

  const handleSelectDirectory = (path: string) => {
    onSelectDirectory(path);
    onClose();
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        background: '#2a2a2a',
        border: '1px solid #333',
        borderRadius: '8px',
        width: '600px',
        maxHeight: '70vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div style={{
          padding: '16px',
          borderBottom: '1px solid #333',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h3 style={{ margin: 0, color: '#ffffff' }}>Select Directory</h3>
          <button onClick={onClose} style={{
            background: 'none',
            border: 'none',
            color: '#ccc',
            cursor: 'pointer',
            fontSize: '20px'
          }}>×</button>
        </div>

        <div style={{ padding: '16px', borderBottom: '1px solid #333' }}>
          <div style={{ 
            fontSize: '14px', 
            color: '#ccc', 
            marginBottom: '8px',
            fontFamily: 'monospace',
            wordBreak: 'break-all'
          }}>
            {currentPath ?? 'Loading path...'}
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button 
              onClick={handleSelectCurrent}
              disabled={!currentPath}
              className="button"
              style={{ fontSize: '12px' }}
            >
              Select Current Directory
            </button>
            {data?.parent && (
              <button 
                onClick={handleParentClick} 
                className="button secondary"
                style={{ fontSize: '12px' }}
              >
                ← Parent Directory
              </button>
            )}
          </div>
          <div style={{ fontSize: '12px', color: '#888', fontStyle: 'italic' }}>
            💡 Double-click folders to browse, double-click git repos to select
          </div>
        </div>

        <div style={{ 
          flex: 1, 
          overflow: 'auto', 
          maxHeight: '400px' 
        }}>
          {loading && (
            <div style={{ padding: '20px', textAlign: 'center', color: '#888' }}>
              Loading...
            </div>
          )}

          {error && (
            <div style={{ 
              padding: '16px', 
              color: '#dc3545', 
              background: 'rgba(220, 53, 69, 0.1)',
              margin: '8px',
              borderRadius: '4px'
            }}>
              {error}
            </div>
          )}

          {data && !loading && (
            <div>
              {data.items.length === 0 ? (
                <div style={{ 
                  padding: '20px', 
                  textAlign: 'center', 
                  color: '#888' 
                }}>
                  No directories found
                </div>
              ) : (
                data.items.map((item) => (
                  <div
                    key={item.path}
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid #333',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#333'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    onDoubleClick={() => handleDirectoryDoubleClick(item)}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px'
                      }}>
                        <span style={{ fontSize: '16px' }}>📁</span>
                        <span style={{ color: item.isGitRepo ? '#28a745' : '#e5e5e5' }}>
                          {item.name}
                        </span>
                        {item.isGitRepo && (
                          <span style={{
                            fontSize: '10px',
                            background: '#28a745',
                            color: 'white',
                            padding: '2px 4px',
                            borderRadius: '3px'
                          }}>
                            GIT
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDirectoryClick(item);
                        }}
                        className="button secondary"
                        style={{ fontSize: '10px', padding: '4px 8px' }}
                      >
                        Browse
                      </button>
                      {item.isGitRepo && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectDirectory(item.path);
                          }}
                          className="button"
                          style={{ fontSize: '10px', padding: '4px 8px' }}
                        >
                          Select
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
