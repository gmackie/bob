import { useRef, useEffect, useMemo, useState } from "react";
import { Text, View, ScrollView, Pressable, TextInput, KeyboardAvoidingView, Platform } from "react-native";

import type { ServerEvent } from "@bob/ws";
import { colors } from "~/lib/colors";
import { hapticMedium, hapticSuccess } from "~/lib/haptics";

function formatEventType(eventType: string): string {
  switch (eventType) {
    case "output_chunk": return "Output";
    case "message_final": return "Message";
    case "tool_call": return "Tool Call";
    case "tool_result": return "Tool Result";
    case "state": return "State";
    case "error": return "Error";
    case "input": return "Input";
    default: return eventType;
  }
}

function EventRow({ event }: { event: ServerEvent }) {
  const payload = event.payload;
  let content = "";

  switch (event.eventType) {
    case "output_chunk":
      content = (payload.data as string) ?? "";
      break;
    case "message_final":
      content = (payload.content as string) ?? "";
      break;
    case "tool_call":
      content = `${payload.name as string}(${((payload.arguments as string) ?? "").slice(0, 80)})`;
      break;
    case "tool_result": {
      const result = (payload.result as string) ?? "";
      content = payload.isError ? `Error: ${result}` : result.slice(0, 200);
      break;
    }
    case "state":
      content = `Status: ${payload.status as string}${payload.reason ? ` — ${payload.reason}` : ""}`;
      break;
    case "error":
      content = `${payload.code as string}: ${payload.message as string}`;
      break;
    case "input":
      content = (payload.data as string) ?? "";
      break;
    default:
      content = JSON.stringify(payload).slice(0, 100);
  }

  const isAgent = event.direction === "agent";
  const isError = event.eventType === "error";

  return (
    <View
      className="px-4 py-2"
      style={{
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View className="mb-1 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <Text
            className="text-xs font-semibold"
            style={{
              color: isError
                ? colors.danger
                : isAgent
                  ? colors.accent
                  : colors.primary,
            }}
          >
            {formatEventType(event.eventType)}
          </Text>
          <Text className="ml-2 text-xs" style={{ color: colors.muted2 }}>
            #{event.seq}
          </Text>
        </View>
        <Text className="text-xs" style={{ color: colors.muted2 }}>
          {event.direction}
        </Text>
      </View>
      {content ? (
        <Text
          className="text-sm"
          style={{ color: colors.foreground }}
          numberOfLines={5}
        >
          {content}
        </Text>
      ) : null}
    </View>
  );
}

function ActionButton({
  label,
  color,
  onPress,
}: {
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => { hapticMedium(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="mr-2 rounded-md px-4 py-2 active:opacity-70"
      style={{
        backgroundColor: color + "20",
        minHeight: 44,
        justifyContent: "center",
      }}
    >
      <Text className="text-sm font-medium" style={{ color }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Detect if the agent is waiting for tool approval.
 * A tool_call without a subsequent tool_result means it's pending.
 */
function usePendingToolCall(events: ServerEvent[]): ServerEvent | null {
  return useMemo(() => {
    const toolCalls = new Map<string, ServerEvent>();

    for (const event of events) {
      if (event.eventType === "tool_call" && event.payload.toolCallId) {
        toolCalls.set(event.payload.toolCallId as string, event);
      }
      if (event.eventType === "tool_result" && event.payload.toolCallId) {
        toolCalls.delete(event.payload.toolCallId as string);
      }
    }

    // Return the most recent pending tool call
    const pending = Array.from(toolCalls.values());
    return pending.length > 0 ? pending[pending.length - 1]! : null;
  }, [events]);
}

interface AgentThreadViewProps {
  sessionId: string | null;
  events: ServerEvent[];
  onSendInput: (sessionId: string, data: string) => void;
  onStopSession: (sessionId: string) => void;
}

export function AgentThreadView({
  sessionId,
  events,
  onSendInput,
  onStopSession,
}: AgentThreadViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [inputText, setInputText] = useState("");
  const pendingToolCall = usePendingToolCall(events);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [events.length]);

  if (!sessionId) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.background }}
      >
        <Text className="text-lg" style={{ color: colors.muted }}>
          Select an agent session
        </Text>
        <Text className="mt-1 text-sm" style={{ color: colors.muted2 }}>
          Tap a session in the sidebar to view its event stream
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View
        className="flex-row items-center justify-between px-4 py-2"
        style={{
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Text className="text-sm font-medium" style={{ color: colors.foreground }}>
          {sessionId.slice(0, 8)}...
        </Text>
        <ActionButton label="Stop" color={colors.danger} onPress={() => onStopSession(sessionId)} />
      </View>

      {/* Event stream */}
      <ScrollView ref={scrollRef} className="flex-1">
        {events.length === 0 ? (
          <View className="items-center justify-center py-12">
            <Text className="text-sm" style={{ color: colors.muted }}>
              Waiting for events...
            </Text>
          </View>
        ) : (
          events.map((event, i) => <EventRow key={`${event.seq}-${i}`} event={event} />)
        )}
      </ScrollView>

      {/* Approval bar — shown when a tool call is pending */}
      {pendingToolCall && (
        <View
          className="px-4 py-3"
          style={{
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <Text className="mb-2 text-xs" style={{ color: colors.muted }}>
            Awaiting approval: {pendingToolCall.payload.name as string}
          </Text>
          <View className="flex-row">
            <ActionButton
              label="Approve"
              color={colors.success}
              onPress={() => onSendInput(sessionId, "y")}
            />
            <ActionButton
              label="Reject"
              color={colors.danger}
              onPress={() => onSendInput(sessionId, "n")}
            />
          </View>
        </View>
      )}

      {/* Input bar */}
      <View
        className="flex-row items-center px-4 py-2"
        style={{
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        <TextInput
          className="mr-2 flex-1 rounded-md px-3 py-2 text-sm"
          style={{
            backgroundColor: colors.secondary,
            color: colors.foreground,
            minHeight: 44,
          }}
          placeholder="Send input to agent..."
          placeholderTextColor={colors.muted2}
          accessibilityLabel="Agent input"
          accessibilityHint="Type a message to send to the agent"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={() => {
            if (inputText.trim()) {
              onSendInput(sessionId, inputText.trim());
              setInputText("");
            }
          }}
          returnKeyType="send"
        />
        <Pressable
          onPress={() => {
            if (inputText.trim()) {
              hapticSuccess();
              onSendInput(sessionId, inputText.trim());
              setInputText("");
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          className="rounded-md px-4 py-2 active:opacity-70"
          style={{
            backgroundColor: colors.primary,
            minHeight: 44,
            justifyContent: "center",
          }}
        >
          <Text className="text-sm font-medium" style={{ color: colors.primaryForeground }}>
            Send
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
