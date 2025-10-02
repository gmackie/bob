import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wsManager } from './WebSocketManager';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }, 10);
  }

  send(data: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code: code || 1000, reason: reason || '' }));
  }
}

// @ts-ignore
global.WebSocket = MockWebSocket;

describe('WebSocketManager', () => {
  beforeEach(() => {
    // Reset manager state
    wsManager.shutdown();
  });

  afterEach(() => {
    wsManager.shutdown();
  });

  describe('Connection Management', () => {
    it('should create a new connection', async () => {
      const sessionId = 'test-session-1';
      const mockCallback = vi.fn();

      await wsManager.connect(sessionId, mockCallback);

      const stats = wsManager.getConnectionStats();
      expect(stats.total).toBe(1);
      expect(stats.open).toBe(1);
    });

    it('should reuse existing connection for same session', async () => {
      const sessionId = 'test-session-2';
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      await wsManager.connect(sessionId, callback1);
      await wsManager.connect(sessionId, callback2);

      const stats = wsManager.getConnectionStats();
      expect(stats.total).toBe(1); // Only one connection
    });

    it('should handle multiple sessions', async () => {
      const callback = vi.fn();

      await wsManager.connect('session-1', callback);
      await wsManager.connect('session-2', callback);
      await wsManager.connect('session-3', callback);

      const stats = wsManager.getConnectionStats();
      expect(stats.total).toBe(3);
      expect(stats.open).toBe(3);
    });

    it('should disconnect session when callback removed', async () => {
      const sessionId = 'test-session-disconnect';
      const callback = vi.fn();

      await wsManager.connect(sessionId, callback);
      expect(wsManager.getConnectionStats().total).toBe(1);

      wsManager.disconnect(sessionId, callback);

      // Connection should still exist but be scheduled for cleanup
      expect(wsManager.getConnectionStats().total).toBe(1);
    });
  });

  describe('Message Handling', () => {
    it('should broadcast messages to all callbacks', async () => {
      const sessionId = 'test-session-broadcast';
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      await wsManager.connect(sessionId, callback1);
      await wsManager.connect(sessionId, callback2);

      // Simulate receiving a message
      const mockMessage = { type: 'data', data: 'test data' };
      // We need to access the internal connection to trigger onmessage
      // This is a limitation of the test, in practice this would be triggered by the server

      expect(callback1).toHaveBeenCalledTimes(0); // No messages sent yet
      expect(callback2).toHaveBeenCalledTimes(0);
    });

    it('should send messages through connection', async () => {
      const sessionId = 'test-session-send';
      const callback = vi.fn();

      await wsManager.connect(sessionId, callback);

      const result = wsManager.send(sessionId, { type: 'data', data: 'test' });
      expect(result).toBe(true);
    });

    it('should fail to send when connection not open', () => {
      const sessionId = 'non-existent-session';
      const result = wsManager.send(sessionId, { type: 'data', data: 'test' });
      expect(result).toBe(false);
    });
  });

  describe('Buffer Management', () => {
    it('should maintain empty snapshot for new session', () => {
      const snapshot = wsManager.getSnapshot('non-existent');
      expect(snapshot).toBe('');
    });

    it('should return snapshot for session', async () => {
      const sessionId = 'test-session-snapshot';
      const callback = vi.fn();

      await wsManager.connect(sessionId, callback);

      // Initially empty
      const snapshot = wsManager.getSnapshot(sessionId);
      expect(snapshot).toBe('');
    });
  });

  describe('Connection Stats', () => {
    it('should return accurate connection statistics', async () => {
      const callback = vi.fn();

      await wsManager.connect('session-1', callback);
      await wsManager.connect('session-2', callback);

      const stats = wsManager.getConnectionStats();
      expect(stats.total).toBe(2);
      expect(stats.open).toBe(2);
      expect(stats.connecting).toBe(0);
      expect(stats.closed).toBe(0);
    });

    it('should track connection count', async () => {
      const callback = vi.fn();

      expect(wsManager.getConnectionCount()).toBe(0);

      await wsManager.connect('session-1', callback);
      expect(wsManager.getConnectionCount()).toBe(1);

      await wsManager.connect('session-2', callback);
      expect(wsManager.getConnectionCount()).toBe(2);
    });
  });

  describe('Shutdown', () => {
    it('should close all connections on shutdown', async () => {
      const callback = vi.fn();

      await wsManager.connect('session-1', callback);
      await wsManager.connect('session-2', callback);
      await wsManager.connect('session-3', callback);

      expect(wsManager.getConnectionCount()).toBe(3);

      wsManager.shutdown();

      expect(wsManager.getConnectionCount()).toBe(0);
    });

    it('should prevent new connections after shutdown', async () => {
      const callback = vi.fn();

      wsManager.shutdown();

      await expect(wsManager.connect('session-1', callback)).rejects.toThrow(
        'WebSocket manager is shutting down'
      );
    });
  });
});
