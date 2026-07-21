/**
 * Tests for OpenCode Client
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenCodeClient } from "../opencodeClient.js";

// Mock fetch globally — typed to the real `fetch` signature so every
// mockResolvedValueOnce fixture below is checked against Response's shape.
// Fixtures only implement the subset of Response that OpenCodeClient's
// `request()` actually reads (ok/json/body/status/statusText/text), so each
// literal is cast through `as Response` at its call site rather than
// constructing a real Response.
const fetchMock = vi.fn<typeof fetch>();
global.fetch = fetchMock;

describe("OpenCodeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createSession", () => {
    it("should create a session successfully", async () => {
      const mockSession = {
        id: "session-123",
        time: {
          created: "1710000000000",
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSession),
      } as Response);

      const client = new OpenCodeClient({
        baseUrl: "http://localhost:8080",
      });

      const result = await client.createSession();

      expect(result).toEqual({
        id: "session-123",
        status: "active",
        createdAt: "1710000000000",
      });
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8080/session",
        expect.objectContaining({
          method: "POST",
          // vitest's nested expect.objectContaining always returns `any` per
          // its own type declarations, regardless of generic argument.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("should include API key in headers when provided", async () => {
      const mockSession = {
        id: "session-123",
        time: {
          created: "1710000000000",
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSession),
      } as Response);

      const client = new OpenCodeClient({
        baseUrl: "http://localhost:8080",
        apiKey: "test-api-key",
      });

      await client.createSession();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          // vitest's nested expect.objectContaining always returns `any` per
          // its own type declarations, regardless of generic argument.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

      const mockStream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of mockChunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: mockStream,
      } as Response);

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
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("Server error"),
      } as Response);

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
