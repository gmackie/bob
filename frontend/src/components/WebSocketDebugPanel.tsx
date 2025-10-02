import { useState, useEffect } from 'react';
import { wsManager } from '../services/WebSocketManager';
import '../styles/WebSocketDebugPanel.css';

interface ConnectionStats {
  sessionId: string;
  status: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED';
  subscribers: number;
  reconnectAttempts: number;
  bufferSize: number;
  isDestroyed: boolean;
}

export function WebSocketDebugPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<ConnectionStats[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    const updateStats = () => {
      const connectionStats = wsManager.getConnectionStats();
      setStats(connectionStats);
    };

    // Initial update
    updateStats();

    // Update every second
    const interval = setInterval(updateStats, 1000);

    return () => clearInterval(interval);
  }, [isOpen]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'OPEN': return '#3fb950';
      case 'CONNECTING': return '#d29922';
      case 'CLOSING': return '#f85149';
      case 'CLOSED': return '#8b949e';
      default: return '#8b949e';
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="ws-debug-panel">
      <button
        className="ws-debug-toggle"
        onClick={() => setIsOpen(!isOpen)}
        title="WebSocket Debug Panel"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="2" y1="12" x2="22" y2="12"></line>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>
        <span className="ws-debug-badge">{stats.length}</span>
      </button>

      {isOpen && (
        <div className="ws-debug-dropdown">
          <div className="ws-debug-header">
            <h3>WebSocket Connections</h3>
            <span className="ws-debug-count">{stats.length} active</span>
          </div>

          <div className="ws-debug-content">
            {stats.length === 0 ? (
              <div className="ws-debug-empty">No active connections</div>
            ) : (
              <div className="ws-debug-list">
                {stats.map((conn) => (
                  <div key={conn.sessionId} className="ws-debug-item">
                    <div className="ws-debug-item-header">
                      <span
                        className="ws-debug-status-dot"
                        style={{ backgroundColor: getStatusColor(conn.status) }}
                      ></span>
                      <span className="ws-debug-session-id">
                        {conn.sessionId.substring(0, 8)}...
                      </span>
                      <span className="ws-debug-status-text" style={{ color: getStatusColor(conn.status) }}>
                        {conn.status}
                      </span>
                    </div>
                    <div className="ws-debug-item-details">
                      <div className="ws-debug-detail">
                        <span className="ws-debug-detail-label">Subscribers:</span>
                        <span className="ws-debug-detail-value">{conn.subscribers}</span>
                      </div>
                      <div className="ws-debug-detail">
                        <span className="ws-debug-detail-label">Buffer:</span>
                        <span className="ws-debug-detail-value">{formatBytes(conn.bufferSize)}</span>
                      </div>
                      <div className="ws-debug-detail">
                        <span className="ws-debug-detail-label">Reconnects:</span>
                        <span className="ws-debug-detail-value">{conn.reconnectAttempts}</span>
                      </div>
                      {conn.isDestroyed && (
                        <div className="ws-debug-detail">
                          <span className="ws-debug-destroyed">DESTROYED</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
