import { Image, Platform, StyleSheet, Text, View } from "react-native";
import Animated, { Keyframe } from "react-native-reanimated";
import { beatLine, beatTone } from "@bob/arcade";
import type { ControlRoomFeed } from "@bob/arcade";

const art = {
  base: require("@bob/arcade/art/work.png"),
  agent: require("@bob/arcade/art/terminal-light.png"),
  ci: require("@bob/arcade/art/rack-light.png"),
  good: require("@bob/arcade/art/rack-pass.png"),
  bad: require("@bob/arcade/art/rack-fail.png"),
  shipment: require("@bob/arcade/art/dispatch-light.png"),
};

const terminal = new Keyframe({
  0: { opacity: 0.15 },
  18: { opacity: 1 },
  42: { opacity: 0.45 },
  62: { opacity: 1 },
  100: { opacity: 0 },
}).duration(880);
const checks = new Keyframe({
  0: { opacity: 0 },
  24: { opacity: 1 },
  74: { opacity: 1 },
  100: { opacity: 0 },
}).duration(1240);
const dispatch = new Keyframe({
  0: { opacity: 0, transform: [{ translateX: -3 }] },
  20: { opacity: 1 },
  100: { opacity: 0, transform: [{ translateX: 4 }] },
}).duration(1040);

export function ControlRoom({
  feed,
  status,
  live,
  reduced,
  compact,
}: {
  feed: ControlRoomFeed;
  status: string;
  live: boolean;
  reduced: boolean;
  compact: boolean;
}) {
  const tone = feed.ci && beatTone(feed.ci);
  const latest = feed.events[0];
  const glow = live ? "#9bdbb9" : "#f4bf72";
  return (
    <View style={[s.cabinet, compact && s.compact]} testID="arcade-control-room">
      <View style={s.copy}>
        <View style={s.connection}>
          <View style={[s.led, { backgroundColor: glow }]} />
          <Text style={[s.label, { color: glow }]}>{status}</Text>
        </View>
        <Text accessibilityRole="header" style={[s.title, compact && s.smallTitle]}>
          Arcade
        </Text>
        {!compact && (
          <Text numberOfLines={2} style={s.event}>
            {latest
              ? beatLine(latest)
              : live
                ? "Waiting for floor activity"
                : "Waiting for the live feed"}
          </Text>
        )}
      </View>
      <View
        style={[s.art, compact && s.smallArt]}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Image source={art.base} style={s.plate} resizeMode="stretch" fadeDuration={0} />
        {live && !reduced && feed.agent && (
          <Animated.Image
            key={feed.agent.id}
            source={art.agent}
            style={s.plate}
            resizeMode="stretch"
            entering={terminal}
          />
        )}
        {live && !reduced && feed.ci && (
          <Animated.Image
            key={feed.ci.id}
            source={tone === "bad" ? art.bad : tone === "good" ? art.good : art.ci}
            style={s.plate}
            resizeMode="stretch"
            entering={checks}
          />
        )}
        {live && !reduced && feed.shipment && (
          <Animated.Image
            key={feed.shipment.id}
            source={art.shipment}
            style={s.plate}
            resizeMode="stretch"
            entering={dispatch}
          />
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  cabinet: {
    backgroundColor: "#192729",
    borderBottomWidth: 2,
    borderColor: "#826641",
    paddingLeft: 18,
    paddingRight: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
    minHeight: 104,
  },
  compact: { minHeight: 52 },
  copy: { flex: 1, minWidth: 0, paddingVertical: 10, gap: 3 },
  connection: { flexDirection: "row", alignItems: "center", gap: 7 },
  led: { width: 7, height: 7, borderRadius: 2 },
  label: {
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontWeight: "700",
    fontSize: 10,
    letterSpacing: 1.3,
    textTransform: "uppercase",
  },
  title: { color: "#fff2d5", fontSize: 35, fontWeight: "900", letterSpacing: -1.8, lineHeight: 41 },
  smallTitle: { fontSize: 23, lineHeight: 26, letterSpacing: -1 },
  event: { color: "#c8d5cf", fontSize: 13, lineHeight: 17 },
  art: { width: "39%", maxWidth: 217, aspectRatio: 480 / 296 },
  smallArt: { width: 80 },
  plate: { position: "absolute", width: "100%", height: "100%", left: 0, top: 0 },
});
