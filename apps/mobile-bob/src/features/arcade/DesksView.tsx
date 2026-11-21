// Agent Desks on iPhone and iPad (BOB-98): one card per watched item with its live agent
// tail and CI phases, from @bob/arcade's desks(). A strip that scrolls sideways on narrow
// screens, a grid on wide ones. The newest tail line fades in when a new frame arrives,
// which is real data; under reduced motion it just appears. A desk with no detail says so.
import { memo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import type { Desk } from "@bob/arcade";
import type { CiPhase } from "@bob/sdlc-view";

import { ATTENTION_COLOR } from "~/features/sdlc/components";
import { colors } from "~/lib/colors";

import { STAGE } from "./FloorView";

const MONO = "Menlo";
const PHASE_COLOR: Record<CiPhase["status"], string> = {
  queued: "#6a5638",
  running: "#6fb4ff",
  passed: "#7dffb0",
  failed: "#ff6b6b",
  skipped: "#3a2f22",
  unknown: "#3a2f22",
};
const STRIP_CARD_WIDTH = 230;
const GAP = 8;

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

const DeskCard = memo(function DeskCard({ desk, width, now, reduced, selected, onPress }: { desk: Desk; width: number; now: number; reduced: boolean; selected: boolean; onPress: (itemId: string) => void }) {
  const edge = desk.attention === "ok" ? `hsl(${desk.hue}, 45%, 32%)` : ATTENTION_COLOR[desk.attention];
  const newest = desk.lines.length - 1;
  return (
    <Pressable
      onPress={() => onPress(desk.itemId)}
      accessibilityRole="button"
      accessibilityLabel={desk.accessibilityLabel}
      accessibilityState={{ selected }}
      testID={`arcade-desk-${desk.itemId}`}
      style={({ pressed }) => ({
        width,
        borderRadius: 12,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? STAGE.labelLit : edge,
        backgroundColor: "#1a1510",
        padding: 10,
        gap: 4,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: desk.attention === "ok" ? `hsl(${desk.hue}, 70%, 60%)` : ATTENTION_COLOR[desk.attention] }} />
        <Text style={{ flex: 1, fontFamily: MONO, fontSize: 12, fontWeight: "800", color: STAGE.labelLit }} numberOfLines={1}>
          {desk.label}
          {desk.attention === "needs_human" ? "  !" : ""}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1, color: STAGE.label }} numberOfLines={1}>
          {desk.stateLabel.toUpperCase()}
        </Text>
      </View>
      <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>
        {desk.repo}
        {desk.threadStatus ? ` · ${desk.threadStatus}` : ""}
        {desk.tailAt !== null && desk.quiet ? ` · quiet ${ago(now - desk.tailAt)}` : ""}
      </Text>
      <View style={{ minHeight: 56, justifyContent: "flex-end" }}>
        {desk.lines.length ? (
          desk.lines.map((line, i) =>
            i === newest && !reduced ? (
              <Animated.Text key={`${desk.tailAt ?? 0}:${i}`} entering={FadeIn.duration(250)} numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10, color: desk.quiet ? STAGE.label : "#d9c9a8" }}>
                {line || " "}
              </Animated.Text>
            ) : (
              <Text key={i} numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10, color: i === newest && !desk.quiet ? "#d9c9a8" : STAGE.label }}>
                {line || " "}
              </Text>
            ),
          )
        ) : (
          <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={2}>
            {desk.note ? `No live detail: ${desk.note}` : "No live detail yet."}
          </Text>
        )}
      </View>
      {desk.ci ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }} accessibilityLabel={`CI ${desk.ci.summary}`}>
          {desk.ci.phases.slice(0, 12).map((p, i) => (
            <View key={`${p.name}:${i}`} style={{ width: 10, height: 6, borderRadius: 2, backgroundColor: PHASE_COLOR[p.status] }} />
          ))}
          <Text style={{ marginLeft: 4, flex: 1, fontFamily: MONO, fontSize: 9, color: STAGE.label }} numberOfLines={1}>
            CI {desk.ci.summary}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});

/** The desks row. `width` is the space available; wide screens get a grid of up to 3 columns. */
export function DesksView({ desks, width, now, reduced, selectedItemId, onPressDesk }: { desks: Desk[]; width: number; now: number; reduced: boolean; selectedItemId: string | null; onPressDesk: (itemId: string) => void }) {
  if (!desks.length) return null;
  const columns = width >= 3 * STRIP_CARD_WIDTH + 2 * GAP + 24 ? 3 : 0;
  const header = (
    <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: STAGE.label, paddingHorizontal: 14, paddingBottom: 6 }}>
      DESKS {desks.length}
    </Text>
  );
  if (columns) {
    const cardWidth = Math.floor((width - 24 - GAP * (columns - 1)) / columns);
    return (
      <View testID="arcade-desks" style={{ paddingTop: 6 }}>
        {header}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP, paddingHorizontal: 12 }}>
          {desks.map((d) => (
            <DeskCard key={d.itemId} desk={d} width={cardWidth} now={now} reduced={reduced} selected={d.itemId === selectedItemId} onPress={onPressDesk} />
          ))}
        </View>
      </View>
    );
  }
  return (
    <View testID="arcade-desks" style={{ paddingTop: 6 }}>
      {header}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: GAP, paddingHorizontal: 12 }}>
        {desks.map((d) => (
          <DeskCard key={d.itemId} desk={d} width={STRIP_CARD_WIDTH} now={now} reduced={reduced} selected={d.itemId === selectedItemId} onPress={onPressDesk} />
        ))}
      </ScrollView>
    </View>
  );
}
