// Agent Desks on iPhone and iPad (BOB-98): miniature glowing arcade CRT workstations per
// watched item, powered by @bob/arcade's desks() & deskMood(). Live robot avatar reacts to
// real WebSocket tail & CI streams; syntax-tinted terminal lines with blinking live caret.
import { memo, useEffect } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { deskMood, MOOD_LABEL, tailLineTone } from "@bob/arcade";
import type { Desk, DeskMood } from "@bob/arcade";
import type { CiPhase } from "@bob/sdlc-view";

import { ATTENTION_COLOR } from "~/features/sdlc/components";
import { colors } from "~/lib/colors";

import { STAGE } from "./FloorView";
import { DeskAgentAvatar } from "./StationArt";

const MONO = "Menlo";
const PHASE_COLOR: Record<CiPhase["status"], string> = {
  queued: "#5c4c38",
  running: "#6fb4ff",
  passed: "#7dffb0",
  failed: "#ff6b6b",
  skipped: "#3a2f22",
  unknown: "#3a2f22",
};

const MOOD_ACCENT: Record<DeskMood, string> = {
  asking: "#ffd27a",
  testing: "#6fb4ff",
  building: "#f0a94d",
  shipping: "#c09cff",
  coding: "#7fd3e8",
  "ci-running": "#6fb4ff",
  "ci-green": "#7dffb0",
  "ci-failed": "#ff6b6b",
  stalled: "#ff9f43",
  idle: "#78664b",
};

const LINE_COLOR = {
  "command-run": "#7fd3e8",
  "command-ok": "#7dffb0",
  "command-fail": "#ff7b7b",
  question: "#ffd27a",
  prose: "#e6d8bc",
} as const;

const STRIP_CARD_WIDTH = 246;
const GAP = 8;

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

function BlinkingCaret({ color, reduced }: { color: string; reduced: boolean }) {
  const o = useSharedValue(1);
  useEffect(() => {
    if (!reduced) o.value = withRepeat(withSequence(withTiming(0.15, { duration: 480 }), withTiming(1, { duration: 480 })), -1, false);
    else o.value = 1;
  }, [reduced, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: 5, height: 10, borderRadius: 1, marginLeft: 4, backgroundColor: color }, style]} />;
}

const DeskCard = memo(function DeskCard({
  desk,
  width,
  now,
  reduced,
  selected,
  onPress,
}: {
  desk: Desk;
  width: number;
  now: number;
  reduced: boolean;
  selected: boolean;
  onPress: (itemId: string) => void;
}) {
  const mood = deskMood(desk);
  const moodColor = MOOD_ACCENT[mood];
  const repoColor = `hsl(${desk.hue}, 72%, 58%)`;
  const edge = desk.attention === "ok" ? `hsl(${desk.hue}, 42%, 30%)` : ATTENTION_COLOR[desk.attention];
  const newest = desk.lines.length - 1;
  const live = !desk.quiet && (mood === "coding" || mood === "testing" || mood === "building" || mood === "shipping");

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
        backgroundColor: "#17120d",
        padding: 10,
        paddingTop: 11,
        gap: 6,
        overflow: "hidden",
        opacity: pressed ? 0.78 : 1,
      })}
    >
      {/* Top luminous repo strip */}
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2.5, backgroundColor: repoColor }} />

      {/* Header with custom live robot avatar */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <DeskAgentAvatar mood={mood} hue={desk.hue} reduced={reduced} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ flex: 1, fontFamily: MONO, fontSize: 12, fontWeight: "900", color: STAGE.labelLit }} numberOfLines={1}>
              {desk.label}
              {desk.attention === "needs_human" ? " !" : ""}
            </Text>
            <View style={{ borderRadius: 999, borderWidth: 1, borderColor: `${moodColor}66`, backgroundColor: `${moodColor}1a`, paddingHorizontal: 6, paddingVertical: 1 }}>
              <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: "800", letterSpacing: 0.8, color: moodColor }}>{MOOD_LABEL[mood]}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View style={{ width: 6, height: 6, borderRadius: 1.5, backgroundColor: repoColor }} />
            <Text style={{ flex: 1, fontSize: 10.5, color: "#9b896c" }} numberOfLines={1}>
              {desk.repo}
              {desk.threadStatus ? ` · ${desk.threadStatus}` : ""}
              {desk.tailAt !== null && desk.quiet ? ` · quiet ${ago(now - desk.tailAt)}` : ""}
            </Text>
          </View>
        </View>
      </View>

      {/* Recessed CRT terminal viewport */}
      <View
        style={{
          minHeight: 62,
          justifyContent: "flex-end",
          borderRadius: 8,
          borderWidth: 1,
          borderColor: "#292016",
          backgroundColor: "#0a0806",
          paddingHorizontal: 8,
          paddingVertical: 6,
        }}
      >
        {desk.lines.length ? (
          desk.lines.map((line, i) => {
            const isNewest = i === newest;
            const tone = tailLineTone(line);
            const color = isNewest && !desk.quiet ? LINE_COLOR[tone] : tone === "command-fail" ? "#c96a6a" : "#7e6d53";
            return (
              <View key={isNewest ? `${desk.tailAt ?? 0}:${i}` : i} style={{ flexDirection: "row", alignItems: "center" }}>
                {isNewest && !reduced ? (
                  <Animated.Text entering={FadeIn.duration(220)} numberOfLines={1} style={{ flexShrink: 1, fontFamily: MONO, fontSize: 10, lineHeight: 14, color }}>
                    {line || " "}
                  </Animated.Text>
                ) : (
                  <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: MONO, fontSize: 10, lineHeight: 14, color }}>
                    {line || " "}
                  </Text>
                )}
                {isNewest && live ? <BlinkingCaret color={moodColor} reduced={reduced} /> : null}
              </View>
            );
          })
        ) : (
          <Text style={{ fontFamily: MONO, fontSize: 10, color: colors.muted }} numberOfLines={2}>
            {desk.note ? `No live detail: ${desk.note}` : "Waiting for live stream…"}
          </Text>
        )}
      </View>

      {/* Live CI phase capsules */}
      {desk.ci ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }} accessibilityLabel={`CI ${desk.ci.summary}`}>
          {desk.ci.phases.slice(0, 6).map((p, i) => {
            const c = PHASE_COLOR[p.status];
            return (
              <View
                key={`${p.name}:${i}`}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 3,
                  borderRadius: 4,
                  borderWidth: 1,
                  borderColor: `${c}77`,
                  backgroundColor: `${c}1f`,
                  paddingHorizontal: 4,
                  paddingVertical: 1,
                }}
              >
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: c }} />
                <Text style={{ fontFamily: MONO, fontSize: 8.5, color: p.status === "queued" || p.status === "skipped" ? STAGE.label : c }} numberOfLines={1}>
                  {p.name}
                </Text>
              </View>
            );
          })}
          <Text style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 9, color: STAGE.label }} numberOfLines={1}>
            CI {desk.ci.summary}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});

/** The desks row. `width` is the space available; wide screens get a grid of up to 3 columns. */
export function DesksView({
  desks,
  width,
  now,
  reduced,
  selectedItemId,
  onPressDesk,
}: {
  desks: Desk[];
  width: number;
  now: number;
  reduced: boolean;
  selectedItemId: string | null;
  onPressDesk: (itemId: string) => void;
}) {
  if (!desks.length) return null;
  const columns = width >= 3 * STRIP_CARD_WIDTH + 2 * GAP + 24 ? 3 : 0;
  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingBottom: 6 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: STAGE.labelLit }} />
      <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: "700", letterSpacing: 1.4, color: STAGE.label }}>AGENT DESKS</Text>
      <View style={{ borderRadius: 4, backgroundColor: "#221b13", paddingHorizontal: 5, paddingVertical: 1 }}>
        <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: "800", color: STAGE.labelLit }}>{desks.length}</Text>
      </View>
    </View>
  );
  if (columns) {
    const cardWidth = Math.floor((width - 24 - GAP * (columns - 1)) / columns);
    return (
      <View testID="arcade-desks" style={{ borderTopWidth: 1, borderTopColor: "#261e15", paddingTop: 8 }}>
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
    <View testID="arcade-desks" style={{ borderTopWidth: 1, borderTopColor: "#261e15", paddingTop: 8 }}>
      {header}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: GAP, paddingHorizontal: 12 }}>
        {desks.map((d) => (
          <DeskCard key={d.itemId} desk={d} width={STRIP_CARD_WIDTH} now={now} reduced={reduced} selected={d.itemId === selectedItemId} onPress={onPressDesk} />
        ))}
      </ScrollView>
    </View>
  );
}
