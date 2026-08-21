import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";

import { useOodaConversationContext } from "~/features/chat/ooda-conversation-context";
import { colors } from "~/lib/colors";

function updatedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Sidebar conversation list for OODA mode on tablet — the split-view
 * equivalent of the phone's conversation drawer. Pinned first, then most
 * recently updated.
 */
export function OodaConversationsTab({
  onSelectConversation,
}: {
  onSelectConversation?: (conversationId: string) => void;
}) {
  const chat = useOodaConversationContext();
  const [creating, setCreating] = useState(false);

  const ordered = useMemo(() => {
    if (!chat) return [];
    const pinned = new Set(chat.pinnedIds);
    return [...chat.conversations].sort((left, right) => {
      const leftPinned = pinned.has(left.id) ? 1 : 0;
      const rightPinned = pinned.has(right.id) ? 1 : 0;
      return rightPinned - leftPinned || right.updatedAt.localeCompare(left.updatedAt);
    });
  }, [chat]);

  const handleCreate = useCallback(async () => {
    if (!chat || creating) return;
    setCreating(true);
    try {
      await chat.createConversation();
    } finally {
      setCreating(false);
    }
  }, [chat, creating]);

  const handleSelect = useCallback(
    (conversationId: string) => {
      if (!chat) return;
      void chat.openConversation(conversationId);
      onSelectConversation?.(conversationId);
    },
    [chat, onSelectConversation],
  );

  if (!chat) return null;

  return (
    <View className="flex-1" testID="ooda-conversations-tab">
      <View className="px-3 pt-3 pb-2">
        <Pressable
          onPress={() => void handleCreate()}
          disabled={creating}
          accessibilityRole="button"
          className="items-center rounded-lg py-2.5 active:opacity-80"
          style={{ backgroundColor: colors.primary, opacity: creating ? 0.6 : 1 }}
        >
          <Text className="text-sm font-semibold" style={{ color: colors.primaryForeground }}>
            {creating ? "Starting…" : "+ New thought"}
          </Text>
        </Pressable>
      </View>

      {ordered.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6 py-10">
          <Text className="text-sm font-semibold text-foreground">No conversations yet</Text>
          <Text className="mt-1 text-center text-xs leading-5 text-muted">
            Start a new thought to begin your durable conversation history.
          </Text>
        </View>
      ) : (
        <FlatList
          data={ordered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 16 }}
          renderItem={({ item }) => {
            const selected = item.id === chat.selectedConversationId;
            const pinned = chat.pinnedIds.includes(item.id);
            return (
              <Pressable
                onPress={() => handleSelect(item.id)}
                onLongPress={() => chat.togglePin(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}${pinned ? ", pinned" : ""}`}
                accessibilityState={{ selected }}
                className="mb-1 rounded-lg px-3 py-2.5 active:opacity-80"
                style={{
                  backgroundColor: selected ? colors.secondary : "transparent",
                  borderLeftWidth: 2,
                  borderLeftColor: selected ? colors.primary : "transparent",
                }}
              >
                <View className="flex-row items-center justify-between gap-2">
                  <Text
                    className="flex-1 text-sm font-medium"
                    style={{ color: selected ? colors.foreground : colors.cardForeground }}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  {pinned ? (
                    <Text className="text-[10px] font-semibold" style={{ color: colors.accent }}>
                      PINNED
                    </Text>
                  ) : null}
                </View>
                <Text className="mt-0.5 text-xs" style={{ color: colors.muted }} numberOfLines={1}>
                  {item.hostProvider} · {updatedLabel(item.updatedAt)}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
