import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import type { ServerEvent } from "@bob/ws";

import { extractSessionEventText } from "~/features/chat/session-event-text";
import { colors } from "~/lib/colors";
import { hapticMedium, hapticSuccess } from "~/lib/haptics";

/**
 * The full event stream of one session, with an input bar.
 *
 * This is the "read everything" view. The summary (SessionSummaryView) is the
 * "what happened" view; approvals live there, driven by the gateway's
 * permission_request/permission_resolved lifecycle events. An earlier version
 * of this component also guessed at approvals from unmatched tool_call events
 * and answered them by sending a raw "y"/"n" as input — which flagged every
 * in-flight tool as "awaiting approval" and could feed stray keystrokes to a
 * running agent. That path is gone.
 */

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : null;
}

function formatEventType(eventType: string): string {
  switch (eventType) {
    case "output_chunk":
      return "Output";
    case "message_final":
      return "Message";
    case "tool_call":
      return "Tool Call";
    case "tool_result":
      return "Tool Result";
    case "state":
      return "State";
    case "error":
      return "Error";
    case "input":
      return "Input";
    case "thought":
      return "Thinking";
    case "check":
      return "Check";
    case "status_change":
      return "Status";
    case "permission_request":
      return "Approval";
    case "permission_resolved":
      return "Approval";
    default:
      return eventType;
  }
}

function EventRow({ event }: { event: ServerEvent }) {
  if (event.eventType === "planning_drafts") return null;
  const payload = event.payload;
  let content = extractSessionEventText(event.eventType, payload);

  switch (event.eventType) {
    case "tool_result":
      content = content.slice(0, 200);
      break;
    case "status_change":
      content = typeof payload.status === "string" ? payload.status : content;
      break;
    case "permission_request":
      content =
        typeof payload.toolName === "string"
          ? `Requested ${payload.toolName}`
          : "Requested";
      break;
    case "permission_resolved":
      content =
        typeof payload.decision === "string" ? payload.decision : "Resolved";
      break;
    case "check": {
      // Structured check progress has no prose field; say which phase and
      // where it stands rather than leaving the row blank.
      const phase = typeof payload.phase === "string" ? payload.phase : "check";
      const status = typeof payload.status === "string" ? payload.status : "";
      content = status ? `${phase}: ${status}` : phase;
      break;
    }
    case "output_chunk":
    case "message_final":
    case "tool_call":
    case "state":
    case "error":
    case "input":
      break;
    default:
      content = content.slice(0, 100);
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
          <Text className="text-muted2 ml-2 text-xs">#{event.seq}</Text>
        </View>
        <Text className="text-muted2 text-xs">{event.direction}</Text>
      </View>
      {content ? (
        <Text className="text-foreground text-sm" numberOfLines={5}>
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
      onPress={() => {
        hapticMedium();
        onPress();
      }}
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

interface AgentThreadViewProps {
  sessionId: string | null;
  events: ServerEvent[];
  onSendInput: (sessionId: string, data: string) => void;
  onStopSession: (sessionId: string) => void;
  /** Human title for the header; falls back to a short id. */
  title?: string | null;
  /** Hide the header when the surrounding screen already draws one. */
  showHeader?: boolean;
  /** Hide the Stop control once a session has ended. */
  canStop?: boolean;
}

export function AgentThreadView({
  sessionId,
  events,
  onSendInput,
  onStopSession,
  title,
  showHeader = true,
  canStop = true,
}: AgentThreadViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [inputText, setInputText] = useState("");

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [events.length]);

  if (!sessionId) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.background }}
      >
        <Text className="text-muted text-lg">Select an agent session</Text>
        <Text className="text-muted2 mt-1 text-sm">
          Tap a session in the sidebar to view its event stream
        </Text>
      </View>
    );
  }

  const submit = () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    hapticSuccess();
    onSendInput(sessionId, trimmed);
    setInputText("");
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {showHeader ? (
        <View
          className="flex-row items-center justify-between px-4 py-2"
          style={{
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Text
            className="text-foreground min-w-0 flex-1 pr-3 text-sm font-medium"
            numberOfLines={1}
          >
            {nonEmpty(title) ?? `${sessionId.slice(0, 8)}…`}
          </Text>
          {canStop ? (
            <ActionButton
              label="Stop"
              color={colors.danger}
              onPress={() => onStopSession(sessionId)}
            />
          ) : null}
        </View>
      ) : null}

      {/* Event stream */}
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        testID="agent-thread-events"
      >
        {events.length === 0 ? (
          <View className="items-center justify-center py-12">
            <Text className="text-muted text-sm">Waiting for events...</Text>
          </View>
        ) : (
          events.map((event, i) => (
            <EventRow key={`${event.seq}-${i}`} event={event} />
          ))
        )}
      </ScrollView>

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
          onSubmitEditing={submit}
          returnKeyType="send"
        />
        <Pressable
          onPress={submit}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          className="rounded-md px-4 py-2 active:opacity-70"
          style={{
            backgroundColor: colors.primary,
            minHeight: 44,
            justifyContent: "center",
          }}
        >
          <Text className="text-primary-foreground text-sm font-medium">
            Send
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
