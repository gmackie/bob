import type {
  MemoryConnectionV1,
  MemoryDetailV1,
  MemorySeedV1,
} from "@gmacko/ooda-client/v1";
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

import {
  buildMemorySearchSummary,
  sortMemoryConnections,
} from "../memory-search-model";

interface MemorySearchProps {
  visible: boolean;
  query: string;
  items: MemorySeedV1[];
  isLoading: boolean;
  hasSearched: boolean;
  error: string | null;
  selectedMemoryId: string | null;
  detail: MemoryDetailV1 | null;
  detailError: string | null;
  isDetailLoading: boolean;
  feedbackEdgeId: string | null;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onSelectMemory: (memoryId: string) => void;
  onCloseDetail: () => void;
  onRetryDetail: () => void;
  onFeedback: (
    edgeId: string,
    feedbackState: "confirmed" | "suppressed",
  ) => void;
  onClose: () => void;
}

const MemoryRow = memo(function MemoryRow({ item }: { item: MemorySeedV1 }) {
  return <MemoryCard item={item} />;
});

function MemoryCard({ item }: { item: MemorySeedV1 }) {
  return (
    <View className="border-border bg-card rounded-xl border px-4 py-3">
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
}

const MemoryConnectionRow = memo(function MemoryConnectionRow({
  connection,
  feedbackEdgeId,
  onFeedback,
}: {
  connection: MemoryConnectionV1;
  feedbackEdgeId: string | null;
  onFeedback: MemorySearchProps["onFeedback"];
}) {
  const isUpdating = feedbackEdgeId === connection.edge.id;
  return (
    <View className="mb-3 gap-3">
      <MemoryCard item={connection.memory} />
      <View className="border-border bg-card mx-2 rounded-xl border px-3 py-3">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-accent text-xs font-semibold uppercase">
            {connection.edge.kind} · {connection.direction}
          </Text>
          <Text className="text-muted text-xs">
            {Math.round(connection.edge.score * 100)}% match
          </Text>
        </View>
        <Text className="text-muted mt-2 text-xs leading-5">
          {connection.edge.explanation}
        </Text>
        <View className="mt-3 flex-row items-center gap-3">
          <Pressable
            onPress={() => onFeedback(connection.edge.id, "confirmed")}
            disabled={
              isUpdating || connection.edge.feedbackState === "confirmed"
            }
            className="active:opacity-70 disabled:opacity-40"
          >
            <Text className="text-success text-xs font-semibold">Confirm</Text>
          </Pressable>
          <Pressable
            onPress={() => onFeedback(connection.edge.id, "suppressed")}
            disabled={
              isUpdating || connection.edge.feedbackState === "suppressed"
            }
            className="active:opacity-70 disabled:opacity-40"
          >
            <Text className="text-warning text-xs font-semibold">Hide</Text>
          </Pressable>
          <Text className="text-muted2 ml-auto text-xs">
            {isUpdating ? "Saving…" : connection.edge.feedbackState}
          </Text>
        </View>
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
  selectedMemoryId,
  detail,
  detailError,
  isDetailLoading,
  feedbackEdgeId,
  onQueryChange,
  onSearch,
  onSelectMemory,
  onCloseDetail,
  onRetryDetail,
  onFeedback,
  onClose,
}: MemorySearchProps) {
  const summary = useMemo(() => buildMemorySearchSummary(items), [items]);
  const connections = useMemo(
    () => sortMemoryConnections(detail?.connections ?? []),
    [detail?.connections],
  );
  const renderItem = useCallback(
    ({ item }: { item: MemorySeedV1 }) => (
      <Pressable
        onPress={() => onSelectMemory(item.id)}
        className="mb-3 active:opacity-80"
      >
        <MemoryRow item={item} />
      </Pressable>
    ),
    [onSelectMemory],
  );
  const renderConnection = useCallback(
    ({ item }: { item: MemoryConnectionV1 }) => (
      <MemoryConnectionRow
        connection={item}
        feedbackEdgeId={feedbackEdgeId}
        onFeedback={onFeedback}
      />
    ),
    [feedbackEdgeId, onFeedback],
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
              {selectedMemoryId ? "Memory connections" : "Memory"}
            </Text>
            <Text className="text-muted mt-0.5 text-xs">
              Recover questions and ideas without creating work.
            </Text>
          </View>
          <Pressable onPress={onClose} className="active:opacity-70">
            <Text className="text-muted text-base font-semibold">Done</Text>
          </Pressable>
        </View>

        {selectedMemoryId ? (
          <Pressable onPress={onCloseDetail} className="mb-4 active:opacity-70">
            <Text className="text-accent text-sm font-semibold">
              Back to search
            </Text>
          </Pressable>
        ) : (
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
        )}

        {selectedMemoryId && isDetailLoading ? (
          <View className="flex-1 items-center justify-center gap-3">
            <ActivityIndicator />
            <Text className="text-muted text-sm">Loading connections…</Text>
          </View>
        ) : selectedMemoryId && !detail && detailError ? (
          <View className="border-border bg-card rounded-xl border px-4 py-4">
            <Text className="text-danger text-sm">{detailError}</Text>
            <Pressable
              onPress={onRetryDetail}
              className="mt-3 active:opacity-70"
            >
              <Text className="text-accent text-sm font-semibold">
                Try again
              </Text>
            </Pressable>
          </View>
        ) : selectedMemoryId && detail ? (
          <LegendList
            data={connections}
            renderItem={renderConnection}
            keyExtractor={(connection) => connection.edge.id}
            estimatedItemSize={236}
            recycleItems
            contentContainerStyle={{ paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View className="mb-4 gap-3">
                <MemoryCard item={detail.memory} />
                {detailError ? (
                  <View className="border-danger/40 bg-danger/10 rounded-xl border px-3 py-3">
                    <Text className="text-danger text-xs">{detailError}</Text>
                  </View>
                ) : null}
                <Text className="text-muted text-xs">
                  {connections.length} connection
                  {connections.length === 1 ? "" : "s"}, ordered by relevance.
                </Text>
              </View>
            }
            ListEmptyComponent={
              <View className="border-border bg-card rounded-xl border px-4 py-4">
                <Text className="text-muted text-sm">
                  No connections have been discovered for this memory yet.
                </Text>
              </View>
            }
          />
        ) : isLoading ? (
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
