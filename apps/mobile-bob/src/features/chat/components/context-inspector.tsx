import type {
  ContextPackV1,
  ContextSourceTypeV1,
} from "@gmacko/ooda-client/v1";
import { memo, useCallback, useMemo } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { LegendList } from "@legendapp/list";

import { buildContextInspectorSummary } from "../context-inspector-model";

const SOURCE_LABELS: Record<ContextSourceTypeV1, string> = {
  conversation_event: "Conversation",
  memory_seed: "Memory",
  obsidian_note: "Obsidian",
  external_link: "External link",
  user_instruction: "Instruction",
  bob_work_item: "Bob work",
  kanbanger_issue: "KanBanger",
  bizpulse_venture: "BizPulse",
  forgegraph_changeset: "ForgeGraph",
  research_vault_source: "Research",
};

interface ContextInspectorProps {
  visible: boolean;
  expectedPackId?: string;
  pack: ContextPackV1 | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}

const ContextItemRow = memo(function ContextItemRow({
  item,
}: {
  item: ContextPackV1["items"][number];
}) {
  return (
    <View className="border-border bg-card mb-3 rounded-xl border px-4 py-3">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-foreground min-w-0 flex-1 text-sm font-semibold">
          {SOURCE_LABELS[item.sourceType]}
        </Text>
        <Text
          className={
            item.decision === "disclosed"
              ? "text-success text-xs font-semibold"
              : item.decision === "denied"
                ? "text-danger text-xs font-semibold"
                : "text-warning text-xs font-semibold"
          }
        >
          {item.decision}
        </Text>
      </View>
      <Text className="text-muted mt-1 text-xs">{item.reason}</Text>
      {item.content !== undefined ? (
        <Text className="text-secondary-foreground mt-3 text-sm leading-5">
          {item.content}
        </Text>
      ) : null}
      {item.redaction ? (
        <Text className="text-warning mt-3 text-xs italic">
          {item.redaction}
        </Text>
      ) : null}
    </View>
  );
});

export function ContextInspector({
  visible,
  expectedPackId,
  pack,
  isLoading,
  error,
  onClose,
  onRetry,
}: ContextInspectorProps) {
  const summary = useMemo(
    () => (pack ? buildContextInspectorSummary(pack) : null),
    [pack],
  );
  const renderItem = useCallback(
    ({ item }: { item: ContextPackV1["items"][number] }) => (
      <ContextItemRow item={item} />
    ),
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
        <View className="mb-2 flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-foreground text-xl font-semibold">
              Turn context
            </Text>
            <Text className="text-muted mt-0.5 text-xs" numberOfLines={1}>
              Exact sources considered for the latest response
            </Text>
          </View>
          <Pressable onPress={onClose} className="active:opacity-70">
            <Text className="text-muted text-base font-semibold">Done</Text>
          </Pressable>
        </View>

        {!expectedPackId ? (
          <View className="border-border bg-card mt-6 rounded-xl border px-4 py-4">
            <Text className="text-muted text-sm">
              No context pack has been recorded for this conversation yet.
            </Text>
          </View>
        ) : isLoading ? (
          <View className="flex-1 items-center justify-center gap-3">
            <ActivityIndicator />
            <Text className="text-muted text-sm">
              Loading disclosed context…
            </Text>
          </View>
        ) : error ? (
          <View className="border-border bg-card mt-6 rounded-xl border px-4 py-4">
            <Text className="text-danger text-sm">{error}</Text>
            <Pressable onPress={onRetry} className="mt-3 active:opacity-70">
              <Text className="text-accent text-sm font-semibold">
                Try again
              </Text>
            </Pressable>
          </View>
        ) : pack && summary ? (
          <LegendList
            data={pack.items}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            estimatedItemSize={144}
            recycleItems
            contentContainerStyle={{ paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View className="border-border bg-card mt-4 mb-4 rounded-xl border px-4 py-3">
                <View className="flex-row flex-wrap gap-2">
                  <Text className="bg-secondary text-secondary-foreground rounded-full px-2.5 py-1 text-xs font-semibold">
                    {pack.provider}
                  </Text>
                  <Text className="bg-secondary text-secondary-foreground rounded-full px-2.5 py-1 text-xs font-semibold">
                    {summary.disclosed} disclosed
                  </Text>
                  <Text className="bg-secondary text-secondary-foreground rounded-full px-2.5 py-1 text-xs font-semibold">
                    {summary.withheld} withheld
                  </Text>
                </View>
                <Text className="text-muted mt-3 text-xs">
                  {summary.sources
                    .map(
                      ({ sourceType, count }) =>
                        `${SOURCE_LABELS[sourceType]} ${count}`,
                    )
                    .join(" · ")}
                </Text>
              </View>
            }
          />
        ) : (
          <View className="border-border bg-card mt-6 rounded-xl border px-4 py-4">
            <Text className="text-muted text-sm">
              This context pack is not available.
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}
