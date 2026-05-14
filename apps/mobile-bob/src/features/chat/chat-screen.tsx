import { Redirect, router } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Screen } from "~/components/ui";
import { colors } from "~/lib/colors";
import { authClient } from "~/utils/auth";

import { MessageList } from "./components/message-list";
import { ModeToggle } from "./components/mode-toggle";
import { OracleResults } from "./components/oracle-results";
import { ThreadPicker } from "./components/thread-picker";
import { VoiceInputBar } from "./components/voice-input-bar";
import { useAgentMode } from "./hooks/use-agent-mode";
import { useBobChat } from "./hooks/use-bob-chat";
import { useOodaChat } from "./hooks/use-ooda-chat";
import { useOracleSearch } from "./hooks/use-oracle-search";

const SLASH_SEARCH = /^\/search\s+/i;

export function ChatScreen() {
  const { data: session, isPending } = authClient.useSession();
  const { mode, isLoading: modeLoading, setMode } = useAgentMode();
  const bobChat = useBobChat(mode === "bob");
  const oodaChat = useOodaChat(mode === "ooda");
  const oracle = useOracleSearch();
  const [threadPickerVisible, setThreadPickerVisible] = useState(false);
  const activeChat = mode === "bob" ? bobChat : oodaChat;
  const canSend = activeChat.status === "connected";

  const handleSend = useCallback(
    (text: string) => {
      if (mode === "ooda" && SLASH_SEARCH.test(text)) {
        oracle.search(text.replace(SLASH_SEARCH, "").trim());
        return;
      }
      activeChat.send(text);
    },
    [activeChat, mode, oracle],
  );

  if (isPending || modeLoading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!session) {
    return <Redirect href="/" />;
  }

  return (
    <Screen className="pt-4">
      <View className="mb-4 flex-row items-center justify-between">
        <Pressable onPress={() => router.back()} className="active:opacity-70">
          <Text className="text-base font-semibold" style={{ color: colors.muted }}>
            Back
          </Text>
        </Pressable>
        <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>
          Agent Chat
        </Text>
        <ModeToggle mode={mode} onChange={setMode} />
      </View>

      <Pressable
        onPress={() => {
          if (mode === "ooda") setThreadPickerVisible(true);
        }}
        disabled={mode !== "ooda"}
        className="mb-3 flex-row items-center justify-between rounded-xl bg-card px-3 py-2 active:opacity-80"
      >
        <View className="flex-row items-center gap-2">
          <View
            className={`h-2.5 w-2.5 rounded-full ${
              activeChat.status === "connected"
                ? "bg-success"
                : activeChat.status === "error"
                  ? "bg-danger"
                  : "bg-warning"
            }`}
          />
          <Text className="text-xs font-semibold" style={{ color: colors.muted }}>
            {activeChat.status}
          </Text>
        </View>
        <Text
          className="ml-3 flex-1 text-right text-xs"
          numberOfLines={1}
          style={{ color: colors.muted2 }}
        >
          {activeChat.statusText}
        </Text>
        {mode === "ooda" ? (
          <Text className="ml-2 text-xs" style={{ color: colors.accent }}>
            Threads
          </Text>
        ) : null}
      </Pressable>

      {oracle.results.length > 0 || oracle.isSearching || oracle.error ? (
        <View className="mb-3">
          <OracleResults
            results={oracle.results}
            query={oracle.lastQuery}
            latencyMs={oracle.latencyMs}
            isSearching={oracle.isSearching}
            error={oracle.error}
            onClose={oracle.clear}
          />
        </View>
      ) : null}

      <View className="min-h-0 flex-1">
        <MessageList
          messages={activeChat.messages}
          isStreaming={activeChat.isStreaming}
          statusText={activeChat.statusText}
          onPromote={activeChat.promote}
        />
      </View>

      <View className="pb-3 pt-2">
        <VoiceInputBar onSend={handleSend} disabled={!canSend} />
      </View>

      {mode === "ooda" ? (
        <ThreadPicker
          threads={oodaChat.threads}
          selectedId={oodaChat.selectedThreadId}
          onSelect={oodaChat.selectThread}
          onCreate={oodaChat.createThread}
          visible={threadPickerVisible}
          onClose={() => setThreadPickerVisible(false)}
        />
      ) : null}
    </Screen>
  );
}
