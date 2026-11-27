import {
  ActivityIndicator,
  FlatList,
  Text,
  Pressable,
  View,
  RefreshControl,
} from "react-native";
import type { Thread } from "@gmacko/core/contracts";
import { Badge } from "../ui/Badge";
import { colors } from "~/lib/colors";

interface ThreadSidebarProps {
  threads: readonly Thread[];
  error?: boolean;
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
}

const statusVariant = {
  active: "success",
  paused: "warning",
  archived: "default",
  completed: "accent",
} as const;

export function ThreadSidebar({
  threads,
  selectedThreadId,
  onSelectThread,
  onRefresh,
  isLoading,
  error,
}: ThreadSidebarProps) {
  return (
    <View className="flex-1 bg-background">
      <View className="px-4 py-3 border-b border-border">
        <Text
          className="text-lg font-bold"
          style={{ color: colors.foreground }}
        >
          Threads
        </Text>
      </View>
      {error && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading threads"
          onPress={onRefresh}
          style={{ minHeight: 44, padding: 12 }}
        >
          <Text style={{ color: colors.foreground }}>
            Could not load threads. Retry
          </Text>
        </Pressable>
      )}
      <FlatList
        data={threads}
        keyExtractor={(t) => t.id}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={isLoading ?? false}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          ) : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${item.status}`}
            accessibilityState={{ selected: selectedThreadId === item.id }}
            style={{ minHeight: 44 }}
            onPress={() => onSelectThread(item.id)}
            className={`px-4 py-3 border-b border-border/40 ${
              selectedThreadId === item.id ? "bg-card-elevated" : ""
            }`}
          >
            <View className="flex-row items-center justify-between">
              <Text
                className="text-base font-semibold flex-1 mr-2"
                style={{ color: colors.foreground }}
              >
                {item.title}
              </Text>
              <Badge variant={statusVariant[item.status]}>{item.status}</Badge>
            </View>
            {item.tags.length > 0 && (
              <View className="flex-row flex-wrap gap-1 mt-1">
                {item.tags.slice(0, 3).map((tag) => (
                  <Text
                    key={tag}
                    className="text-xs"
                    style={{ color: colors.muted }}
                  >
                    # {tag}
                  </Text>
                ))}
              </View>
            )}
          </Pressable>
        )}
        ListEmptyComponent={
          <View className="p-8 items-center">
            {isLoading ? (
              <ActivityIndicator accessibilityLabel="Loading threads" />
            ) : (
              !error && (
                <Text style={{ color: colors.muted }}>No threads yet</Text>
              )
            )}
          </View>
        }
      />
    </View>
  );
}
