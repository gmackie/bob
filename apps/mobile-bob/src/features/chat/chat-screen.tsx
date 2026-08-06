import { Redirect, router } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Screen } from "~/components/ui";
import { authClient } from "~/utils/auth";

import { ConversationDrawer } from "./components/conversation-drawer";
import { MessageList } from "./components/message-list";
import { VaultBrowser } from "./components/vault-browser";
import { VoiceInputBar } from "./components/voice-input-bar";
import { useOodaConversation } from "./hooks/use-ooda-conversation";
import { useVaultBrowser } from "./hooks/use-vault-browser";

export function ChatScreen() {
  const { data: session, isPending } = authClient.useSession();
  const chat = useOodaConversation();
  const vault = useVaultBrowser();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [vaultVisible, setVaultVisible] = useState(false);

  const send = chat.send;
  const handleSend = useCallback((text: string) => {
    void send(text);
  }, [send]);

  if (isPending || chat.isLoading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/" />;

  const activeBranch = chat.branches.find((branch) => branch.id === chat.selectedBranchId);
  const statusColor = chat.status === "connected"
    ? "bg-success"
    : chat.status === "error"
      ? "bg-danger"
      : "bg-warning";

  return (
    <Screen className="pt-4">
      <View className="mb-4 flex-row items-center justify-between gap-3">
        <Pressable onPress={() => router.back()} className="active:opacity-70">
          <Text className="text-base font-semibold text-muted">Back</Text>
        </Pressable>
        <Pressable
          onPress={() => setDrawerVisible(true)}
          className="min-w-0 flex-1 items-center active:opacity-70"
        >
          <Text className="text-lg font-semibold text-foreground" numberOfLines={1}>
            {chat.selectedConversation?.title ?? "OODA"}
          </Text>
          {activeBranch && activeBranch.name !== "main" ? (
            <Text className="text-xs text-accent" numberOfLines={1}>{activeBranch.name}</Text>
          ) : null}
        </Pressable>
        <Pressable onPress={() => setDrawerVisible(true)} className="active:opacity-70">
          <Text className="text-sm font-semibold text-accent">History</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => setDrawerVisible(true)}
        className="mb-3 flex-row items-center justify-between rounded-xl bg-card px-3 py-2 active:opacity-80"
      >
        <View className="flex-row items-center gap-2">
          <View className={`h-2.5 w-2.5 rounded-full ${statusColor}`} />
          <Text className="text-xs font-semibold text-muted">{chat.status}</Text>
        </View>
        <Text className="ml-3 flex-1 text-right text-xs text-muted2" numberOfLines={1}>
          {chat.statusText}
        </Text>
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            setVaultVisible(true);
          }}
          className="ml-3 active:opacity-70"
        >
          <Text className="text-xs font-semibold text-accent">Vault</Text>
        </Pressable>
      </Pressable>

      <View className="min-h-0 flex-1">
        <MessageList
          items={chat.timeline}
          statusText={chat.selectedConversation
            ? "Speak or type naturally. Accepted turns are saved before delivery."
            : "Create a new thought to begin your durable conversation history."}
          onRetry={(outboxId) => void chat.retry(outboxId)}
        />
      </View>

      {!chat.selectedConversation ? (
        <Pressable
          onPress={() => void chat.createConversation()}
          disabled={!chat.isOnline}
          className="mb-3 rounded-2xl bg-primary py-4 active:opacity-80 disabled:opacity-50"
        >
          <Text className="text-center font-semibold text-primary-foreground">
            {chat.isOnline ? "Start a new thought" : "Connect once to start a conversation"}
          </Text>
        </Pressable>
      ) : (
        <View className="pb-3 pt-2">
          <VoiceInputBar onSend={handleSend} disabled={!chat.canSend} />
        </View>
      )}

      <ConversationDrawer
        visible={drawerVisible}
        conversations={chat.conversations}
        branches={chat.branches}
        selectedConversationId={chat.selectedConversationId}
        selectedBranchId={chat.selectedBranchId}
        pinnedIds={chat.pinnedIds}
        onClose={() => setDrawerVisible(false)}
        onSelectConversation={chat.openConversation}
        onSelectBranch={chat.selectBranch}
        onCreate={chat.createConversation}
        onTogglePin={chat.togglePin}
      />
      <VaultBrowser
        vault={vault}
        visible={vaultVisible}
        onClose={() => setVaultVisible(false)}
      />
    </Screen>
  );
}
