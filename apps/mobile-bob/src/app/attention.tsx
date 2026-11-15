import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";

import { attentionEntries, bannerFor, browseHref, itemHref } from "~/features/sdlc/attention-model";
import { ATTENTION_COLOR, AttentionDot, OfflineBanner } from "~/features/sdlc/components";
import { useNow, useSdlcEdge } from "~/features/sdlc/use-sdlc-edge";
import { colors } from "~/lib/colors";

/**
 * SDLC items that need a human, waiting-for-input first (BOB-75 Phase 4). The same
 * attention rule as web and the TUI (STATE_PRESENTATION), over the live edge view.
 */
export default function AttentionScreen() {
  const { state, retry } = useSdlcEdge();
  const now = useNow();
  const banner = bannerFor(state.view, state.connection, now, state.error);
  const entries = attentionEntries(state.view);
  const waiting = state.view.epoch === null;

  return (
    <ScrollView className="bg-background flex-1" contentContainerClassName="p-4 pb-12" testID="sdlc-attention">
      <OfflineBanner banner={banner} now={now} onRetry={retry} />

      <Pressable
        onPress={() => router.push(browseHref({}))}
        accessibilityRole="button"
        className="mb-4 flex-row items-center justify-between rounded-2xl border px-4 py-3 active:opacity-70"
        style={{ borderColor: colors.border, backgroundColor: colors.card }}
      >
        <View>
          <Text className="text-foreground text-base font-semibold">Browse the fleet</Text>
          <Text className="text-muted text-xs">States, projects, repos and plans</Text>
        </View>
        <Text className="text-accent text-lg">›</Text>
      </Pressable>

      {waiting ? (
        <Text className="text-muted text-sm">Waiting for the first snapshot…</Text>
      ) : entries.length === 0 ? (
        <View className="items-center py-10">
          <Text className="text-foreground text-base font-semibold">Nothing needs you</Text>
          <Text className="text-muted mt-1 text-sm">Items that wait for input, review or a retry show up here.</Text>
        </View>
      ) : (
        entries.map((entry) => (
          <Pressable
            key={entry.itemId}
            testID={`sdlc-attention-${entry.itemId}`}
            onPress={() => router.push(itemHref(entry.itemId))}
            accessibilityRole="button"
            accessibilityLabel={`${entry.title}, ${entry.stateLabel}`}
            className="mb-2 rounded-2xl px-4 py-3 active:opacity-70"
            style={{ backgroundColor: colors.card }}
          >
            <View className="flex-row items-center gap-2">
              <AttentionDot attention={entry.attention} />
              <Text className="text-foreground flex-1 text-base font-semibold" numberOfLines={1}>{entry.title}</Text>
              <Text className="text-xs font-semibold" style={{ color: colors.secondaryForeground }}>{entry.stateLabel}</Text>
            </View>
            <Text className="text-muted mt-1 text-xs" numberOfLines={1}>
              {entry.projectName} · {entry.context}
            </Text>
            {entry.question ? (
              <Text className="text-foreground mt-2 text-sm" numberOfLines={2}>“{entry.question}”</Text>
            ) : null}
            {entry.releaseReason ? (
              <Text className="mt-2 text-sm" numberOfLines={2} style={{ color: ATTENTION_COLOR[entry.attention] }}>{entry.releaseReason}</Text>
            ) : null}
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}
