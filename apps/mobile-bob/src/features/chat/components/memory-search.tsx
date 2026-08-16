import type { MemorySeedV1 } from "@gmacko/ooda-client/v1";
import { memo, useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { LegendList } from "@legendapp/list";

import { buildMemorySearchSummary } from "../memory-search-model";

interface MemorySearchProps {
  visible: boolean;
  query: string;
  items: MemorySeedV1[];
  isLoading: boolean;
  hasSearched: boolean;
  error: string | null;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onClose: () => void;
}

const MemoryRow = memo(function MemoryRow({ item }: { item: MemorySeedV1 }) {
  return (
    <View className="border-border bg-card mb-3 rounded-xl border px-4 py-3">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-accent text-xs font-semibold uppercase">
          {item.kind}
        </Text>
        <Text className="text-muted text-xs">{item.lifecycleState}</Text>
      </View>
      <Text className="text-foreground mt-2 text-sm leading-5">
        {item.normalizedText}
      </Text>
      {item.entities.length ? (
        <Text className="text-muted mt-2 text-xs" numberOfLines={2}>
          {item.entities.join(" · ")}
        </Text>
      ) : null}
      <View className="mt-2 flex-row items-center justify-between gap-3">
        <Text className="text-muted2 text-xs">{item.sensitivity}</Text>
        <Text className="text-muted2 text-xs">
          {Math.round(item.confidence * 100)}% confidence
        </Text>
      </View>
    </View>
  );
});

export function MemorySearch({
  visible,
  query,
  items,
  isLoading,
  hasSearched,
  error,
  onQueryChange,
  onSearch,
  onClose,
}: MemorySearchProps) {
  const summary = useMemo(() => buildMemorySearchSummary(items), [items]);
  const renderItem = useCallback(
    ({ item }: { item: MemorySeedV1 }) => <MemoryRow item={item} />,
    [],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="bg-background flex-1 px-5 pt-6">
        <View className="mb-4 flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-foreground text-xl font-semibold">
              Memory
            </Text>
            <Text className="text-muted mt-0.5 text-xs">
              Recover questions and ideas without creating work.
            </Text>
          </View>
          <Pressable onPress={onClose} className="active:opacity-70">
            <Text className="text-muted text-base font-semibold">Done</Text>
          </Pressable>
        </View>

        <View className="mb-4 flex-row items-center gap-2">
          <TextInput
            value={query}
            onChangeText={onQueryChange}
            onSubmitEditing={onSearch}
            returnKeyType="search"
            autoCorrect={false}
            placeholder="Search past questions, ideas, decisions…"
            placeholderTextColor="#777"
            className="border-border bg-card text-foreground min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-sm"
          />
          <Pressable
            onPress={onSearch}
            disabled={isLoading}
            className="bg-primary rounded-xl px-4 py-2.5 active:opacity-80 disabled:opacity-50"
          >
            <Text className="text-primary-foreground text-sm font-semibold">
              Find
            </Text>
          </Pressable>
        </View>

        {isLoading ? (
          <View className="flex-1 items-center justify-center gap-3">
            <ActivityIndicator />
            <Text className="text-muted text-sm">Searching memory…</Text>
          </View>
        ) : error ? (
          <View className="border-border bg-card rounded-xl border px-4 py-4">
            <Text className="text-danger text-sm">{error}</Text>
            <Pressable onPress={onSearch} className="mt-3 active:opacity-70">
              <Text className="text-accent text-sm font-semibold">
                Try again
              </Text>
            </Pressable>
          </View>
        ) : hasSearched && items.length === 0 ? (
          <View className="border-border bg-card rounded-xl border px-4 py-4">
            <Text className="text-muted text-sm">
              No matching memories. Try a project name, person, or earlier
              phrasing.
            </Text>
          </View>
        ) : (
          <LegendList
            data={items}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            estimatedItemSize={132}
            recycleItems
            contentContainerStyle={{ paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              items.length ? (
                <View className="border-border bg-card mb-4 rounded-xl border px-4 py-3">
                  <Text className="text-foreground text-sm font-semibold">
                    {summary.total} memor{summary.total === 1 ? "y" : "ies"}
                  </Text>
                  <Text className="text-muted mt-1 text-xs">
                    {summary.kinds
                      .map(({ label, count }) => `${label} ${count}`)
                      .join(" · ")}
                  </Text>
                </View>
              ) : null
            }
          />
        )}
      </View>
    </Modal>
  );
}
