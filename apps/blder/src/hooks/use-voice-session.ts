/**
 * Voice Session Hook
 *
 * Manages ElevenLabs voice conversations in the browser using the ElevenLabs Client SDK.
 * Handles WebRTC connection, transcript events, and TTS playback.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface VoiceSessionState {
  status: "disconnected" | "connecting" | "connected" | "error";
  isRecording: boolean;
  error?: string;
}

export function useVoiceSession(sessionId: string | null, agentType?: string) {
  const [state, setState] = useState<VoiceSessionState>({
    status: "disconnected",
    isRecording: false,
  });
  const conversationRef = useRef<any>(null);

  const startVoice = useCallback(async () => {
    if (!sessionId || agentType !== "elevenlabs") {
      return;
    }

    setState({ status: "connecting", isRecording: false });

    try {
      const { Conversation } = await import("@elevenlabs/client");

      const createRes = await fetch("/api/v1/chat/conversations", {
        method: "POST",
      });

      if (!createRes.ok) {
        throw new Error("Failed to create chat conversation");
      }

      const createJson = (await createRes.json()) as { id?: string };
      const bobConversationId = createJson.id;
      if (!bobConversationId) {
        throw new Error("Missing conversation id");
      }

      const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
      if (!agentId) {
        throw new Error("Missing NEXT_PUBLIC_ELEVENLABS_AGENT_ID");
      }

      const conversation = await Conversation.startSession({
        agentId,
        connectionType: "webrtc",
        onConnect: () => {
          setState({ status: "connected", isRecording: true });
        },
        onDisconnect: () => {
          setState({ status: "disconnected", isRecording: false });
        },
        onError: (message: string) => {
          setState({
            status: "error",
            isRecording: false,
            error: message,
          });
        },
      });

      conversation.sendContextualUpdate(
        `bobConversationId:${bobConversationId}`,
      );

      conversationRef.current = conversation;
    } catch (error) {
      setState({
        status: "error",
        isRecording: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, [sessionId, agentType]);

  const stopVoice = useCallback(async () => {
    if (!sessionId) return;

    try {
      // End ElevenLabs conversation
      if (conversationRef.current) {
        await conversationRef.current.endSession();
        conversationRef.current = null;
      }

      setState({ status: "disconnected", isRecording: false });
    } catch (error) {
      console.error("Failed to stop voice session:", error);
    }
  }, [sessionId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (conversationRef.current) {
        conversationRef.current.endSession().catch(console.error);
      }
    };
  }, []);

  return {
    state,
    startVoice,
    stopVoice,
  };
}
