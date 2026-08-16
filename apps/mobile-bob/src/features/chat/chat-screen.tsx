import type { ContextPackV1, MemorySeedV1 } from "@gmacko/ooda-client/v1";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Redirect, router } from "expo-router";

import { Screen } from "~/components/ui";
import { authClient } from "~/utils/auth";
import { ContextInspector } from "./components/context-inspector";
import { ConversationDrawer } from "./components/conversation-drawer";
import { MemorySearch } from "./components/memory-search";
import { MessageList } from "./components/message-list";
import { VaultBrowser } from "./components/vault-browser";
import { VoiceInputBar } from "./components/voice-input-bar";
import { findLatestContextPackId } from "./context-inspector-model";
import { useOodaConversation } from "./hooks/use-ooda-conversation";
import { useOodaTts } from "./hooks/use-ooda-tts";
import { useVaultBrowser } from "./hooks/use-vault-browser";
import { buildMemorySearchInput } from "./memory-search-model";

export function ChatScreen() {
  const { data: session, isPending } = authClient.useSession();
  const chat = useOodaConversation();
  const tts = useOodaTts(chat.requestTtsSource);
  const vault = useVaultBrowser();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [vaultVisible, setVaultVisible] = useState(false);
  const [contextVisible, setContextVisible] = useState(false);
  const [contextPack, setContextPack] = useState<ContextPackV1 | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [isContextLoading, setIsContextLoading] = useState(false);
  const [memoryVisible, setMemoryVisible] = useState(false);
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryItems, setMemoryItems] = useState<MemorySeedV1[]>([]);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [isMemoryLoading, setIsMemoryLoading] = useState(false);
  const [hasMemorySearched, setHasMemorySearched] = useState(false);
  const lastSubmittedAtRef = useRef<number | null>(null);
  const spokenEventIdsRef = useRef(new Set<string>());
  const latestContextPackId = findLatestContextPackId(chat.timeline);
  const getContextPack = chat.getContextPack;
  const searchMemories = chat.searchMemories;

  const loadContextPack = useCallback(async () => {
    setContextPack(null);
    setContextError(null);
    if (!latestContextPackId) {
      setIsContextLoading(false);
      return;
    }
    setIsContextLoading(true);
    try {
      setContextPack(await getContextPack(latestContextPackId));
    } catch (caught) {
      setContextError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setIsContextLoading(false);
    }
  }, [getContextPack, latestContextPackId]);

  const openContextInspector = useCallback(() => {
    setContextVisible(true);
    void loadContextPack();
  }, [loadContextPack]);

  const runMemorySearch = useCallback(async () => {
    setMemoryError(null);
    setIsMemoryLoading(true);
    try {
      const page = await searchMemories(buildMemorySearchInput(memoryQuery));
      setMemoryItems(page.items);
      setHasMemorySearched(true);
    } catch (caught) {
      setMemoryError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsMemoryLoading(false);
    }
  }, [memoryQuery, searchMemories]);

  const openMemorySearch = useCallback(() => {
    setMemoryVisible(true);
    void runMemorySearch();
  }, [runMemorySearch]);

  const send = chat.send;
  const handleSend = useCallback(
    (text: string) => {
      lastSubmittedAtRef.current = Date.now();
      void send(text);
    },
    [send],
  );

  const playTts = tts.play;
  useEffect(() => {
    lastSubmittedAtRef.current = null;
    spokenEventIdsRef.current.clear();
  }, [chat.selectedConversationId]);

  useEffect(() => {
    const submittedAt = lastSubmittedAtRef.current;
    if (!submittedAt || chat.selectedConversation?.ttsPolicy !== "allowed")
      return;
    const latest = [...chat.timeline]
      .reverse()
      .find(
        (item) =>
          item.kind === "message" &&
          item.role === "assistant" &&
          item.event?.type === "assistant_turn" &&
          Boolean(item.speakable) &&
          new Date(item.timestamp).getTime() >= submittedAt - 5_000 &&
          !spokenEventIdsRef.current.has(item.event.id),
      );
    if (!latest?.event) return;
    spokenEventIdsRef.current.add(latest.event.id);
    void playTts(latest.event.id, "automatic");
  }, [chat.selectedConversation?.ttsPolicy, chat.timeline, playTts]);

  if (isPending || chat.isLoading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/" />;

  const activeBranch = chat.branches.find(
    (branch) => branch.id === chat.selectedBranchId,
  );
  const statusColor =
    chat.status === "connected"
      ? "bg-success"
      : chat.status === "error"
        ? "bg-danger"
        : "bg-warning";

  return (
    <Screen className="pt-4">
      <View className="mb-4 flex-row items-center justify-between gap-3">
        <Pressable onPress={() => router.back()} className="active:opacity-70">
          <Text className="text-muted text-base font-semibold">Back</Text>
        </Pressable>
        <Pressable
          onPress={() => setDrawerVisible(true)}
          className="min-w-0 flex-1 items-center active:opacity-70"
        >
          <Text
            className="text-foreground text-lg font-semibold"
            numberOfLines={1}
          >
            {chat.selectedConversation?.title ?? "OODA"}
          </Text>
          {activeBranch && activeBranch.name !== "main" ? (
            <Text className="text-accent text-xs" numberOfLines={1}>
              {activeBranch.name}
            </Text>
          ) : null}
        </Pressable>
        <Pressable
          onPress={() => setDrawerVisible(true)}
          className="active:opacity-70"
        >
          <Text className="text-accent text-sm font-semibold">History</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => setDrawerVisible(true)}
        className="bg-card mb-3 flex-row items-center justify-between rounded-xl px-3 py-2 active:opacity-80"
      >
        <View className="flex-row items-center gap-2">
          <View className={`h-2.5 w-2.5 rounded-full ${statusColor}`} />
          <Text className="text-muted text-xs font-semibold">
            {chat.status}
          </Text>
        </View>
        <Text
          className="text-muted2 ml-3 flex-1 text-right text-xs"
          numberOfLines={1}
        >
          {chat.statusText}
        </Text>
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            setVaultVisible(true);
          }}
          className="ml-3 active:opacity-70"
        >
          <Text className="text-accent text-xs font-semibold">Vault</Text>
        </Pressable>
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            openMemorySearch();
          }}
          className="ml-3 active:opacity-70"
        >
          <Text className="text-accent text-xs font-semibold">Memory</Text>
        </Pressable>
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            openContextInspector();
          }}
          className="ml-3 active:opacity-70"
        >
          <Text className="text-accent text-xs font-semibold">Context</Text>
        </Pressable>
      </Pressable>

      <View className="min-h-0 flex-1">
        <MessageList
          items={chat.timeline}
          statusText={
            chat.selectedConversation
              ? "Speak or type naturally. Accepted turns are saved before delivery."
              : "Create a new thought to begin your durable conversation history."
          }
          onRetry={(outboxId) => void chat.retry(outboxId)}
          onSpeak={(item) => {
            if (item.event) void tts.play(item.event.id, "manual");
          }}
        />
      </View>

      {tts.activeEventId ? (
        <View className="border-border bg-card mb-2 flex-row items-center gap-2 rounded-xl border px-3 py-2">
          <Text
            className="text-muted min-w-0 flex-1 text-xs font-semibold"
            numberOfLines={1}
          >
            {tts.error ??
              (tts.isBuffering
                ? "Preparing voice…"
                : tts.isPlaying
                  ? "OODA is speaking"
                  : "Voice ready to replay")}
          </Text>
          {tts.isPlaying || tts.isBuffering ? (
            <Pressable
              onPress={() => void tts.stop()}
              className="active:opacity-70"
            >
              <Text className="text-accent text-xs font-semibold">Stop</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void tts.replay()}
              className="active:opacity-70"
            >
              <Text className="text-accent text-xs font-semibold">Replay</Text>
            </Pressable>
          )}
          <Pressable onPress={tts.cycleRate} className="active:opacity-70">
            <Text className="text-accent text-xs font-semibold">
              {tts.rate}×
            </Text>
          </Pressable>
        </View>
      ) : null}

      {!chat.selectedConversation ? (
        <Pressable
          onPress={() => void chat.createConversation()}
          disabled={!chat.isOnline}
          className="bg-primary mb-3 rounded-2xl py-4 active:opacity-80 disabled:opacity-50"
        >
          <Text className="text-primary-foreground text-center font-semibold">
            {chat.isOnline
              ? "Start a new thought"
              : "Connect once to start a conversation"}
          </Text>
        </Pressable>
      ) : (
        <View className="pt-2 pb-3">
          <VoiceInputBar
            onSend={handleSend}
            disabled={!chat.canSend}
            onBargeIn={tts.stop}
          />
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
      <ContextInspector
        visible={contextVisible}
        expectedPackId={latestContextPackId}
        pack={contextPack}
        isLoading={isContextLoading}
        error={contextError}
        onClose={() => setContextVisible(false)}
        onRetry={() => void loadContextPack()}
      />
      <MemorySearch
        visible={memoryVisible}
        query={memoryQuery}
        items={memoryItems}
        isLoading={isMemoryLoading}
        hasSearched={hasMemorySearched}
        error={memoryError}
        onQueryChange={setMemoryQuery}
        onSearch={() => void runMemorySearch()}
        onClose={() => setMemoryVisible(false)}
      />
    </Screen>
  );
}
