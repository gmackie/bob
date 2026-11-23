// Custom pixel-industrial station machinery & live desk robot avatars for iPhone/iPad.
// Built purely with React Native Views + Reanimated (zero native deps, OTA-safe, zero emojis).
// Every animation only runs while occupied or streaming live WebSocket activity; under reduced
// motion everything rests calmly in place.
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { DeskMood, StationId } from "@bob/arcade";

export const STATION_GLOW: Record<StationId, string> = {
  queue: "#b59b72",
  ready: "#d49a3a",
  admit: "#5ec8e8",
  agents: "#6fb4ff",
  ci: "#59d8f0",
  review: "#ffd27a",
  deploy: "#c09cff",
  shipped: "#7dffb0",
  scrap: "#ff6b6b",
  cancelled: "#6d5f4d",
};

/** Custom animated station machine inside its circular housing (26×26 centered on x, y). */
export function StationArt({
  id,
  x,
  y,
  active,
  color,
  reduced,
}: {
  id: StationId;
  x: number;
  y: number;
  active: boolean;
  color: string;
  reduced: boolean;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (!active || reduced) {
      t.value = withTiming(0, { duration: 180 });
      return;
    }
    if (id === "ci") {
      t.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.linear }), -1, false);
    } else if (id === "deploy") {
      t.value = withRepeat(withSequence(withTiming(1, { duration: 85 }), withTiming(-1, { duration: 85 })), -1, true);
    } else if (id === "agents") {
      t.value = withRepeat(
        withSequence(withDelay(2000, withTiming(1, { duration: 90 })), withTiming(0, { duration: 110 })),
        -1,
        false,
      );
    } else {
      t.value = withRepeat(withSequence(withTiming(1, { duration: 760 }), withTiming(0, { duration: 760 })), -1, false);
    }
  }, [active, id, reduced, t]);

  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${t.value * 360}deg` }] }));
  const bobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -t.value * 2 }] }));
  const rumbleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: t.value * 0.8 }, { translateY: -Math.abs(t.value) * 0.6 }] }));
  const flameStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: 0.9 + Math.abs(t.value) * 0.55 }], opacity: 0.75 + Math.abs(t.value) * 0.25 }));
  const blinkStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: 1 - t.value * 0.85 }] }));
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + t.value * 0.16 }], opacity: 0.75 + t.value * 0.25 }));
  const scanStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (t.value - 0.5) * 2.4 }, { translateY: (t.value - 0.5) * 1.4 }] }));

  const glow = STATION_GLOW[id];
  const dim = active ? 1 : 0.42;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: x - 14,
        top: y - 14,
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: "#14100b",
        borderWidth: 1.5,
        borderColor: active ? color : "#3a2f22",
        alignItems: "center",
        justifyContent: "center",
        shadowColor: glow,
        shadowOpacity: active ? 0.55 : 0,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 0 },
      }}
    >
      <View style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center", opacity: dim }}>
        {id === "queue" ? (
          <Animated.View style={[{ alignItems: "center", justifyContent: "flex-end", height: 18 }, bobStyle]}>
            <View style={{ width: 8, height: 5, borderRadius: 1, backgroundColor: "#e2be82", marginBottom: 1 }} />
            <View style={{ flexDirection: "row", gap: 1.5, marginBottom: 1 }}>
              <View style={{ width: 7, height: 5.5, borderRadius: 1, backgroundColor: color }} />
              <View style={{ width: 7, height: 5.5, borderRadius: 1, backgroundColor: "#9c8058" }} />
            </View>
            <View style={{ width: 17, height: 2.5, borderRadius: 1, backgroundColor: "#6a5438" }} />
          </Animated.View>
        ) : id === "ready" ? (
          <View style={{ width: 18, height: 18 }}>
            <View style={{ position: "absolute", left: 3, top: 2, width: 2, height: 14, borderRadius: 1, backgroundColor: "#d9c6a3" }} />
            <Animated.View style={[{ position: "absolute", left: 2, top: 1, width: 4, height: 4, borderRadius: 2, backgroundColor: active ? "#7dffb0" : "#6a5638" }, pulseStyle]} />
            <Animated.View style={[{ position: "absolute", left: 5, top: 3.5, width: 11, height: 7, borderRadius: 1.5, backgroundColor: color, overflow: "hidden" }, bobStyle]}>
              <View style={{ position: "absolute", left: 1.5, top: 1, width: 3, height: 2.5, backgroundColor: "#17130e", opacity: 0.7 }} />
              <View style={{ position: "absolute", left: 4.5, top: 3.5, width: 3, height: 2.5, backgroundColor: "#17130e", opacity: 0.7 }} />
              <View style={{ position: "absolute", left: 7.5, top: 1, width: 3, height: 2.5, backgroundColor: "#17130e", opacity: 0.7 }} />
            </Animated.View>
            <View style={{ position: "absolute", left: 1, bottom: 1, width: 7, height: 2.5, borderRadius: 1, backgroundColor: "#78603e" }} />
          </View>
        ) : id === "admit" ? (
          <View style={{ width: 18, height: 18, alignItems: "center" }}>
            <Animated.View style={[{ width: 4, height: 4, borderRadius: 2, backgroundColor: active ? "#6fb4ff" : "#5c4c38", marginBottom: 1 }, pulseStyle]} />
            <View style={{ width: 17, height: 2.5, borderRadius: 1, backgroundColor: "#8a704c" }} />
            <View style={{ flexDirection: "row", width: 16, height: 11, justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ width: 3, height: 11, borderRadius: 1, backgroundColor: "#d9c6a3" }} />
              <Animated.View style={[{ width: 8, height: 2, borderRadius: 1, backgroundColor: color }, pulseStyle]} />
              <View style={{ width: 3, height: 11, borderRadius: 1, backgroundColor: "#d9c6a3" }} />
            </View>
          </View>
        ) : id === "agents" ? (
          <View style={{ alignItems: "center" }}>
            <View style={{ width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: active ? "#ffd27a" : "#6a5638" }} />
            <View style={{ width: 1.5, height: 2, backgroundColor: "#d9c6a3" }} />
            <View style={{ width: 15, height: 10, borderRadius: 3.5, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: 11, height: 5.5, borderRadius: 1.8, backgroundColor: "#0c1420", flexDirection: "row", alignItems: "center", justifyContent: "space-evenly" }}>
                <Animated.View style={[{ width: 2.5, height: 2.8, borderRadius: 0.8, backgroundColor: active ? "#7dffb0" : "#5a6c82" }, blinkStyle]} />
                <Animated.View style={[{ width: 2.5, height: 2.8, borderRadius: 0.8, backgroundColor: active ? "#7dffb0" : "#5a6c82" }, blinkStyle]} />
              </View>
            </View>
            <View style={{ width: 10, height: 2.5, borderRadius: 1, backgroundColor: "#78603e", marginTop: 1.5 }} />
          </View>
        ) : id === "ci" ? (
          <Animated.View style={[{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }, spinStyle]}>
            <View style={{ position: "absolute", width: 16, height: 4, borderRadius: 1.2, backgroundColor: color }} />
            <View style={{ position: "absolute", width: 4, height: 16, borderRadius: 1.2, backgroundColor: color }} />
            <View style={{ position: "absolute", width: 14, height: 3.6, borderRadius: 1.2, backgroundColor: color, transform: [{ rotate: "45deg" }] }} />
            <View style={{ position: "absolute", width: 14, height: 3.6, borderRadius: 1.2, backgroundColor: color, transform: [{ rotate: "-45deg" }] }} />
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: "#0e1720", alignItems: "center", justifyContent: "center" }}>
                <View style={{ width: 2.4, height: 2.4, borderRadius: 1.2, backgroundColor: active ? "#7dffb0" : "#5a6c75" }} />
              </View>
            </View>
          </Animated.View>
        ) : id === "review" ? (
          <Animated.View style={[{ width: 18, height: 18 }, scanStyle]}>
            <View style={{ position: "absolute", left: 1.5, top: 1.5, width: 11.5, height: 11.5, borderRadius: 6, borderWidth: 2.2, borderColor: color, backgroundColor: "#142029", alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: 6, height: 1.2, backgroundColor: "#7fd3e8", opacity: 0.85 }} />
            </View>
            <View style={{ position: "absolute", right: 2, bottom: 2.5, width: 6.5, height: 2.6, borderRadius: 1.3, backgroundColor: "#b8863b", transform: [{ rotate: "45deg" }] }} />
          </Animated.View>
        ) : id === "deploy" ? (
          <Animated.View style={[{ alignItems: "center", justifyContent: "center" }, rumbleStyle]}>
            {/* Nose + fuselage */}
            <View style={{ width: 8, height: 11, borderTopLeftRadius: 5, borderTopRightRadius: 5, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: color, alignItems: "center", paddingTop: 3 }}>
              <View style={{ width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: "#0d1726", borderWidth: 0.8, borderColor: "#ffffff" }} />
            </View>
            {/* Side fins */}
            <View style={{ position: "absolute", left: 2, top: 7, width: 3, height: 5, borderTopLeftRadius: 2, backgroundColor: "#d4850a" }} />
            <View style={{ position: "absolute", right: 2, top: 7, width: 3, height: 5, borderTopRightRadius: 2, backgroundColor: "#d4850a" }} />
            {/* Thruster flame */}
            <Animated.View style={[{ width: 5, height: 5, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, backgroundColor: "#ff7a2f", alignItems: "center" }, flameStyle]}>
              <View style={{ width: 2.4, height: 3, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: "#fff0a6" }} />
            </Animated.View>
          </Animated.View>
        ) : id === "shipped" ? (
          <Animated.View style={[{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }, pulseStyle]}>
            <View style={{ position: "absolute", width: 11, height: 11, borderRadius: 2, backgroundColor: color, transform: [{ rotate: "45deg" }] }} />
            <View style={{ position: "absolute", width: 11, height: 11, borderRadius: 2, backgroundColor: color }} />
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: "#ffffff", opacity: 0.8 }} />
            <View style={{ position: "absolute", top: 0, right: 0, width: 3, height: 3, borderRadius: 1.5, backgroundColor: "#ffd27a" }} />
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

/** Mini custom animated agent robot bust for Desk cards on iPhone & iPad. */
export function DeskAgentAvatar({ mood, hue, reduced }: { mood: DeskMood; hue: number; reduced: boolean }) {
  const active = mood !== "idle" && mood !== "stalled";
  const bob = useSharedValue(0);
  const blink = useSharedValue(0);

  useEffect(() => {
    if (!active || reduced) {
      bob.value = withTiming(0, { duration: 150 });
      blink.value = withTiming(0, { duration: 150 });
      return;
    }
    bob.value = withRepeat(withSequence(withTiming(-1.8, { duration: 420 }), withTiming(0, { duration: 420 })), -1, false);
    blink.value = withRepeat(
      withSequence(withDelay(2100, withTiming(1, { duration: 85 })), withTiming(0, { duration: 100 })),
      -1,
      false,
    );
  }, [active, reduced, bob, blink]);

  const headStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));
  const eyeStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: 1 - blink.value * 0.85 }] }));

  const rim =
    mood === "asking"
      ? "#ffd27a"
      : mood === "ci-failed"
        ? "#ff6b6b"
        : mood === "ci-green"
          ? "#7dffb0"
          : mood === "shipping"
            ? "#b9a2ff"
            : mood === "testing" || mood === "ci-running"
              ? "#6fb4ff"
              : `hsl(${hue}, 62%, 56%)`;
  const eye =
    mood === "asking"
      ? "#ffd27a"
      : mood === "ci-failed"
        ? "#ff6b6b"
        : mood === "ci-green"
          ? "#7dffb0"
          : mood === "stalled"
            ? "#ff9f43"
            : "#7fd3e8";

  return (
    <Animated.View style={[{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }, headStyle]}>
      <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: eye }} />
      <View style={{ width: 1.5, height: 2, backgroundColor: "#bba47e" }} />
      <View
        style={{
          width: 20,
          height: 13,
          borderRadius: 4,
          backgroundColor: "#231c15",
          borderWidth: 1.5,
          borderColor: rim,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ width: 13, height: 7, borderRadius: 2, backgroundColor: "#0a0e14", flexDirection: "row", alignItems: "center", justifyContent: "space-evenly" }}>
          <Animated.View style={[{ width: 3, height: 3.4, borderRadius: mood === "asking" ? 1.7 : 1, backgroundColor: eye }, eyeStyle]} />
          <Animated.View style={[{ width: 3, height: 3.4, borderRadius: mood === "asking" ? 1.7 : 1, backgroundColor: eye }, eyeStyle]} />
        </View>
      </View>
      <View style={{ width: 12, height: 2.5, borderRadius: 1.2, backgroundColor: rim, opacity: active ? 0.85 : 0.35, marginTop: 1.5 }} />
    </Animated.View>
  );
}
