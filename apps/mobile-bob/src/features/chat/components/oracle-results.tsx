import { Pressable, ScrollView, Text, View } from "react-native";

import { colors } from "~/lib/colors";

import type { OracleChunk } from "../hooks/use-oracle-search";

interface OracleResultsProps {
  results: OracleChunk[];
  query: string | null;
  latencyMs: number | null;
  isSearching: boolean;
  error: string | null;
  onClose: () => void;
}

function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export function OracleResults({
  results,
  query,
  latencyMs,
  isSearching,
  error,
  onClose,
}: OracleResultsProps) {
  return (
    <View className="border-border bg-card-elevated max-h-72 rounded-2xl border">
      <View className="border-border flex-row items-center justify-between border-b px-4 py-2.5">
        <View className="flex-1">
          <Text className="text-xs font-semibold" style={{ color: colors.foreground }}>
            {isSearching
              ? "Searching..."
              : `${results.length} results${latencyMs != null ? ` (${latencyMs}ms)` : ""}`}
          </Text>
          {query ? (
            <Text
              className="text-[10px]"
              numberOfLines={1}
              style={{ color: colors.muted }}
            >
              {query}
            </Text>
          ) : null}
        </View>
        <Pressable onPress={onClose} className="active:opacity-70 pl-3">
          <Text className="text-xs font-semibold" style={{ color: colors.muted }}>
            Close
          </Text>
        </Pressable>
      </View>

      {error ? (
        <View className="px-4 py-3">
          <Text className="text-xs" style={{ color: colors.danger }}>
            {error}
          </Text>
        </View>
      ) : (
        <ScrollView
          className="max-h-56"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 4 }}
        >
          {results.map((chunk) => (
            <View key={chunk.unitId} className="border-border border-b px-4 py-3">
              <View className="flex-row items-start justify-between">
                <View className="flex-1 pr-2">
                  {chunk.sourceTitle ? (
                    <Text
                      className="text-xs font-semibold"
                      numberOfLines={1}
                      style={{ color: colors.foreground }}
                    >
                      {chunk.sourceTitle}
                    </Text>
                  ) : null}
                  {chunk.headingContext ? (
                    <Text
                      className="text-[10px]"
                      numberOfLines={1}
                      style={{ color: colors.muted }}
                    >
                      {chunk.headingContext}
                    </Text>
                  ) : null}
                </View>
                <View className="flex-row items-center gap-1.5">
                  <Text className="text-[10px]" style={{ color: colors.muted2 }}>
                    {chunk.sourceKind}
                  </Text>
                  <Text className="text-[10px] font-semibold" style={{ color: colors.accent }}>
                    {formatScore(chunk.score)}
                  </Text>
                </View>
              </View>
              <Text
                className="mt-1 text-xs leading-4"
                style={{ color: colors.secondaryForeground }}
              >
                {truncate(chunk.content, 200)}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
