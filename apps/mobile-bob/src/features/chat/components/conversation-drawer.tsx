import type {
  ConversationBranchV1,
  ConversationV1,
} from "@gmacko/ooda-client/v1";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { LegendList } from "@legendapp/list";

import { colors } from "~/lib/colors";

interface ConversationDrawerProps {
  visible: boolean;
  conversations: ConversationV1[];
  branches: ConversationBranchV1[];
  selectedConversationId: string | null;
  selectedBranchId: string | null;
  pinnedIds: string[];
  canFork: boolean;
  onClose: () => void;
  onSelectConversation: (conversationId: string) => Promise<void> | void;
  onSelectBranch: (branchId: string) => void;
  onCreate: () => Promise<unknown>;
  onFork: (name: string, reason?: string) => Promise<unknown>;
  onTogglePin: (conversationId: string) => Promise<void> | void;
}

function updatedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ConversationDrawer({
  visible,
  conversations,
  branches,
  selectedConversationId,
  selectedBranchId,
  pinnedIds,
  canFork,
  onClose,
  onSelectConversation,
  onSelectBranch,
  onCreate,
  onFork,
  onTogglePin,
}: ConversationDrawerProps) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [forking, setForking] = useState(false);
  const [showForkForm, setShowForkForm] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [branchReason, setBranchReason] = useState("");
  const [forkError, setForkError] = useState<string | null>(null);

  const resetForkForm = useCallback(() => {
    setShowForkForm(false);
    setBranchName("");
    setBranchReason("");
    setForkError(null);
  }, []);
  const close = useCallback(() => {
    resetForkForm();
    onClose();
  }, [onClose, resetForkForm]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return conversations
      .filter(
        (conversation) =>
          !normalized ||
          conversation.title.toLocaleLowerCase().includes(normalized),
      )
      .sort((left, right) => {
        const leftPinned = pinnedIds.includes(left.id) ? 1 : 0;
        const rightPinned = pinnedIds.includes(right.id) ? 1 : 0;
        return (
          rightPinned - leftPinned ||
          right.updatedAt.localeCompare(left.updatedAt)
        );
      });
  }, [conversations, pinnedIds, query]);

  const create = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      await onCreate();
      close();
    } finally {
      setCreating(false);
    }
  }, [close, creating, onCreate]);

  const fork = useCallback(async () => {
    const name = branchName.trim();
    if (!name || forking) return;
    setForking(true);
    setForkError(null);
    try {
      await onFork(name, branchReason.trim() || undefined);
      close();
    } catch (caught) {
      setForkError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setForking(false);
    }
  }, [branchName, branchReason, close, forking, onFork]);

  const renderConversation = useCallback(
    ({ item }: { item: ConversationV1 }) => {
      const selected = item.id === selectedConversationId;
      const pinned = pinnedIds.includes(item.id);
      return (
        <View className="mb-2">
          <Pressable
            onPress={() => void onSelectConversation(item.id)}
            className={`rounded-xl border p-4 active:opacity-80 ${
              selected
                ? "border-primary bg-primary/10"
                : "border-border bg-card"
            }`}
          >
            <View className="flex-row items-start justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text
                  className="text-foreground text-base font-semibold"
                  numberOfLines={2}
                >
                  {item.title}
                </Text>
                <Text className="text-muted2 mt-1 text-xs">
                  {item.hostProvider} · {updatedLabel(item.updatedAt)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  pinned ? "Unpin conversation" : "Pin conversation"
                }
                onPress={(event) => {
                  event.stopPropagation();
                  void onTogglePin(item.id);
                }}
                hitSlop={10}
                className="px-1 active:opacity-60"
              >
                <Text className={pinned ? "text-accent" : "text-muted2"}>
                  {pinned ? "Pinned" : "Pin"}
                </Text>
              </Pressable>
            </View>
          </Pressable>

          {selected && branches.length > 1 ? (
            <View className="border-border mt-2 ml-4 border-l pl-3">
              {branches.map((branch) => (
                <Pressable
                  key={branch.id}
                  onPress={() => {
                    onSelectBranch(branch.id);
                    close();
                  }}
                  className="mb-1 flex-row items-center gap-2 rounded-lg px-3 py-2 active:opacity-70"
                >
                  <View
                    className={`h-2 w-2 rounded-full ${
                      branch.id === selectedBranchId ? "bg-accent" : "bg-muted2"
                    }`}
                  />
                  <Text
                    className="text-foreground flex-1 text-sm"
                    numberOfLines={1}
                  >
                    {branch.name}
                  </Text>
                  {branch.parentBranchId ? (
                    <Text className="text-muted2 text-xs">branch</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      );
    },
    [
      branches,
      close,
      onSelectBranch,
      onSelectConversation,
      onTogglePin,
      pinnedIds,
      selectedBranchId,
      selectedConversationId,
    ],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <View className="bg-background flex-1 px-5 pt-6">
        <View className="mb-4 flex-row items-center justify-between">
          <View>
            <Text className="text-foreground text-xl font-semibold">
              Conversations
            </Text>
            <Text className="text-muted2 mt-1 text-xs">
              Your durable OODA history
            </Text>
          </View>
          <Pressable onPress={close} className="active:opacity-70">
            <Text className="text-muted text-base font-semibold">Done</Text>
          </Pressable>
        </View>

        <View className="mb-3 flex-row gap-2">
          <View className="border-border bg-card min-w-0 flex-1 rounded-xl border px-3">
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search conversations"
              placeholderTextColor={colors.muted2}
              className="text-foreground py-3 text-base"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <Pressable
            onPress={create}
            disabled={creating}
            className="bg-primary justify-center rounded-xl px-4 active:opacity-80 disabled:opacity-50"
          >
            {creating ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text className="text-primary-foreground font-semibold">
                New thought
              </Text>
            )}
          </Pressable>
        </View>

        {selectedConversationId && canFork ? (
          showForkForm ? (
            <View className="border-border bg-card mb-4 rounded-xl border px-4 py-4">
              <Text className="text-foreground text-sm font-semibold">
                Branch from the latest saved event
              </Text>
              <Text className="text-muted mt-1 text-xs leading-5">
                Explore an alternative without rewriting the current
                conversation.
              </Text>
              <TextInput
                value={branchName}
                onChangeText={setBranchName}
                placeholder="Branch name"
                placeholderTextColor={colors.muted2}
                maxLength={256}
                className="border-border bg-background text-foreground mt-3 rounded-xl border px-3 py-2.5 text-sm"
              />
              <TextInput
                value={branchReason}
                onChangeText={setBranchReason}
                placeholder="Reason (optional)"
                placeholderTextColor={colors.muted2}
                maxLength={2_000}
                multiline
                className="border-border bg-background text-foreground mt-2 min-h-16 rounded-xl border px-3 py-2.5 text-sm"
              />
              {forkError ? (
                <Text className="text-danger mt-2 text-xs">{forkError}</Text>
              ) : null}
              <View className="mt-3 flex-row gap-3">
                <Pressable
                  onPress={resetForkForm}
                  disabled={forking}
                  className="border-border flex-1 rounded-xl border py-2.5 active:opacity-70 disabled:opacity-40"
                >
                  <Text className="text-muted text-center text-sm font-semibold">
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void fork()}
                  disabled={!branchName.trim() || forking}
                  className="bg-primary flex-1 rounded-xl py-2.5 active:opacity-80 disabled:opacity-40"
                >
                  <Text className="text-primary-foreground text-center text-sm font-semibold">
                    {forking ? "Creating…" : "Create branch"}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => setShowForkForm(true)}
              className="border-accent/40 bg-accent/10 mb-4 rounded-xl border px-4 py-3 active:opacity-80"
            >
              <Text className="text-accent text-center text-sm font-semibold">
                Branch from here
              </Text>
            </Pressable>
          )
        ) : null}

        <LegendList
          data={filtered}
          renderItem={renderConversation}
          keyExtractor={(item) => item.id}
          estimatedItemSize={88}
          recycleItems
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View className="items-center px-6 py-16">
              <Text className="text-muted text-center text-sm">
                {query.trim()
                  ? "No matching conversations."
                  : "Start your first thought."}
              </Text>
            </View>
          }
        />
      </View>
    </Modal>
  );
}
