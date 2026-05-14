import { Redirect, router } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Screen } from "~/components/ui";
import { colors } from "~/lib/colors";
import { authClient } from "~/utils/auth";

import { MessageList } from "./components/message-list";
import { ModeToggle } from "./components/mode-toggle";
import { VoiceInputBar } from "./components/voice-input-bar";
import { useAgentMode } from "./hooks/use-agent-mode";
import { useBobChat } from "./hooks/use-bob-chat";
import { useOodaChat } from "./hooks/use-ooda-chat";

export function ChatScreen() {
  const { data: session, isPending } = authClient.useSession();
  const { mode, isLoading: modeLoading, setMode } = useAgentMode();
  const bobChat = useBobChat(mode === "bob");
  const oodaChat = useOodaChat(mode === "ooda");
  const activeChat = mode === "bob" ? bobChat : oodaChat;
  const canSend = activeChat.status === "connected";

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

      <View className="mb-3 flex-row items-center justify-between rounded-xl bg-card px-3 py-2">
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
      </View>

      <View className="min-h-0 flex-1">
        <MessageList
          messages={activeChat.messages}
          isStreaming={activeChat.isStreaming}
          statusText={activeChat.statusText}
          onPromote={activeChat.promote}
        />
      </View>

      <View className="pb-3 pt-2">
        <VoiceInputBar onSend={activeChat.send} disabled={!canSend} />
      </View>
    </Screen>
  );
}
