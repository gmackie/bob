import { LegendList } from "@legendapp/list";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import type {
  ConversationBranchV1,
  ConversationV1,
} from "@gmacko/ooda-client/v1";

import { colors } from "~/lib/colors";

interface ConversationDrawerProps {
  visible: boolean;
  conversations: ConversationV1[];
  branches: ConversationBranchV1[];
  selectedConversationId: string | null;
  selectedBranchId: string | null;
  pinnedIds: string[];
  onClose: () => void;
  onSelectConversation: (conversationId: string) => Promise<void> | void;
  onSelectBranch: (branchId: string) => void;
  onCreate: () => Promise<unknown>;
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
  onClose,
  onSelectConversation,
  onSelectBranch,
  onCreate,
  onTogglePin,
}: ConversationDrawerProps) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return conversations
      .filter((conversation) =>
        !normalized || conversation.title.toLocaleLowerCase().includes(normalized),
      )
      .sort((left, right) => {
        const leftPinned = pinnedIds.includes(left.id) ? 1 : 0;
        const rightPinned = pinnedIds.includes(right.id) ? 1 : 0;
        return rightPinned - leftPinned || right.updatedAt.localeCompare(left.updatedAt);
      });
  }, [conversations, pinnedIds, query]);

  const create = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      await onCreate();
      onClose();
    } finally {
      setCreating(false);
    }
  }, [creating, onClose, onCreate]);

  const renderConversation = useCallback(({ item }: { item: ConversationV1 }) => {
    const selected = item.id === selectedConversationId;
    const pinned = pinnedIds.includes(item.id);
    return (
      <View className="mb-2">
        <Pressable
          onPress={() => void onSelectConversation(item.id)}
          className={`rounded-xl border p-4 active:opacity-80 ${
            selected ? "border-primary bg-primary/10" : "border-border bg-card"
          }`}
        >
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold text-foreground" numberOfLines={2}>
                {item.title}
              </Text>
              <Text className="mt-1 text-xs text-muted2">
                {item.hostProvider} · {updatedLabel(item.updatedAt)}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={pinned ? "Unpin conversation" : "Pin conversation"}
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
          <View className="ml-4 mt-2 border-l border-border pl-3">
            {branches.map((branch) => (
              <Pressable
                key={branch.id}
                onPress={() => {
                  onSelectBranch(branch.id);
                  onClose();
                }}
                className="mb-1 flex-row items-center gap-2 rounded-lg px-3 py-2 active:opacity-70"
              >
                <View
                  className={`h-2 w-2 rounded-full ${
                    branch.id === selectedBranchId ? "bg-accent" : "bg-muted2"
                  }`}
                />
                <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                  {branch.name}
                </Text>
                {branch.parentBranchId ? (
                  <Text className="text-xs text-muted2">branch</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    );
  }, [branches, onClose, onSelectBranch, onSelectConversation, onTogglePin, pinnedIds, selectedBranchId, selectedConversationId]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-background px-5 pt-6">
        <View className="mb-4 flex-row items-center justify-between">
          <View>
            <Text className="text-xl font-semibold text-foreground">Conversations</Text>
            <Text className="mt-1 text-xs text-muted2">Your durable OODA history</Text>
          </View>
          <Pressable onPress={onClose} className="active:opacity-70">
            <Text className="text-base font-semibold text-muted">Done</Text>
          </Pressable>
        </View>

        <View className="mb-3 flex-row gap-2">
          <View className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3">
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search conversations"
              placeholderTextColor={colors.muted2}
              className="py-3 text-base text-foreground"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <Pressable
            onPress={create}
            disabled={creating}
            className="justify-center rounded-xl bg-primary px-4 active:opacity-80 disabled:opacity-50"
          >
            {creating ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text className="font-semibold text-primary-foreground">New thought</Text>
            )}
          </Pressable>
        </View>

        <LegendList
          data={filtered}
          renderItem={renderConversation}
          keyExtractor={(item) => item.id}
          estimatedItemSize={88}
          recycleItems
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={(
            <View className="items-center px-6 py-16">
              <Text className="text-center text-sm text-muted">
                {query.trim() ? "No matching conversations." : "Start your first thought."}
              </Text>
            </View>
          )}
        />
      </View>
    </Modal>
  );
}
