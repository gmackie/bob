import type { OpenCodeClient } from "../opencode/opencodeClient";
import { createOpenCodeClient } from "../opencode/opencodeClient";

/**
 * ElevenLabs Voice Session Service
 *
 * Manages voice conversations using ElevenLabs Agent SDK with WebRTC.
 * Bridges user voice input → OpenCode server → assistant text → ElevenLabs TTS → user audio output.
 */

export interface ElevenLabsConfig {
  apiKey: string;
  agentId: string;
  opencodeClient: OpenCodeClient;
}

export interface VoiceSession {
  id: string;
  sessionId: string; // Bob session ID
  agentId: string;
  status: "connecting" | "connected" | "disconnected" | "error";
  conversationToken?: string;
  opencodeSessionId?: string; // Persist OpenCode session for context
  createdAt: Date;
}

export interface TranscriptEvent {
  type: "user" | "assistant";
  text: string;
  timestamp: Date;
}

export class ElevenLabsSessionService {
  private config: ElevenLabsConfig;
  private activeSessions = new Map<string, VoiceSession>();
  private transcriptCallbacks = new Map<
    string,
    (event: TranscriptEvent) => void
  >();

  constructor(config: ElevenLabsConfig) {
    this.config = config;
  }

  /**
   * Create a new voice session for a Bob chat session
   * Returns WebRTC signaling information for the client
   */
  async createVoiceSession(sessionId: string): Promise<{
    sessionId: string;
    signalingInfo: {
      // WebRTC signaling will be handled by the client SDK
      // This returns any server-side setup needed
      agentId: string;
      conversationToken?: string;
    };
  }> {
    // For private agents, we need to generate a conversation token
    // For public agents, we can use the agentId directly
    let conversationToken: string | undefined;

    // TODO: If agent is private, fetch conversation token from ElevenLabs API
    // For now, assume public agent (no token needed)

    const voiceSession: VoiceSession = {
      id: `voice-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      sessionId,
      agentId: this.config.agentId,
      status: "connecting",
      conversationToken,
      createdAt: new Date(),
    };

    this.activeSessions.set(sessionId, voiceSession);

    return {
      sessionId: voiceSession.id,
      signalingInfo: {
        agentId: this.config.agentId,
        conversationToken,
      },
    };
  }

  /**
   * Handle user transcript from ElevenLabs SDK
   * Forwards to OpenCode server and returns assistant response
   * The SDK will handle TTS automatically when we return the text
   */
  async handleUserTranscript(
    sessionId: string,
    transcript: string,
  ): Promise<string> {
    const voiceSession = this.activeSessions.get(sessionId);
    if (!voiceSession) {
      throw new Error(`Voice session not found: ${sessionId}`);
    }

    // Emit transcript event (will be persisted by the router)
    this.emitTranscript(sessionId, {
      type: "user",
      text: transcript,
      timestamp: new Date(),
    });

    // Forward to OpenCode server
    try {
      // Get or create OpenCode session for this Bob session to maintain context
      let opencodeSessionId = voiceSession.opencodeSessionId;

      if (!opencodeSessionId) {
        const opencodeSession = await this.config.opencodeClient.createSession({
          bobSessionId: sessionId,
        });
        opencodeSessionId = opencodeSession.id;
        voiceSession.opencodeSessionId = opencodeSessionId;
      }

      const responseStream = await this.config.opencodeClient.sendMessage(
        opencodeSessionId,
        {
          role: "user",
          content: transcript,
        },
        { stream: true },
      );

      // Collect full response
      let assistantText = "";
      for await (const chunk of responseStream) {
        assistantText += chunk.content;
      }

      // Emit assistant transcript (will be persisted by the router)
      this.emitTranscript(sessionId, {
        type: "assistant",
        text: assistantText,
        timestamp: new Date(),
      });

      // Return text - ElevenLabs SDK will handle TTS
      return assistantText;
    } catch (error) {
      console.error(`[ElevenLabs] Failed to get OpenCode response:`, error);
      throw error;
    }
  }

  /**
   * Register a callback for transcript events
   */
  onTranscript(
    sessionId: string,
    callback: (event: TranscriptEvent) => void,
  ): void {
    this.transcriptCallbacks.set(sessionId, callback);
  }

  /**
   * Stop a voice session
   */
  async stopVoiceSession(sessionId: string): Promise<void> {
    const voiceSession = this.activeSessions.get(sessionId);
    if (!voiceSession) {
      return;
    }

    voiceSession.status = "disconnected";
    this.activeSessions.delete(sessionId);
    this.transcriptCallbacks.delete(sessionId);
  }

  /**
   * Get active voice session
   */
  getSession(sessionId: string): VoiceSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Emit transcript event to registered callbacks
   */
  private emitTranscript(sessionId: string, event: TranscriptEvent): void {
    const callback = this.transcriptCallbacks.get(sessionId);
    if (callback) {
      callback(event);
    }
  }
}

/**
 * Create an ElevenLabs session service instance
 */
export function createElevenLabsSessionService(
  config: Omit<ElevenLabsConfig, "opencodeClient">,
): ElevenLabsSessionService {
  const opencodeClient = createOpenCodeClient();

  return new ElevenLabsSessionService({
    ...config,
    opencodeClient,
  });
}
