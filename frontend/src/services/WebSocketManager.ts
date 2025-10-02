interface WebSocketConnection {
  ws: WebSocket;
  sessionId: string;
  callbacks: Set<(message: any) => void>;
  reconnectAttempts: number;
  lastReconnectTime: number;
  isConnecting: boolean;
  isDestroyed: boolean;
  buffer: string[]; // ring buffer of recent chunks
  bufferSize: number; // current size in bytes
  idleTimer?: ReturnType<typeof setTimeout>;
}

interface ConnectionPoolConfig {
  maxConnections: number;
  reconnectDelay: number;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
  connectionTimeout: number;
  bufferMaxBytes: number;
  idleTtlMs: number;
}

class WebSocketManager {
  private connections = new Map<string, WebSocketConnection>();
  private config: ConnectionPoolConfig = {
    maxConnections: 10,
    reconnectDelay: 1000,
    maxReconnectAttempts: 3,
    heartbeatInterval: 30000,
    connectionTimeout: 10000,
    bufferMaxBytes: 256 * 1024, // 256KB per session
    idleTtlMs: 30 * 60 * 1000 // 30 minutes
  };
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor() {
    this.startHeartbeat();
    this.setupCleanupHandlers();
  }

  private setupCleanupHandlers(): void {
    const cleanup = () => {
      this.shutdown();
    };

    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('unload', cleanup);

    // Listen for page visibility changes to manage connections
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Page is hidden, reduce connection activity
        this.pauseConnections();
      } else {
        // Page is visible again, resume connections
        this.resumeConnections();
      }
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.config.heartbeatInterval);
  }

  private performHealthChecks(): void {
    for (const [sessionId, conn] of this.connections) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        try {
          conn.ws.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
          console.warn(`Failed to send ping to session ${sessionId}:`, error);
          this.reconnectConnection(sessionId);
        }
      } else if (conn.ws.readyState === WebSocket.CLOSED && !conn.isDestroyed) {
        this.reconnectConnection(sessionId);
      }
    }
  }

  async connect(sessionId: string, onMessage: (message: any) => void): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('WebSocket manager is shutting down');
    }

    // Check if connection already exists
    const existingConn = this.connections.get(sessionId);
    if (existingConn) {
      if (existingConn.ws.readyState === WebSocket.OPEN) {
        existingConn.callbacks.add(onMessage);
        return;
      } else if (existingConn.isConnecting) {
        // Wait for connection to complete
        return new Promise((resolve, reject) => {
          const checkConnection = () => {
            const conn = this.connections.get(sessionId);
            if (conn && conn.ws.readyState === WebSocket.OPEN) {
              conn.callbacks.add(onMessage);
              resolve();
            } else if (conn && conn.isDestroyed) {
              reject(new Error('Connection failed'));
            } else {
              setTimeout(checkConnection, 100);
            }
          };
          checkConnection();
        });
      }
    }

    // Check connection limit
    if (this.connections.size >= this.config.maxConnections) {
      await this.cleanupStaleConnections();
      if (this.connections.size >= this.config.maxConnections) {
        throw new Error('Maximum WebSocket connections reached');
      }
    }

    return this.createConnection(sessionId, onMessage);
  }

  private async createConnection(sessionId: string, onMessage: (message: any) => void): Promise<void> {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Match Terminal.tsx logic for dev/electron
    const isElectron = (window as any).electronAPI !== undefined;
    const isDevelopment = window.location.port === '47285' || window.location.port === '5173';

    let wsUrl: string;
    if (isDevelopment) {
      // Development: connect directly to backend port
      wsUrl = `${wsProtocol}//${window.location.hostname}:43829?sessionId=${sessionId}`;
    } else {
      // Production: use same host without port (nginx proxies WebSocket)
      wsUrl = `${wsProtocol}//${window.location.host}?sessionId=${sessionId}`;
    }

    console.log('[WebSocketManager] Creating connection to:', wsUrl);

    const conn: WebSocketConnection = {
      ws: new WebSocket(wsUrl),
      sessionId,
      callbacks: new Set([onMessage]),
      reconnectAttempts: 0,
      lastReconnectTime: Date.now(),
      isConnecting: true,
      isDestroyed: false,
      buffer: [],
      bufferSize: 0
    };

    this.connections.set(sessionId, conn);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (conn.isConnecting) {
          conn.isDestroyed = true;
          this.connections.delete(sessionId);
          reject(new Error('WebSocket connection timeout'));
        }
      }, this.config.connectionTimeout);

      conn.ws.onopen = () => {
        clearTimeout(timeout);
        conn.isConnecting = false;
        conn.reconnectAttempts = 0;
        console.log(`WebSocket connected for session ${sessionId}`);
        resolve();
      };

      conn.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // Handle internal messages
          if (message.type === 'pong') {
            return; // Heartbeat response
          }

          // Append to ring buffer
          if (typeof message?.type === 'string' && message.type === 'data' && typeof message.data === 'string') {
            this.appendToBuffer(conn, message.data);
          }

          // Broadcast to all callbacks
          for (const callback of conn.callbacks) {
            try {
              callback(message);
            } catch (error) {
              console.error('Error in WebSocket message callback:', error);
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      conn.ws.onerror = (error) => {
        console.error(`WebSocket error for session ${sessionId}:`, error);
        if (conn.isConnecting) {
          clearTimeout(timeout);
          conn.isDestroyed = true;
          this.connections.delete(sessionId);
          reject(error);
        }
      };

      conn.ws.onclose = (event) => {
        conn.isConnecting = false;
        if (!conn.isDestroyed && !this.isShuttingDown) {
          if (event.code !== 1000) {
            console.log(`WebSocket closed unexpectedly for session ${sessionId}, code: ${event.code}`);
            this.scheduleReconnect(sessionId);
          } else {
            console.log(`WebSocket closed normally for session ${sessionId}`);
            this.connections.delete(sessionId);
          }
        }
      };
    });
  }

  private scheduleReconnect(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn || conn.isDestroyed || this.isShuttingDown) {
      return;
    }

    if (conn.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.log(`Max reconnect attempts reached for session ${sessionId}`);
      conn.isDestroyed = true;
      this.connections.delete(sessionId);
      return;
    }

    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, conn.reconnectAttempts),
      5000
    );

    setTimeout(() => {
      this.reconnectConnection(sessionId);
    }, delay);
  }

  private async reconnectConnection(sessionId: string): Promise<void> {
    const conn = this.connections.get(sessionId);
    if (!conn || conn.isDestroyed || conn.isConnecting || this.isShuttingDown) {
      return;
    }

    conn.reconnectAttempts++;
    conn.lastReconnectTime = Date.now();

    try {
      // Close existing connection
      if (conn.ws.readyState !== WebSocket.CLOSED) {
        conn.ws.close();
      }

      // Create new connection
      const callbacks = Array.from(conn.callbacks);
      this.connections.delete(sessionId);

      if (callbacks.length > 0) {
        await this.createConnection(sessionId, callbacks[0]);
        // Add remaining callbacks
        const newConn = this.connections.get(sessionId);
        if (newConn) {
          for (let i = 1; i < callbacks.length; i++) {
            newConn.callbacks.add(callbacks[i]);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to reconnect session ${sessionId}:`, error);
      this.scheduleReconnect(sessionId);
    }
  }

  send(sessionId: string, data: any): boolean {
    const conn = this.connections.get(sessionId);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      conn.ws.send(JSON.stringify(data));
      return true;
    } catch (error) {
      console.error(`Failed to send message to session ${sessionId}:`, error);
      this.reconnectConnection(sessionId);
      return false;
    }
  }

  disconnect(sessionId: string, callback?: (message: any) => void): void {
    const conn = this.connections.get(sessionId);
    if (!conn) {
      return;
    }

    if (callback) {
      conn.callbacks.delete(callback);

      // If there are still callbacks, keep the connection
      if (conn.callbacks.size > 0) {
        return;
      }
    }

    // Check if "Keep agent terminals warm" setting is enabled
    const keepWarm = localStorage.getItem('keepAgentTerminalsWarm');
    const shouldKeepWarm = keepWarm === null || keepWarm === 'true'; // Default to true

    if (!shouldKeepWarm) {
      // Setting disabled: close immediately
      conn.isDestroyed = true;
      if (conn.ws.readyState !== WebSocket.CLOSED) {
        try { conn.ws.close(1000, 'Keep warm disabled'); } catch {}
      }
      this.connections.delete(sessionId);
      return;
    }

    // No more subscribers: keep the connection warm with idle TTL
    if (conn.idleTimer) {
      clearTimeout(conn.idleTimer);
    }
    conn.idleTimer = setTimeout(() => {
      // Double check still no subscribers
      const latest = this.connections.get(sessionId);
      if (!latest || latest.callbacks.size > 0) return;
      latest.isDestroyed = true;
      if (latest.ws.readyState !== WebSocket.CLOSED) {
        try { latest.ws.close(1000, 'Idle TTL elapsed'); } catch {}
      }
      this.connections.delete(sessionId);
    }, this.config.idleTtlMs);
  }

  private cleanupStaleConnections(): void {
    const now = Date.now();
    const staleThreshold = 60000; // 1 minute

    for (const [sessionId, conn] of this.connections) {
      if (
        conn.ws.readyState === WebSocket.CLOSED ||
        (conn.callbacks.size === 0) ||
        (now - conn.lastReconnectTime > staleThreshold && conn.reconnectAttempts >= this.config.maxReconnectAttempts)
      ) {
        console.log(`Cleaning up stale connection for session ${sessionId}`);
        conn.isDestroyed = true;
        if (conn.ws.readyState !== WebSocket.CLOSED) {
          conn.ws.close();
        }
        this.connections.delete(sessionId);
      }
    }
  }

  private pauseConnections(): void {
    // Reduce heartbeat frequency when page is hidden
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        this.performHealthChecks();
      }, this.config.heartbeatInterval * 2); // Double the interval
    }
  }

  private resumeConnections(): void {
    // Resume normal heartbeat frequency
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        this.performHealthChecks();
      }, this.config.heartbeatInterval);
    }

    // Check all connections immediately
    this.performHealthChecks();
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  getConnectionStats(): Array<{
    sessionId: string;
    status: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED';
    subscribers: number;
    reconnectAttempts: number;
    bufferSize: number;
    isDestroyed: boolean;
  }> {
    const stats = [];

    for (const [sessionId, conn] of this.connections) {
      let status: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED';
      switch (conn.ws.readyState) {
        case WebSocket.CONNECTING:
          status = 'CONNECTING';
          break;
        case WebSocket.OPEN:
          status = 'OPEN';
          break;
        case WebSocket.CLOSING:
          status = 'CLOSING';
          break;
        case WebSocket.CLOSED:
          status = 'CLOSED';
          break;
        default:
          status = 'CLOSED';
      }

      stats.push({
        sessionId,
        status,
        subscribers: conn.callbacks.size,
        reconnectAttempts: conn.reconnectAttempts,
        bufferSize: conn.bufferSize,
        isDestroyed: conn.isDestroyed
      });
    }

    return stats;
  }

  getSnapshot(sessionId: string): string {
    const conn = this.connections.get(sessionId);
    if (!conn) return '';
    return conn.buffer.join('');
  }

  private appendToBuffer(conn: WebSocketConnection, chunk: string): void {
    conn.buffer.push(chunk);
    conn.bufferSize += chunk.length;
    while (conn.bufferSize > this.config.bufferMaxBytes && conn.buffer.length > 0) {
      const removed = conn.buffer.shift()!;
      conn.bufferSize -= removed.length;
    }
  }

  shutdown(): void {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const [_sessionId, conn] of this.connections) {
      conn.isDestroyed = true;
      conn.callbacks.clear();
      if (conn.ws.readyState !== WebSocket.CLOSED) {
        conn.ws.close(1000, 'Manager shutting down');
      }
    }

    this.connections.clear();
  }
}

// Export singleton instance
export const wsManager = new WebSocketManager();
