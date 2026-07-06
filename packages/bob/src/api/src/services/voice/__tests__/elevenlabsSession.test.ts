/**
 * Tests for ElevenLabs Session Service
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ElevenLabsSessionService } from "../elevenlabsSession.js";
import type { TranscriptEvent } from "../elevenlabsSession.js";
import type {
  OpenCodeClient,
  OpenCodeResponse,
  OpenCodeSession,
} from "../../opencode/opencodeClient.js";

// A structurally-typed fake of OpenCodeClient (not `any`) — only the four
// methods ElevenLabsSessionService actually calls, each with the real
// method's own signature via `vi.fn<Signature>()`.
interface MockOpenCodeClient {
  createSession: ReturnType<typeof vi.fn<OpenCodeClient["createSession"]>>;
  sendMessage: ReturnType<typeof vi.fn<OpenCodeClient["sendMessage"]>>;
  getSessionHistory: ReturnType<typeof vi.fn<OpenCodeClient["getSessionHistory"]>>;
  closeSession: ReturnType<typeof vi.fn<OpenCodeClient["closeSession"]>>;
}

describe("ElevenLabsSessionService", () => {
  let mockOpenCodeClient: MockOpenCodeClient;
  let service: ElevenLabsSessionService;

  beforeEach(() => {
    mockOpenCodeClient = {
      createSession: vi.fn<OpenCodeClient["createSession"]>(),
      sendMessage: vi.fn<OpenCodeClient["sendMessage"]>(),
      getSessionHistory: vi.fn<OpenCodeClient["getSessionHistory"]>(),
      closeSession: vi.fn<OpenCodeClient["closeSession"]>(),
    };

    service = new ElevenLabsSessionService({
      apiKey: "test-api-key",
      agentId: "test-agent-id",
      opencodeClient: mockOpenCodeClient as unknown as OpenCodeClient,
    });
  });

  describe("createVoiceSession", () => {
    it("should create a voice session", async () => {
      const result = await service.createVoiceSession("session-123");

      expect(result.sessionId).toBeDefined();
      expect(result.signalingInfo.agentId).toBe("test-agent-id");
      expect(result.signalingInfo.conversationToken).toBeUndefined();

      const session = service.getSession("session-123");
      expect(session).toBeDefined();
      expect(session?.status).toBe("connecting");
    });
  });

  describe("handleUserTranscript", () => {
    it("should forward transcript to OpenCode and return assistant text", async () => {
      // Create session first
      await service.createVoiceSession("session-123");

      // Mock OpenCode responses
      const mockOpenCodeSession: OpenCodeSession = {
        id: "opencode-session-123",
        status: "active",
        createdAt: new Date().toISOString(),
      };

      const mockResponseStream: AsyncIterable<OpenCodeResponse> = (async function* () {
        await Promise.resolve();
        yield { content: "Hello", usage: undefined };
        yield { content: " there!", usage: undefined };
      })();

      mockOpenCodeClient.createSession.mockResolvedValueOnce(mockOpenCodeSession);
      mockOpenCodeClient.sendMessage.mockResolvedValueOnce(mockResponseStream);

      // Register transcript callback
      const transcriptEvents: TranscriptEvent[] = [];
      service.onTranscript("session-123", (event) => {
        transcriptEvents.push(event);
      });

      const result = await service.handleUserTranscript("session-123", "Hello");

      expect(result).toBe("Hello there!");
      expect(mockOpenCodeClient.createSession).toHaveBeenCalledWith({
        bobSessionId: "session-123",
      });
      expect(mockOpenCodeClient.sendMessage).toHaveBeenCalledWith(
        "opencode-session-123",
        {
          role: "user",
          content: "Hello",
        },
        { stream: true }
      );

      // Verify transcript events were emitted
      expect(transcriptEvents).toHaveLength(2);
      expect(transcriptEvents[0]?.type).toBe("user");
      expect(transcriptEvents[0]?.text).toBe("Hello");
      expect(transcriptEvents[1]?.type).toBe("assistant");
      expect(transcriptEvents[1]?.text).toBe("Hello there!");
    });

    it("should reuse OpenCode session for context", async () => {
      await service.createVoiceSession("session-123");

      const mockOpenCodeSession: OpenCodeSession = {
        id: "opencode-session-123",
        status: "active",
        createdAt: new Date().toISOString(),
      };

      const mockResponseStream: AsyncIterable<OpenCodeResponse> = (async function* () {
        await Promise.resolve();
        yield { content: "Response", usage: undefined };
      })();

      mockOpenCodeClient.createSession.mockResolvedValueOnce(mockOpenCodeSession);
      mockOpenCodeClient.sendMessage.mockResolvedValue(mockResponseStream);

      // First transcript creates session
      await service.handleUserTranscript("session-123", "First message");
      expect(mockOpenCodeClient.createSession).toHaveBeenCalledTimes(1);

      // Second transcript reuses session
      await service.handleUserTranscript("session-123", "Second message");
      expect(mockOpenCodeClient.createSession).toHaveBeenCalledTimes(1);
      expect(mockOpenCodeClient.sendMessage).toHaveBeenCalledTimes(2);
    });

    it("should throw error if session not found", async () => {
      await expect(
        service.handleUserTranscript("nonexistent", "Hello")
      ).rejects.toThrow("Voice session not found");
    });
  });

  describe("stopVoiceSession", () => {
    it("should stop and remove voice session", async () => {
      await service.createVoiceSession("session-123");
      expect(service.getSession("session-123")).toBeDefined();

      await service.stopVoiceSession("session-123");

      expect(service.getSession("session-123")).toBeUndefined();
    });

    it("should handle stopping non-existent session gracefully", async () => {
      await expect(service.stopVoiceSession("nonexistent")).resolves.not.toThrow();
    });
  });
});
