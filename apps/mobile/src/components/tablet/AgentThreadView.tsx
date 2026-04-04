import { useRef, useEffect } from "react";
import { Text, View, ScrollView, Pressable } from "react-native";

import type { ServerEvent } from "@bob/ws";
import { colors } from "~/lib/colors";

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

interface AgentThreadViewProps {
  sessionId: string | null;
  events: ServerEvent[];
  onSendInput: (sessionId: string, data: string) => void;
  onStopSession: (sessionId: string) => void;
}

export function AgentThreadView({
  sessionId,
  events,
  onStopSession,
}: AgentThreadViewProps) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new events arrive
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
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Action bar */}
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
        <View className="flex-row">
          <Pressable
            onPress={() => onStopSession(sessionId)}
            className="rounded-md px-3 py-1.5 active:opacity-70"
            style={{
              backgroundColor: colors.danger + "20",
              minHeight: 44,
              justifyContent: "center",
            }}
          >
            <Text className="text-xs font-medium" style={{ color: colors.danger }}>
              Stop
            </Text>
          </Pressable>
        </View>
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
    </View>
  );
}
