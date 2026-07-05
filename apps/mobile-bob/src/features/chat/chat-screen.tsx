import { Redirect, router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Screen } from "~/components/ui";
import { env } from "~/config/env";
import { authClient } from "~/utils/auth";

import type { ChatMessage } from "./chat-messages";
import { MessageList } from "./components/message-list";
import { ModeToggle } from "./components/mode-toggle";
import { OracleResults } from "./components/oracle-results";
import { ThreadPicker } from "./components/thread-picker";
import { VaultBrowser } from "./components/vault-browser";
import { VoiceInputBar } from "./components/voice-input-bar";
import { useAgentMode } from "./hooks/use-agent-mode";
import { useBobChat } from "./hooks/use-bob-chat";
import { useOodaChat } from "./hooks/use-ooda-chat";
import { useOracleSearch } from "./hooks/use-oracle-search";
import { useVaultBrowser } from "./hooks/use-vault-browser";
import type { CommandContext } from "./slash-commands";
import { executeSlashCommand, parseSlashCommand } from "./slash-commands";

export function ChatScreen() {
  const { data: session, isPending } = authClient.useSession();
  const { mode, isLoading: modeLoading, setMode } = useAgentMode();
  const bobChat = useBobChat(mode === "bob");
  const oodaChat = useOodaChat(mode === "ooda");
  const oracle = useOracleSearch();
  const vault = useVaultBrowser();
  const [threadPickerVisible, setThreadPickerVisible] = useState(false);
  const [vaultVisible, setVaultVisible] = useState(false);
  const [commandMessages, setCommandMessages] = useState<ChatMessage[]>([]);
  const activeChat = mode === "bob" ? bobChat : oodaChat;
  const canSend = activeChat.status === "connected" || mode === "ooda";

  const commandContext = useMemo<CommandContext>(
    () => ({
      oodaBaseUrl: env.oodaApiUrl,
      getCookies: () => authClient.getCookie(),
      threadId: oodaChat.selectedThreadId ?? undefined,
    }),
    [oodaChat.selectedThreadId],
  );

  const allMessages = useMemo(
    () => [...activeChat.messages, ...commandMessages],
    [activeChat.messages, commandMessages],
  );

  const handleSend = useCallback(
    async (text: string) => {
      if (mode === "ooda" && parseSlashCommand(text)) {
        const result = await executeSlashCommand(text, commandContext);
        const resultMessages = result.messages;
        if (result.handled && resultMessages) {
          setCommandMessages((prev) => [...prev, ...resultMessages]);
        }
        return;
      }
      activeChat.send(text);
    },
    [activeChat, commandContext, mode],
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
          <Text className="text-base font-semibold text-muted">
            Back
          </Text>
        </Pressable>
        <Text className="text-lg font-semibold text-foreground">
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
          <Text className="text-xs font-semibold text-muted">
            {activeChat.status}
          </Text>
        </View>
        <Text
          className="ml-3 flex-1 text-right text-xs text-muted2"
          numberOfLines={1}
        >
          {activeChat.statusText}
        </Text>
        {mode === "ooda" ? (
          <View className="ml-2 flex-row items-center gap-2">
            <Pressable
              onPress={() => setVaultVisible(true)}
              className="active:opacity-70"
            >
              <Text className="text-xs text-accent">
                Vault
              </Text>
            </Pressable>
            <Text className="text-xs text-accent">
              Threads
            </Text>
          </View>
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
          messages={allMessages}
          isStreaming={activeChat.isStreaming}
          statusText={activeChat.statusText}
          onPromote={activeChat.promote}
        />
      </View>

      <View className="pb-3 pt-2">
        <VoiceInputBar onSend={handleSend} disabled={!canSend} />
      </View>

      {mode === "ooda" ? (
        <>
          <ThreadPicker
            threads={oodaChat.threads}
            selectedId={oodaChat.selectedThreadId}
            onSelect={oodaChat.selectThread}
            onCreate={oodaChat.createThread}
            visible={threadPickerVisible}
            onClose={() => setThreadPickerVisible(false)}
          />
          <VaultBrowser
            vault={vault}
            visible={vaultVisible}
            onClose={() => setVaultVisible(false)}
          />
        </>
      ) : null}
    </Screen>
  );
}
