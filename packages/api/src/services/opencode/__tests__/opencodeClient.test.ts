/**
 * Tests for OpenCode Client
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenCodeClient } from "../opencodeClient.js";

// Mock fetch globally
global.fetch = vi.fn();

describe("OpenCodeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createSession", () => {
    it("should create a session successfully", async () => {
      const mockSession = {
        id: "session-123",
        status: "active" as const,
        createdAt: new Date().toISOString(),
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSession,
      });

      const client = new OpenCodeClient({
        baseUrl: "http://localhost:8080",
      });

      const result = await client.createSession();

      expect(result).toEqual(mockSession);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8080/sessions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("should include API key in headers when provided", async () => {
      const mockSession = {
        id: "session-123",
        status: "active" as const,
        createdAt: new Date().toISOString(),
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSession,
      });

      const client = new OpenCodeClient({
        baseUrl: "http://localhost:8080",
        apiKey: "test-api-key",
      });

      await client.createSession();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        })
      );
    });
  });

  describe("sendMessage", () => {
    it("should send a message and parse streaming response", async () => {
      const mockChunks = [
        'data: {"content": "Hello", "delta": "Hello"}\n',
        'data: {"content": " World", "delta": " World"}\n',
      ];

      const mockStream = {
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(mockChunks[0]) })
              .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(mockChunks[1]) })
              .mockResolvedValueOnce({ done: true }),
            releaseLock: vi.fn(),
          }),
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: mockStream.body,
      });

      const client = new OpenCodeClient({
        baseUrl: "http://localhost:8080",
      });

      const responseStream = await client.sendMessage("session-123", {
        role: "user",
        content: "Hello",
      });

      const chunks: string[] = [];
      for await (const chunk of responseStream) {
        chunks.push(chunk.content);
      }

      expect(chunks).toContain("Hello");
      expect(chunks).toContain(" World");
    });
  });

  describe("error handling", () => {
    it("should throw error on non-ok response", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error",
      });

      const client = new OpenCodeClient({
        baseUrl: "http://localhost:8080",
      });

      await expect(client.createSession()).rejects.toThrow("OpenCode server error");
    });

    it.skip("should handle timeout", async () => {
      // Timeout testing with AbortController is complex in test environment
      // The timeout functionality is tested via integration tests
    });
  });
});
