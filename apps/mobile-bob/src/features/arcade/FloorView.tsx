// The Floor lens on iPhone and iPad (BOB-92). The scene comes from @bob/arcade; this file
// only draws it. Parcels are views that spring to their station when the state changes,
// so every move on screen is a real coordinator transition. Under reduced motion they
// jump, markers stop bobbing and effects show without travel.
import { memo, useEffect, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { PARCEL_TONE } from "@bob/arcade";
import type { FloorParcel, FloorScene } from "@bob/arcade";

import { ATTENTION_COLOR } from "~/features/sdlc/components";

import type { LiveEffect } from "./arcade-model";
import { TONE_COLOR } from "./arcade-model";

export const STAGE = {
  bg: "#120f0b",
  belt: "#3a2f22",
  dash: "#6a5638",
  label: "#8a7758",
  labelLit: "#ffd27a",
  ink: "#17130e",
} as const;

const MONO = "Menlo";
const SPRING = { damping: 18, stiffness: 140, mass: 0.9 };

// ── Belt ─────────────────────────────────────────────────────────────────────

/** The belt runs only while something is in flight: an idle floor looks idle. */
function Belt({ scene, running, reduced }: { scene: FloorScene; running: boolean; reduced: boolean }) {
  const { x1, y1, x2, y2 } = scene.belt;
  const wide = scene.orientation === "wide";
  const length = wide ? x2 - x1 : y2 - y1;
  const shift = useSharedValue(0);
  useEffect(() => {
    if (running && !reduced) shift.value = withRepeat(withTiming(18, { duration: 900, easing: Easing.linear }), -1, false);
    else shift.value = withTiming(0, { duration: 200 });
  }, [running, reduced, shift]);
  const dashes = useAnimatedStyle(() => ({ transform: [wide ? { translateX: shift.value } : { translateY: shift.value }] }));
  const count = Math.ceil(length / 18) + 2;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: wide ? x1 : x1 - 7,
        top: wide ? y1 - 7 : y1,
        width: wide ? length : 14,
        height: wide ? 14 : length,
        borderRadius: 7,
        backgroundColor: STAGE.belt,
        overflow: "hidden",
      }}
    >
      <Animated.View style={[{ position: "absolute", left: wide ? -18 : 6, top: wide ? 6 : -18, flexDirection: wide ? "row" : "column" }, dashes]}>
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={{ width: wide ? 8 : 2, height: wide ? 2 : 8, marginRight: wide ? 10 : 0, marginBottom: wide ? 0 : 10, backgroundColor: STAGE.dash }} />
        ))}
      </Animated.View>
    </View>
  );
}

// ── Stations ─────────────────────────────────────────────────────────────────

function Stations({ scene }: { scene: FloorScene }) {
  const wide = scene.orientation === "wide";
  return (
    <>
      {scene.stations.map((s) => {
        const lit = s.count > 0;
        const color = s.attention && s.attention !== "ok" ? ATTENTION_COLOR[s.attention] : lit ? "#d4850a" : STAGE.belt;
        if (s.kind === "bin") {
          return (
            <Text
              key={s.id}
              style={{ position: "absolute", left: s.x, top: s.y - 4, fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: lit ? color : STAGE.label }}
            >
              {s.label.toUpperCase()}
              {lit ? ` ${s.count}` : ""}
            </Text>
          );
        }
        return (
          <View key={s.id} pointerEvents="none">
            <View style={{ position: "absolute", left: s.x - 5, top: s.y - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
            <Text
              numberOfLines={1}
              // "SHIPPED 15" outgrows the phone's label column; shrink it rather than cut the count (BOB-99).
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={{
                position: "absolute",
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: 1,
                color: lit ? STAGE.labelLit : STAGE.label,
                ...(wide ? { left: s.x - 50, width: 100, textAlign: "center", top: s.y - 26 } : { left: 8, width: s.x - 16, textAlign: "right", top: s.y - 7 }),
              }}
            >
              {s.label.toUpperCase()}
              {lit ? ` ${s.count}` : ""}
            </Text>
          </View>
        );
      })}
    </>
  );
}

// ── Parcels ──────────────────────────────────────────────────────────────────

const Parcel = memo(function Parcel({
  parcel,
  size,
  reduced,
  selected,
  onPress,
}: {
  parcel: FloorParcel;
  size: { w: number; h: number };
  reduced: boolean;
  selected: boolean;
  onPress: (itemId: string) => void;
}) {
  const x = useSharedValue(parcel.x);
  const y = useSharedValue(parcel.y);
  const bob = useSharedValue(0);

  useEffect(() => {
    x.value = reduced ? parcel.x : withSpring(parcel.x, SPRING);
    y.value = reduced ? parcel.y : withSpring(parcel.y, SPRING);
  }, [parcel.x, parcel.y, reduced, x, y]);

  useEffect(() => {
    if (parcel.marker === "!" && !reduced) bob.value = withRepeat(withSequence(withTiming(-3, { duration: 450 }), withTiming(0, { duration: 450 })), -1, false);
    else bob.value = 0;
  }, [parcel.marker, reduced, bob]);

  // Position with left/top, not a translate: Reanimated's entering/exiting animations own
  // the transform while they run, so a translated parcel would flash at the origin.
  const pos = useAnimatedStyle(() => ({ left: x.value - size.w / 2, top: y.value - size.h / 2 }));
  const markerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));
  const edge = parcel.attention === "ok" ? (selected ? "#ffffff" : "transparent") : ATTENTION_COLOR[parcel.attention];
  const tone = PARCEL_TONE[parcel.tone];
  const detail = [parcel.sublabel, parcel.age].filter(Boolean).join(" · ");

  return (
    <Animated.View entering={reduced ? undefined : ZoomIn.springify().damping(14)} exiting={reduced ? undefined : FadeOut.duration(250)} style={[{ position: "absolute" }, pos]}>
      <Pressable
        onPress={() => onPress(parcel.itemId)}
        accessibilityRole="button"
        accessibilityLabel={parcel.accessibilityLabel}
        hitSlop={6}
        testID={`arcade-parcel-${parcel.itemId}`}
        style={{
          width: size.w,
          height: size.h,
          borderRadius: 5,
          backgroundColor: tone.fill,
          borderWidth: 2,
          borderColor: edge,
          justifyContent: "center",
          paddingLeft: 7,
          paddingRight: 3,
          overflow: "hidden",
        }}
      >
        {/* The repository, as a stripe: one repo's parcels still read as a family. */}
        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: `hsl(${parcel.hue}, 70%, 45%)` }} />
        <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10, fontWeight: "700", color: tone.ink }}>
          {parcel.label}
        </Text>
        {detail ? (
          <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 9, color: tone.ink, opacity: 0.75 }}>
            {detail}
          </Text>
        ) : null}
      </Pressable>
      {parcel.marker ? (
        <Animated.View pointerEvents="none" style={[{ position: "absolute", right: -6, top: -9, width: 16, height: 16, borderRadius: 8, backgroundColor: ATTENTION_COLOR[parcel.attention], alignItems: "center", justifyContent: "center" }, markerStyle]}>
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: "900", color: STAGE.ink }}>{parcel.marker}</Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

// ── Effects ──────────────────────────────────────────────────────────────────

const BURST_DOTS = 12;

function EffectSprite({ effect, x, y, reduced }: { effect: LiveEffect; x: number; y: number; reduced: boolean }) {
  const t = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!reduced) t.value = withTiming(1, { duration: 1_200, easing: Easing.out(Easing.cubic) });
  }, [reduced, t]);
  const color = TONE_COLOR[effect.tone];
  const label = useAnimatedStyle(() => ({ opacity: reduced ? 1 : 1 - Math.max(0, t.value - 0.6) / 0.4, transform: [{ translateY: -14 - t.value * 22 }, { scale: effect.kind === "stamp" ? 1.25 - 0.25 * Math.min(1, t.value * 4) : 1 }] }));

  return (
    <View pointerEvents="none" style={{ position: "absolute", left: x, top: y }}>
      {effect.kind === "burst" && !reduced
        ? Array.from({ length: BURST_DOTS }, (_, i) => <BurstDot key={i} index={i} t={t} color={color} />)
        : null}
      <Animated.Text
        entering={FadeIn.duration(120)}
        style={[{ position: "absolute", left: -60, width: 120, textAlign: "center", fontFamily: MONO, fontSize: effect.kind === "burst" ? 13 : 11, fontWeight: "900", letterSpacing: 1, color, textShadowColor: "#000", textShadowRadius: 4 }, label]}
      >
        {effect.text}
      </Animated.Text>
    </View>
  );
}

function BurstDot({ index, t, color }: { index: number; t: SharedValue<number>; color: string }) {
  const angle = (index / BURST_DOTS) * Math.PI * 2;
  const style = useAnimatedStyle(() => ({
    opacity: 1 - t.value,
    transform: [{ translateX: Math.cos(angle) * 46 * t.value }, { translateY: Math.sin(angle) * 46 * t.value + 30 * t.value * t.value }],
  }));
  return <Animated.View style={[{ position: "absolute", left: -2, top: -2, width: 4, height: 4, borderRadius: 2, backgroundColor: color }, style]} />;
}

/** RESYNCING: the honest way to show a gap. Static noise over the stage, no guessing. */
function StaticOverlay({ reduced }: { reduced: boolean }) {
  const o = useSharedValue(0.35);
  useEffect(() => {
    if (!reduced) o.value = withRepeat(withSequence(withTiming(0.15, { duration: 70 }), withDelay(40, withTiming(0.4, { duration: 60 }))), 8, true);
  }, [reduced, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "#8a8a8a" }, style]} />
  );
}

// ── Floor ────────────────────────────────────────────────────────────────────

export function FloorView({
  scene,
  effects,
  reduced,
  selectedItemId,
  onPressParcel,
}: {
  scene: FloorScene;
  effects: readonly LiveEffect[];
  reduced: boolean;
  selectedItemId: string | null;
  onPressParcel: (itemId: string) => void;
}) {
  const at = useMemo(() => new Map(scene.parcels.map((p) => [p.itemId, p])), [scene.parcels]);
  const running = scene.parcels.some((p) => p.stationId !== "queue" && p.stationId !== "shipped" && p.stationId !== "scrap" && p.stationId !== "cancelled");
  const gap = effects.some((e) => e.kind === "static");
  const center = { x: scene.width / 2, y: scene.height / 2 };

  return (
    <View style={{ width: scene.width, height: scene.height }}>
      <Belt scene={scene} running={running} reduced={reduced} />
      <Stations scene={scene} />
      {scene.overflow.map((o) => (
        <View key={`over-${o.stationId}`} pointerEvents="none" style={{ position: "absolute", left: o.x - scene.parcel.w / 2, top: o.y - scene.parcel.h / 2, width: scene.parcel.w, height: scene.parcel.h, borderRadius: 5, borderWidth: 1, borderColor: STAGE.dash, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontFamily: MONO, fontSize: 10, color: STAGE.labelLit }}>+{o.count}</Text>
        </View>
      ))}
      {scene.parcels.map((p) => (
        <Parcel key={p.itemId} parcel={p} size={scene.parcel} reduced={reduced} selected={p.itemId === selectedItemId} onPress={onPressParcel} />
      ))}
      {effects
        // An item's effect plays on its parcel; one whose parcel is not on this floor (another
        // project's, or behind an overflow counter) is skipped rather than drawn mid-floor.
        .filter((e) => e.kind !== "static" && (!e.itemId || at.has(e.itemId)))
        .map((e) => {
          const p = e.itemId ? at.get(e.itemId) : undefined;
          return <EffectSprite key={e.beatId} effect={e} x={p?.x ?? center.x} y={p?.y ?? center.y} reduced={reduced} />;
        })}
      {gap ? <StaticOverlay reduced={reduced} /> : null}
    </View>
  );
}
