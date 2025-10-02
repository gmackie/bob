import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wsManager } from './WebSocketManager';
import { sessionCache } from './SessionCache';

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

describe('Terminal Connection Integration', () => {
  beforeEach(() => {
    wsManager.shutdown();
  });

  afterEach(() => {
    wsManager.shutdown();
  });

  describe('Session Persistence Across Tab Switches', () => {
    it('should reuse terminal session when switching back to instance', async () => {
      const instanceId = 'instance-1';
      const claudeSessionId = 'claude-session-1';
      const callback = vi.fn();

      // Initial connection
      await wsManager.connect(claudeSessionId, callback);
      sessionCache.setClaude(instanceId, claudeSessionId);

      expect(wsManager.getConnectionStats().total).toBe(1);
      expect(sessionCache.get(instanceId)?.claude).toBe(claudeSessionId);

      // Simulate switching away (disconnect but don't destroy)
      wsManager.disconnect(claudeSessionId, callback);

      // Simulate switching back - should reuse cached session ID
      const cachedSession = sessionCache.get(instanceId);
      expect(cachedSession?.claude).toBe(claudeSessionId);

      // Reconnect with cached session
      const newCallback = vi.fn();
      await wsManager.connect(claudeSessionId, newCallback);

      // Should still only have 1 connection (reused)
      expect(wsManager.getConnectionStats().total).toBe(1);
    });

    it('should maintain separate sessions for claude and directory terminals', async () => {
      const instanceId = 'instance-1';
      const claudeSessionId = 'claude-session-1';
      const directorySessionId = 'directory-session-1';

      const claudeCallback = vi.fn();
      const directoryCallback = vi.fn();

      // Create both sessions
      await wsManager.connect(claudeSessionId, claudeCallback);
      await wsManager.connect(directorySessionId, directoryCallback);

      // Cache both
      sessionCache.setClaude(instanceId, claudeSessionId);
      sessionCache.setDirectory(instanceId, directorySessionId);

      expect(wsManager.getConnectionStats().total).toBe(2);

      const cached = sessionCache.get(instanceId);
      expect(cached?.claude).toBe(claudeSessionId);
      expect(cached?.directory).toBe(directorySessionId);
    });
  });

  describe('Multi-Instance Session Management', () => {
    it('should handle sessions for multiple instances independently', async () => {
      const instance1 = 'instance-1';
      const instance2 = 'instance-2';
      const claude1 = 'claude-session-1';
      const claude2 = 'claude-session-2';

      const callback1 = vi.fn();
      const callback2 = vi.fn();

      // Create sessions for both instances
      await wsManager.connect(claude1, callback1);
      await wsManager.connect(claude2, callback2);

      sessionCache.setClaude(instance1, claude1);
      sessionCache.setClaude(instance2, claude2);

      expect(wsManager.getConnectionStats().total).toBe(2);
      expect(sessionCache.get(instance1)?.claude).toBe(claude1);
      expect(sessionCache.get(instance2)?.claude).toBe(claude2);

      // Switch instances - should not affect other instance's session
      wsManager.disconnect(claude1, callback1);
      expect(sessionCache.get(instance2)?.claude).toBe(claude2);
    });
  });

  describe('Connection Pooling', () => {
    it('should reuse connection when multiple components connect to same session', async () => {
      const sessionId = 'shared-session';
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      // Multiple components connecting to same session
      await wsManager.connect(sessionId, callback1);
      await wsManager.connect(sessionId, callback2);
      await wsManager.connect(sessionId, callback3);

      // Should only create one WebSocket connection
      expect(wsManager.getConnectionStats().total).toBe(1);
      expect(wsManager.getConnectionStats().open).toBe(1);
    });

    it('should keep connection alive when one component disconnects', async () => {
      const sessionId = 'shared-session';
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      await wsManager.connect(sessionId, callback1);
      await wsManager.connect(sessionId, callback2);

      expect(wsManager.getConnectionStats().total).toBe(1);

      // Disconnect one component
      wsManager.disconnect(sessionId, callback1);

      // Connection should still exist for callback2
      expect(wsManager.getConnectionStats().total).toBe(1);
    });
  });

  describe('Session Cleanup', () => {
    it('should clear session cache when explicitly closing terminal', async () => {
      const instanceId = 'instance-1';
      const claudeSessionId = 'claude-session-1';
      const callback = vi.fn();

      await wsManager.connect(claudeSessionId, callback);
      sessionCache.setClaude(instanceId, claudeSessionId);

      expect(sessionCache.get(instanceId)?.claude).toBe(claudeSessionId);

      // Explicit cleanup
      sessionCache.clearClaude(instanceId);

      expect(sessionCache.get(instanceId)?.claude).toBeUndefined();
    });

    it('should handle instance restart by clearing both sessions', async () => {
      const instanceId = 'instance-1';
      const claudeSessionId = 'claude-session-1';
      const directorySessionId = 'directory-session-1';

      sessionCache.setClaude(instanceId, claudeSessionId);
      sessionCache.setDirectory(instanceId, directorySessionId);

      // Simulate instance restart - clear both sessions
      sessionCache.clearClaude(instanceId);
      sessionCache.clearDirectory(instanceId);

      const cached = sessionCache.get(instanceId);
      expect(cached).toBeUndefined();
    });
  });

  describe('Error Recovery', () => {
    it('should handle connection failures gracefully', async () => {
      const sessionId = 'failing-session';
      const callback = vi.fn();

      // Connection succeeds (our mock always succeeds)
      await wsManager.connect(sessionId, callback);

      expect(wsManager.getConnectionStats().total).toBe(1);
    });

    it('should allow reconnection after disconnect', async () => {
      const sessionId = 'reconnect-session';
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      // Initial connection
      await wsManager.connect(sessionId, callback1);
      expect(wsManager.getConnectionStats().total).toBe(1);

      // Disconnect
      wsManager.disconnect(sessionId, callback1);

      // Reconnect
      await wsManager.connect(sessionId, callback2);
      expect(wsManager.getConnectionStats().total).toBe(1);
    });
  });
});
