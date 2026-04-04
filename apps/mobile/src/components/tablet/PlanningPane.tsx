import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";

import type { ServerEvent } from "@bob/ws";
import { colors } from "~/lib/colors";

// ---------------------------------------------------------------------------
// Event rendering
// ---------------------------------------------------------------------------

function toDisplayText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/**
 * Collapse output_chunk events into message bubbles.
 * Groups consecutive agent output_chunks, then renders message_final as complete messages.
 */
interface ChatMessage {
  id: string;
  role: "agent" | "user" | "system";
  content: string;
  isToolCall?: boolean;
  toolName?: string;
}

function eventsToChatMessages(events: ServerEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let currentAgentChunks: string[] = [];
  let lastSeq = 0;

  const flushAgent = () => {
    if (currentAgentChunks.length > 0) {
      messages.push({
        id: `agent-${lastSeq}`,
        role: "agent",
        content: currentAgentChunks.join(""),
      });
      currentAgentChunks = [];
    }
  };

  for (const event of events) {
    lastSeq = event.seq;

    if (event.eventType === "output_chunk" && event.direction === "agent") {
      currentAgentChunks.push(toDisplayText(event.payload.data));
      continue;
    }

    if (event.eventType === "message_final" && event.direction === "agent") {
      // message_final replaces accumulated chunks
      currentAgentChunks = [];
      messages.push({
        id: `msg-${event.seq}`,
        role: "agent",
        content: toDisplayText(event.payload.content),
      });
      continue;
    }

    if (event.eventType === "input" && event.direction === "client") {
      flushAgent();
      messages.push({
        id: `input-${event.seq}`,
        role: "user",
        content: toDisplayText(event.payload.data),
      });
      continue;
    }

    if (event.eventType === "tool_call" && event.direction === "agent") {
      flushAgent();
      messages.push({
        id: `tool-${event.seq}`,
        role: "agent",
        content: toDisplayText(event.payload.name),
        isToolCall: true,
        toolName: toDisplayText(event.payload.name),
      });
      continue;
    }

    if (event.eventType === "tool_result" && event.direction === "agent") {
      // Skip — tool results are shown inline with tool calls
      continue;
    }
  }

  flushAgent();
  return messages;
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  if (message.isToolCall) {
    return (
      <View className="mx-4 my-1 flex-row items-center rounded-md px-3 py-2" style={{ backgroundColor: colors.secondary }}>
        <Text className="text-xs font-mono" style={{ color: colors.accent }}>
          {message.toolName}
        </Text>
      </View>
    );
  }

  return (
    <View
      className={`mx-4 my-1 rounded-xl px-4 py-3 ${isUser ? "self-end" : "self-start"}`}
      style={{
        backgroundColor: isUser ? colors.primary : colors.card,
        maxWidth: "85%",
      }}
    >
      <Text
        className="text-sm leading-5"
        style={{ color: isUser ? colors.primaryForeground : colors.foreground }}
      >
        {message.content}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Artifact extraction
// ---------------------------------------------------------------------------

function extractArtifactContent(events: ServerEvent[]): string | null {
  const parts: string[] = [];
  for (const event of events) {
    if (event.direction !== "agent") continue;
    if (event.eventType === "output_chunk") {
      const text = toDisplayText(event.payload.data);
      if (text) parts.push(text);
    }
    if (event.eventType === "message_final") {
      const text = toDisplayText(event.payload.content);
      if (text) parts.push(text);
    }
  }
  const combined = parts.join("").trim();
  return combined.length > 0 ? combined : null;
}

// ---------------------------------------------------------------------------
// PlanningPane
// ---------------------------------------------------------------------------

interface PlanningPaneProps {
  sessionId: string;
  sessionStatus: string;
  sessionType: string | null;
  workItemTitle: string;
  events: ServerEvent[];
  onSendInput: (sessionId: string, data: string) => void;
  onStopSession: (sessionId: string) => void;
  onShowArtifact?: (content: string) => void;
}

export function PlanningPane({
  sessionId,
  sessionStatus,
  sessionType,
  workItemTitle,
  events,
  onSendInput,
  onStopSession,
  onShowArtifact,
}: PlanningPaneProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [inputText, setInputText] = useState("");

  const messages = useMemo(() => eventsToChatMessages(events), [events]);
  const artifactContent = useMemo(() => extractArtifactContent(events), [events]);

  const isActive = sessionStatus === "running" || sessionStatus === "idle" || sessionStatus === "starting";
  const isStarting = sessionStatus === "provisioning" || sessionStatus === "starting";

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    onSendInput(sessionId, text);
    setInputText("");
  }, [inputText, sessionId, onSendInput]);

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View
        className="flex-row items-center justify-between px-4 py-2"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        <View className="flex-1 mr-3">
          <Text className="text-sm font-medium" style={{ color: colors.foreground }} numberOfLines={1}>
            {sessionType ?? "Planning"} — {workItemTitle}
          </Text>
          <View className="mt-0.5 flex-row items-center">
            <View
              style={{
                width: 6, height: 6, borderRadius: 3, marginRight: 6,
                backgroundColor:
                  isActive ? colors.success
                  : sessionStatus === "error" ? colors.danger
                  : isStarting ? colors.warning
                  : colors.muted2,
              }}
            />
            <Text className="text-xs" style={{ color: colors.muted }}>
              {sessionStatus}
            </Text>
          </View>
        </View>
        <View className="flex-row items-center">
          {artifactContent && onShowArtifact && (
            <Pressable
              onPress={() => onShowArtifact(artifactContent)}
              className="mr-2 rounded-md px-3 py-1.5 active:opacity-70"
              style={{ backgroundColor: colors.accent + "20", minHeight: 44, justifyContent: "center" }}
            >
              <Text className="text-xs font-medium" style={{ color: colors.accent }}>Artifact</Text>
            </Pressable>
          )}
          {isActive && (
            <Pressable
              onPress={() => onStopSession(sessionId)}
              className="rounded-md px-3 py-1.5 active:opacity-70"
              style={{ backgroundColor: colors.danger + "20", minHeight: 44, justifyContent: "center" }}
            >
              <Text className="text-xs font-medium" style={{ color: colors.danger }}>End</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Message stream */}
      <ScrollView ref={scrollRef} className="flex-1 py-2">
        {isStarting && messages.length === 0 && (
          <View className="items-center justify-center py-12">
            <ActivityIndicator color={colors.muted} />
            <Text className="mt-3 text-sm" style={{ color: colors.muted }}>Starting session...</Text>
          </View>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </ScrollView>

      {/* Input */}
      {isActive && (
        <View
          className="flex-row items-center px-4 py-2"
          style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card }}
        >
          <TextInput
            className="mr-2 flex-1 rounded-md px-3 py-2 text-sm"
            style={{ backgroundColor: colors.secondary, color: colors.foreground, minHeight: 44 }}
            placeholder="Message..."
            placeholderTextColor={colors.muted2}
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          <Pressable
            onPress={handleSend}
            className="rounded-md px-4 py-2 active:opacity-70"
            style={{ backgroundColor: colors.primary, minHeight: 44, justifyContent: "center" }}
          >
            <Text className="text-sm font-medium" style={{ color: colors.primaryForeground }}>Send</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
