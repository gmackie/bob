import { describe, it, expect, beforeEach } from 'vitest';
import { sessionCache } from './SessionCache';

describe('SessionCache', () => {
  const instanceId = 'test-instance-1';
  const claudeSessionId = 'claude-session-123';
  const directorySessionId = 'directory-session-456';

  beforeEach(() => {
    // Clear cache by setting and clearing test entries
    sessionCache.clearClaude(instanceId);
    sessionCache.clearDirectory(instanceId);
  });

  describe('Claude Session Management', () => {
    it('should set and get claude session', () => {
      sessionCache.setClaude(instanceId, claudeSessionId);

      const entry = sessionCache.get(instanceId);
      expect(entry).toBeDefined();
      expect(entry?.claude).toBe(claudeSessionId);
    });

    it('should clear claude session', () => {
      sessionCache.setClaude(instanceId, claudeSessionId);
      expect(sessionCache.get(instanceId)?.claude).toBe(claudeSessionId);

      sessionCache.clearClaude(instanceId);
      const entry = sessionCache.get(instanceId);
      expect(entry?.claude).toBeUndefined();
    });

    it('should preserve directory session when clearing claude', () => {
      sessionCache.setClaude(instanceId, claudeSessionId);
      sessionCache.setDirectory(instanceId, directorySessionId);

      sessionCache.clearClaude(instanceId);

      const entry = sessionCache.get(instanceId);
      expect(entry?.claude).toBeUndefined();
      expect(entry?.directory).toBe(directorySessionId);
    });
  });

  describe('Directory Session Management', () => {
    it('should set and get directory session', () => {
      sessionCache.setDirectory(instanceId, directorySessionId);

      const entry = sessionCache.get(instanceId);
      expect(entry).toBeDefined();
      expect(entry?.directory).toBe(directorySessionId);
    });

    it('should clear directory session', () => {
      sessionCache.setDirectory(instanceId, directorySessionId);
      expect(sessionCache.get(instanceId)?.directory).toBe(directorySessionId);

      sessionCache.clearDirectory(instanceId);
      const entry = sessionCache.get(instanceId);
      expect(entry?.directory).toBeUndefined();
    });

    it('should preserve claude session when clearing directory', () => {
      sessionCache.setClaude(instanceId, claudeSessionId);
      sessionCache.setDirectory(instanceId, directorySessionId);

      sessionCache.clearDirectory(instanceId);

      const entry = sessionCache.get(instanceId);
      expect(entry?.claude).toBe(claudeSessionId);
      expect(entry?.directory).toBeUndefined();
    });
  });

  describe('Multiple Sessions', () => {
    it('should store both claude and directory sessions', () => {
      sessionCache.setClaude(instanceId, claudeSessionId);
      sessionCache.setDirectory(instanceId, directorySessionId);

      const entry = sessionCache.get(instanceId);
      expect(entry?.claude).toBe(claudeSessionId);
      expect(entry?.directory).toBe(directorySessionId);
    });

    it('should handle multiple instances independently', () => {
      const instance1 = 'instance-1';
      const instance2 = 'instance-2';

      sessionCache.setClaude(instance1, 'claude-1');
      sessionCache.setClaude(instance2, 'claude-2');
      sessionCache.setDirectory(instance1, 'dir-1');
      sessionCache.setDirectory(instance2, 'dir-2');

      expect(sessionCache.get(instance1)?.claude).toBe('claude-1');
      expect(sessionCache.get(instance1)?.directory).toBe('dir-1');
      expect(sessionCache.get(instance2)?.claude).toBe('claude-2');
      expect(sessionCache.get(instance2)?.directory).toBe('dir-2');
    });
  });

  describe('Edge Cases', () => {
    it('should return undefined for non-existent instance', () => {
      const entry = sessionCache.get('non-existent-instance');
      expect(entry).toBeUndefined();
    });

    it('should handle clearing non-existent claude session', () => {
      expect(() => sessionCache.clearClaude('non-existent')).not.toThrow();
    });

    it('should handle clearing non-existent directory session', () => {
      expect(() => sessionCache.clearDirectory('non-existent')).not.toThrow();
    });

    it('should update existing claude session', () => {
      sessionCache.setClaude(instanceId, 'claude-old');
      sessionCache.setClaude(instanceId, 'claude-new');

      expect(sessionCache.get(instanceId)?.claude).toBe('claude-new');
    });

    it('should update existing directory session', () => {
      sessionCache.setDirectory(instanceId, 'dir-old');
      sessionCache.setDirectory(instanceId, 'dir-new');

      expect(sessionCache.get(instanceId)?.directory).toBe('dir-new');
    });

    it('should remove entry when both sessions are cleared', () => {
      sessionCache.setClaude(instanceId, claudeSessionId);
      sessionCache.setDirectory(instanceId, directorySessionId);

      sessionCache.clearClaude(instanceId);
      sessionCache.clearDirectory(instanceId);

      const entry = sessionCache.get(instanceId);
      expect(entry).toBeUndefined();
    });
  });
});
