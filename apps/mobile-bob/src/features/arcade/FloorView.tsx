// The Floor lens on iPhone and iPad (BOB-92). The scene comes from @bob/arcade; this file
// only draws it. Parcels are views that spring to their station when the state changes,
// so every move on screen is a real coordinator transition. Under reduced motion they
// jump, markers stop bobbing and effects show without travel.
//
// Visual overhaul: retro-industrial brass & neon arcade stage powered by live WebSocket
// streams — machined conveyor with rotating pulleys, bespoke pure-RN station machinery
// (zero emojis), tactile cartridge parcels with segmented per-phase CI LEDs, radar sonar
// halos for human attention, multi-color confetti shockwaves, and arcade rubber stamps.
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
import type { CiPhase } from "@bob/sdlc-view";

import { ATTENTION_COLOR } from "~/features/sdlc/components";

import type { LiveEffect } from "./arcade-model";
import { METER_COLOR, TONE_COLOR } from "./arcade-model";
import { STATION_GLOW, StationArt } from "./StationArt";

export interface ParcelMeter {
  progress: number;
  state: keyof typeof METER_COLOR;
  phases?: readonly CiPhase[];
}

export const STAGE = {
  bg: "#100d09",
  panel: "#17120d",
  belt: "#241c13",
  rail: "#6d5638",
  dash: "#b89050",
  label: "#8a7758",
  labelLit: "#ffd27a",
  ink: "#17130e",
} as const;

const PHASE_LED: Record<CiPhase["status"], string> = {
  queued: "#4b3e2e",
  running: "#6fb4ff",
  passed: "#7dffb0",
  failed: "#ff6b6b",
  skipped: "#3a2f22",
  unknown: "#3a2f22",
};

const CONFETTI_COLORS = ["#7dffb0", "#ffd27a", "#6fb4ff", "#ff8ad8", "#d4850a", "#c39bff", "#ffffff"];

const MONO = "Menlo";
const SPRING = { damping: 18, stiffness: 140, mass: 0.9 };

// ── Belt ─────────────────────────────────────────────────────────────────────

function BeltPulley({ x, y, running, reduced }: { x: number; y: number; running: boolean; reduced: boolean }) {
  const rot = useSharedValue(0);
  useEffect(() => {
    if (running && !reduced) rot.value = withRepeat(withTiming(360, { duration: 1500, easing: Easing.linear }), -1, false);
    else rot.value = withTiming(0, { duration: 200 });
  }, [running, reduced, rot]);
  const spoke = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: x - 9,
        top: y - 9,
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: "#1d1710",
        borderWidth: 1.5,
        borderColor: "#7c633f",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View style={[{ width: 12, height: 12, alignItems: "center", justifyContent: "center" }, spoke]}>
        <View style={{ position: "absolute", width: 10, height: 1.5, borderRadius: 1, backgroundColor: "#b5945d" }} />
        <View style={{ position: "absolute", width: 1.5, height: 10, borderRadius: 1, backgroundColor: "#b5945d" }} />
      </Animated.View>
      <View style={{ position: "absolute", width: 4.5, height: 4.5, borderRadius: 2.5, backgroundColor: "#ffd27a" }} />
    </View>
  );
}

/** Machined industrial conveyor belt: runs only while something is in flight. */
function Belt({ scene, running, reduced }: { scene: FloorScene; running: boolean; reduced: boolean }) {
  const { x1, y1, x2, y2 } = scene.belt;
  const wide = scene.orientation === "wide";
  const length = wide ? x2 - x1 : y2 - y1;
  const shift = useSharedValue(0);
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (running && !reduced) {
      shift.value = withRepeat(withTiming(18, { duration: 850, easing: Easing.linear }), -1, false);
      pulse.value = withRepeat(withTiming(1, { duration: 2800, easing: Easing.linear }), -1, false);
    } else {
      shift.value = withTiming(0, { duration: 200 });
      pulse.value = withTiming(0, { duration: 200 });
    }
  }, [running, reduced, shift, pulse]);
  const dashes = useAnimatedStyle(() => ({ transform: [wide ? { translateX: shift.value } : { translateY: shift.value }] }));
  const energy = useAnimatedStyle(() => ({
    opacity: running && !reduced ? Math.sin(pulse.value * Math.PI) * 0.85 : 0,
    transform: [wide ? { translateX: pulse.value * length - 14 } : { translateY: pulse.value * length - 14 }],
  }));
  const count = Math.ceil(length / 18) + 2;

  return (
    <>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: wide ? x1 : x1 - 8,
          top: wide ? y1 - 8 : y1,
          width: wide ? length : 16,
          height: wide ? 16 : length,
          borderRadius: 8,
          backgroundColor: STAGE.belt,
          borderWidth: 1,
          borderColor: running ? STAGE.rail : "#3e3123",
          overflow: "hidden",
        }}
      >
        {/* Subtle metallic inner track highlight */}
        <View
          style={{
            position: "absolute",
            left: wide ? 0 : 1,
            right: wide ? 0 : undefined,
            top: wide ? 1 : 0,
            bottom: wide ? undefined : 0,
            width: wide ? undefined : 1.5,
            height: wide ? 1.5 : undefined,
            backgroundColor: "#a08253",
            opacity: 0.45,
          }}
        />
        <Animated.View style={[{ position: "absolute", left: wide ? -18 : 5, top: wide ? 5 : -18, flexDirection: wide ? "row" : "column" }, dashes]}>
          {Array.from({ length: count }, (_, i) => (
            <View
              key={i}
              style={{
                width: wide ? 7 : 4,
                height: wide ? 4 : 7,
                borderRadius: 1,
                marginRight: wide ? 11 : 0,
                marginBottom: wide ? 0 : 11,
                backgroundColor: running ? STAGE.dash : "#5c4a33",
                opacity: running ? 0.65 : 0.35,
              }}
            />
          ))}
        </Animated.View>
        {/* Gliding golden energy pulse along the track while items are in flight */}
        <Animated.View
          style={[
            {
              position: "absolute",
              left: wide ? 0 : 6,
              top: wide ? 6 : 0,
              width: wide ? 24 : 4,
              height: wide ? 4 : 24,
              borderRadius: 2,
              backgroundColor: "#ffd27a",
            },
            energy,
          ]}
        />
      </View>
      <BeltPulley x={x1} y={y1} running={running} reduced={reduced} />
      <BeltPulley x={x2} y={y2} running={running} reduced={reduced} />
    </>
  );
}

// ── Stations ─────────────────────────────────────────────────────────────────

function StationBackdrop({ scene }: { scene: FloorScene }) {
  const wide = scene.orientation === "wide";
  const beltStations = scene.stations.filter((s) => s.kind === "belt");
  const binStations = scene.stations.filter((s) => s.kind === "bin");
  const colW = wide && beltStations.length ? (scene.width - 24) / beltStations.length : 0;

  return (
    <>
      {/* Soft ambient bay tint under occupied stations in wide mode */}
      {wide
        ? beltStations.map((s, idx) => {
            const lit = s.count > 0;
            const glow = s.attention && s.attention !== "ok" ? ATTENTION_COLOR[s.attention] : STATION_GLOW[s.id];
            return (
              <View
                key={`bay-${s.id}`}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: s.x - colW / 2,
                  top: 2,
                  width: colW,
                  height: Math.max(0, scene.height - 32),
                  borderLeftWidth: idx > 0 ? 1 : 0,
                  borderLeftColor: "#261e15",
                  backgroundColor: lit ? `${glow}0b` : "transparent",
                }}
              />
            );
          })
        : null}

      {/* Recessed divider above Scrap & Cancelled bins */}
      {binStations[0] ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            top: binStations[0].y - 8,
            height: 1,
            backgroundColor: "#2f251a",
          }}
        />
      ) : null}
    </>
  );
}

function Stations({ scene, reduced }: { scene: FloorScene; reduced: boolean }) {
  const wide = scene.orientation === "wide";

  return (
    <>
      {scene.stations.map((s) => {
        const lit = s.count > 0;
        const color = s.attention && s.attention !== "ok" ? ATTENTION_COLOR[s.attention] : lit ? STATION_GLOW[s.id] : "#5e4e3a";
        if (s.kind === "bin") {
          return (
            <View
              key={s.id}
              pointerEvents="none"
              style={{ position: "absolute", left: s.x, top: s.y - 4, flexDirection: "row", alignItems: "center", gap: 5 }}
            >
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 2,
                  backgroundColor: lit ? (s.id === "scrap" ? "#ff6b6b" : "#9c8b73") : "#3b3023",
                }}
              />
              <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: "700", letterSpacing: 1, color: lit ? (s.id === "scrap" ? "#ff6b6b" : "#c7b69b") : STAGE.label }}>
                {s.label.toUpperCase()}
                {lit ? ` ${s.count}` : ""}
              </Text>
            </View>
          );
        }
        return (
          <View key={s.id} pointerEvents="none">
            <StationArt id={s.id} x={s.x} y={s.y} active={lit} color={color} reduced={reduced} />
            <Text
              numberOfLines={1}
              // "SHIPPED 15" outgrows the phone's label column; shrink it rather than cut the count (BOB-99).
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={{
                position: "absolute",
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: lit ? "800" : "600",
                letterSpacing: 1,
                color: lit ? STAGE.labelLit : STAGE.label,
                ...(wide ? { left: s.x - 52, width: 104, textAlign: "center", top: s.y - 31 } : { left: 6, width: Math.max(24, s.x - 24), textAlign: "right", top: s.y - 7 }),
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

function SonarHalo({ width, height, color, reduced }: { width: number; height: number; color: string; reduced: boolean }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!reduced) pulse.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }), -1, false);
    else pulse.value = 0;
  }, [reduced, pulse]);
  const style = useAnimatedStyle(() => ({
    opacity: reduced ? 0.5 : (1 - pulse.value) * 0.75,
    transform: [{ scaleX: 1 + pulse.value * 0.16 }, { scaleY: 1 + pulse.value * 0.3 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: -3,
          top: -3,
          width: width + 6,
          height: height + 6,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: color,
        },
        style,
      ]}
    />
  );
}

function CiScanline({ width, height, reduced }: { width: number; height: number; reduced: boolean }) {
  const x = useSharedValue(-16);
  useEffect(() => {
    if (!reduced) x.value = withRepeat(withTiming(width + 16, { duration: 1650, easing: Easing.inOut(Easing.quad) }), -1, false);
    else x.value = -16;
  }, [width, reduced, x]);
  const style = useAnimatedStyle(() => ({
    opacity: reduced ? 0 : 0.45,
    transform: [{ translateX: x.value }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", top: 0, bottom: 0, width: 12, height, backgroundColor: "#ffffff" }, style]}
    />
  );
}

const Parcel = memo(function Parcel({
  parcel,
  size,
  reduced,
  selected,
  onPress,
  compact,
  typingAt,
  meter,
}: {
  parcel: FloorParcel;
  size: { w: number; h: number };
  reduced: boolean;
  selected: boolean;
  onPress: (itemId: string) => void;
  compact: boolean;
  /** When the parcel's agent last wrote output (epoch ms), if it did. */
  typingAt: number | undefined;
  meter: ParcelMeter | null;
}) {
  const x = useSharedValue(parcel.x);
  const wobble = useSharedValue(0);
  const working = typingAt !== undefined && (parcel.state === "running" || parcel.state === "waiting-input");
  useEffect(() => {
    if (!working || reduced) return;
    wobble.value = withSequence(...Array.from({ length: 3 }, () => withSequence(withTiming(-2.5, { duration: 115 }), withTiming(2.5, { duration: 115 }))), withTiming(0, { duration: 115 }));
  }, [typingAt, working, reduced, wobble]);
  const wobbleStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${wobble.value}deg` }] }));
  const y = useSharedValue(parcel.y);
  const bob = useSharedValue(0);

  useEffect(() => {
    x.value = reduced ? parcel.x : withSpring(parcel.x, SPRING);
    y.value = reduced ? parcel.y : withSpring(parcel.y, SPRING);
  }, [parcel.x, parcel.y, reduced, x, y]);

  useEffect(() => {
    if (parcel.marker === "!" && !reduced) bob.value = withRepeat(withSequence(withTiming(-3.5, { duration: 420 }), withTiming(0, { duration: 420 })), -1, false);
    else bob.value = 0;
  }, [parcel.marker, reduced, bob]);

  // Position with left/top, not a translate: Reanimated's entering/exiting animations own
  // the transform while they run, so a translated parcel would flash at the origin.
  const pos = useAnimatedStyle(() => ({ left: x.value - size.w / 2, top: y.value - size.h / 2 }));
  const markerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));
  const edge = parcel.attention === "ok" ? (selected ? "#ffffff" : "rgba(255,255,255,0.22)") : ATTENTION_COLOR[parcel.attention];
  const tone = PARCEL_TONE[parcel.tone];
  const repoColor = `hsl(${parcel.hue}, 76%, 50%)`;
  const ciRunning = Boolean(meter?.state === "running") || parcel.stationId === "ci";
  // A compact parcel has one line: the identifier's number.
  const detail = compact ? "" : [parcel.sublabel, parcel.age].filter(Boolean).join(" · ");

  return (
    <Animated.View entering={reduced ? undefined : ZoomIn.springify().damping(14)} exiting={reduced ? undefined : FadeOut.duration(250)} style={[{ position: "absolute" }, pos]}>
      {parcel.attention === "needs_human" ? <SonarHalo width={size.w} height={size.h} color={ATTENTION_COLOR.needs_human} reduced={reduced} /> : null}
      <Animated.View style={wobbleStyle}>
        <Pressable
          onPress={() => onPress(parcel.itemId)}
          accessibilityRole="button"
          accessibilityLabel={parcel.accessibilityLabel}
          hitSlop={6}
          testID={`arcade-parcel-${parcel.itemId}`}
          style={{
            width: size.w,
            height: size.h,
            borderRadius: 6,
            backgroundColor: tone.fill,
            borderWidth: parcel.attention !== "ok" || selected ? 2 : 1,
            borderColor: edge,
            justifyContent: "center",
            paddingLeft: 9,
            paddingRight: 4,
            overflow: "hidden",
            shadowColor: working ? repoColor : "#000000",
            shadowOpacity: working ? 0.6 : 0.45,
            shadowRadius: working ? 7 : 4,
            shadowOffset: { width: 0, height: 2 },
          }}
        >
          {/* Specular top highlight & bottom bevel for tactile cartridge feel */}
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, backgroundColor: "rgba(255,255,255,0.32)" }} />
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 2, backgroundColor: "rgba(0,0,0,0.18)" }} />
          {/* The repository, as a luminous left tab: one repo's parcels read as a family. */}
          <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: repoColor }} />
          {ciRunning && !reduced ? <CiScanline width={size.w} height={size.h} reduced={reduced} /> : null}
          <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: compact ? 9 : 10, fontWeight: "800", color: tone.ink }}>
            {compact ? parcel.short : parcel.label}
          </Text>
          {detail ? (
            <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 9, color: tone.ink, opacity: 0.78 }}>
              {detail}
            </Text>
          ) : null}
        </Pressable>
      </Animated.View>
      {working && !reduced ? <TypingDots key={typingAt} hue={parcel.hue} width={size.w} /> : null}
      {meter ? <Meter meter={meter} width={size.w} height={size.h} reduced={reduced} /> : null}
      {parcel.marker ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              right: -7,
              top: -9,
              width: 17,
              height: 17,
              borderRadius: 9,
              borderWidth: 1,
              borderColor: STAGE.ink,
              backgroundColor: ATTENTION_COLOR[parcel.attention],
              alignItems: "center",
              justifyContent: "center",
            },
            markerStyle,
          ]}
        >
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: "900", color: STAGE.ink }}>{parcel.marker}</Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

/** Three dots over a parcel whose agent just wrote output; they fade after a few seconds. */
const TYPING_MS = 3_600;

function TypingDots({ hue, width }: { hue: number; width: number }) {
  const fade = useSharedValue(1);
  useEffect(() => {
    fade.value = withDelay(TYPING_MS - 400, withTiming(0, { duration: 400 }));
  }, [fade]);
  const style = useAnimatedStyle(() => ({ opacity: fade.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          top: -11,
          left: width / 2 - 15,
          width: 30,
          height: 11,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: "#4a3b28",
          backgroundColor: "#14100b",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 2.5,
        },
        style,
      ]}
    >
      {[0, 1, 2].map((i) => (
        <TypingDot key={i} index={i} color={`hsl(${hue}, 92%, 74%)`} />
      ))}
    </Animated.View>
  );
}

function TypingDot({ index, color }: { index: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(index * 110, withRepeat(withSequence(withTiming(1, { duration: 290 }), withTiming(0, { duration: 290 })), 6, false));
  }, [index, t]);
  const style = useAnimatedStyle(() => ({ opacity: 0.45 + t.value * 0.55, transform: [{ translateY: -t.value * 2.4 }] }));
  return <Animated.View style={[{ width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: color }, style]} />;
}

/** Segmented per-phase CI LED bar under a parcel (falls back to smooth progress bar when phases omitted). */
function Meter({ meter, width, height, reduced }: { meter: ParcelMeter; width: number; height: number; reduced: boolean }) {
  const fill = useSharedValue(meter.progress);
  const pulse = useSharedValue(1);
  const phases = meter.phases?.slice(0, 8) ?? [];
  const hasRunning = phases.some((p) => p.status === "running");

  useEffect(() => {
    fill.value = reduced ? meter.progress : withTiming(meter.progress, { duration: 550 });
  }, [meter.progress, reduced, fill]);

  useEffect(() => {
    if (hasRunning && !reduced) pulse.value = withRepeat(withSequence(withTiming(0.4, { duration: 420 }), withTiming(1, { duration: 420 })), -1, false);
    else pulse.value = 1;
  }, [hasRunning, reduced, pulse]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.max(8, fill.value * 100)}%` }));
  const runPipStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  if (phases.length) {
    return (
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 2,
          top: height + 2,
          width: width - 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: "#090705",
          flexDirection: "row",
          gap: 1.5,
          padding: 0.75,
        }}
      >
        {phases.map((p, i) =>
          p.status === "running" ? (
            <Animated.View key={`${p.name}:${i}`} style={[{ flex: 1, borderRadius: 1.5, backgroundColor: PHASE_LED[p.status] }, runPipStyle]} />
          ) : (
            <View key={`${p.name}:${i}`} style={{ flex: 1, borderRadius: 1.5, backgroundColor: PHASE_LED[p.status] }} />
          ),
        )}
      </View>
    );
  }

  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 2, top: height + 2, width: width - 4, height: 3.5, borderRadius: 2, backgroundColor: "#090705", overflow: "hidden" }}>
      <Animated.View style={[{ height: 3.5, borderRadius: 2, backgroundColor: METER_COLOR[meter.state] }, fillStyle]} />
    </View>
  );
}

/** Ambient sparks for live activity: glowing dots spraying up and out, plus a crisp pill tag. */
const SPARK_DOTS = 7;

function Sparks({ effect, x, y, reduced }: { effect: LiveEffect; x: number; y: number; reduced: boolean }) {
  const t = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!reduced) t.value = withTiming(1, { duration: 850, easing: Easing.out(Easing.quad) });
  }, [reduced, t]);
  const color = TONE_COLOR[effect.tone];
  const label = useAnimatedStyle(() => ({ opacity: 1 - t.value * 0.9, transform: [{ translateY: -14 - t.value * 14 }] }));
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: x, top: y }}>
      {reduced ? null : Array.from({ length: SPARK_DOTS }, (_, i) => <SparkDot key={i} index={i} seed={effect.beatId} t={t} color={color} />)}
      {effect.text ? (
        <Animated.View
          style={[
            {
              position: "absolute",
              left: -52,
              width: 104,
              alignItems: "center",
            },
            label,
          ]}
        >
          <View style={{ borderRadius: 999, borderWidth: 1, borderColor: `${color}88`, backgroundColor: "#14100be6", paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: "800", letterSpacing: 1, color }}>{effect.text}</Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

function SparkDot({ index, seed, t, color }: { index: number; seed: string; t: SharedValue<number>; color: string }) {
  // Deterministic per beat, so a re-render doesn't re-roll the spray.
  let h = 2166136261 ^ index;
  for (let k = 0; k < seed.length; k++) h = Math.imul(h ^ seed.charCodeAt(k), 16777619);
  const r = ((h >>> 0) % 1000) / 1000;
  const angle = -Math.PI / 2 + (r - 0.5) * 2.5;
  const dist = 14 + r * 18;
  const style = useAnimatedStyle(() => ({
    opacity: 1 - t.value,
    transform: [{ translateX: Math.cos(angle) * dist * t.value }, { translateY: -8 + Math.sin(angle) * dist * t.value }, { scale: 1 - t.value * 0.6 }],
  }));
  return <Animated.View style={[{ position: "absolute", left: -2, top: -2, width: 4, height: 4, borderRadius: 2, backgroundColor: color }, style]} />;
}

// ── Effects ──────────────────────────────────────────────────────────────────

const BURST_DOTS = 16;

function EffectSprite({ effect, x, y, reduced }: { effect: LiveEffect; x: number; y: number; reduced: boolean }) {
  if (effect.kind === "spark") return <Sparks effect={effect} x={x} y={y} reduced={reduced} />;
  return <LabelSprite effect={effect} x={x} y={y} reduced={reduced} />;
}

function LabelSprite({ effect, x, y, reduced }: { effect: LiveEffect; x: number; y: number; reduced: boolean }) {
  const t = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!reduced) t.value = withTiming(1, { duration: 1_300, easing: Easing.out(Easing.cubic) });
  }, [reduced, t]);
  const color = TONE_COLOR[effect.tone];
  const isBurst = effect.kind === "burst";
  const isStamp = effect.kind === "stamp";

  const label = useAnimatedStyle(() => ({
    opacity: reduced ? 1 : 1 - Math.max(0, t.value - 0.62) / 0.38,
    transform: [
      { translateY: isStamp ? -10 : -14 - t.value * 26 },
      { scale: isStamp ? 1.5 - 0.5 * Math.min(1, t.value * 5) : isBurst ? 0.7 + 0.5 * Math.min(1, t.value * 3.5) : 1 },
      { rotate: isStamp ? "-8deg" : "0deg" },
    ],
  }));

  const ring = useAnimatedStyle(() => ({
    opacity: (1 - t.value) * 0.85,
    transform: [{ scale: 0.3 + t.value * 2.1 }],
  }));

  return (
    <View pointerEvents="none" style={{ position: "absolute", left: x, top: y }}>
      {(isBurst || effect.kind === "pulse") && !reduced ? (
        <Animated.View
          style={[
            {
              position: "absolute",
              left: -18,
              top: -18,
              width: 36,
              height: 36,
              borderRadius: 18,
              borderWidth: isBurst ? 2 : 1.2,
              borderColor: color,
            },
            ring,
          ]}
        />
      ) : null}
      {isBurst && !reduced
        ? Array.from({ length: BURST_DOTS }, (_, i) => <BurstDot key={i} index={i} t={t} color={CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? color} />)
        : null}
      <Animated.View entering={FadeIn.duration(110)} style={[{ position: "absolute", left: -68, width: 136, alignItems: "center" }, label]}>
        <View
          style={{
            borderRadius: isStamp ? 5 : 999,
            borderWidth: isStamp ? 2 : 1,
            borderColor: color,
            backgroundColor: "#14100be8",
            paddingHorizontal: isStamp ? 7 : 8,
            paddingVertical: isBurst ? 3 : 2,
          }}
        >
          <Text style={{ fontFamily: MONO, fontSize: isBurst ? 13 : 11, fontWeight: "900", letterSpacing: 1.2, color }}>
            {isBurst ? `★ ${effect.text}` : effect.text}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

function BurstDot({ index, t, color }: { index: number; t: SharedValue<number>; color: string }) {
  const angle = (index / BURST_DOTS) * Math.PI * 2;
  const dist = 42 + (index % 3) * 14;
  const style = useAnimatedStyle(() => ({
    opacity: 1 - t.value,
    transform: [
      { translateX: Math.cos(angle) * dist * t.value },
      { translateY: Math.sin(angle) * dist * t.value + 28 * t.value * t.value },
      { rotate: `${t.value * (index % 2 ? 260 : -260)}deg` },
    ],
  }));
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: -2.5,
          top: -2.5,
          width: index % 3 === 0 ? 6 : 4,
          height: index % 3 === 0 ? 4 : 6,
          borderRadius: index % 2 ? 2 : 1,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

/** RESYNCING: the honest way to show a gap. Retro CRT scanline static over the stage. */
function StaticOverlay({ reduced }: { reduced: boolean }) {
  const o = useSharedValue(0.35);
  useEffect(() => {
    if (!reduced) o.value = withRepeat(withSequence(withTiming(0.16, { duration: 70 }), withDelay(40, withTiming(0.42, { duration: 60 }))), 8, true);
  }, [reduced, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "#2a241d", alignItems: "center", justifyContent: "center" }, style]}
    >
      <View style={{ borderRadius: 6, borderWidth: 1.5, borderColor: "#ffd27a", backgroundColor: "#120f0b", paddingHorizontal: 12, paddingVertical: 5 }}>
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: "900", letterSpacing: 2, color: "#ffd27a" }}>RESYNCING SIGNAL…</Text>
      </View>
    </Animated.View>
  );
}

const NONE = {} as const;

// ── Floor ────────────────────────────────────────────────────────────────────

export function FloorView({
  scene,
  effects,
  reduced,
  selectedItemId,
  onPressParcel,
  typing = NONE,
  meters = NONE,
}: {
  scene: FloorScene;
  effects: readonly LiveEffect[];
  reduced: boolean;
  selectedItemId: string | null;
  onPressParcel: (itemId: string) => void;
  /** Last agent output per item (epoch ms). */
  typing?: Readonly<Record<string, number>>;
  /** CI meters per item. */
  meters?: Readonly<Record<string, ParcelMeter | null>>;
}) {
  const at = useMemo(() => new Map(scene.parcels.map((p) => [p.itemId, p])), [scene.parcels]);
  const running = scene.parcels.some((p) => p.stationId !== "queue" && p.stationId !== "shipped" && p.stationId !== "scrap" && p.stationId !== "cancelled");
  const gap = effects.some((e) => e.kind === "static");
  const center = { x: scene.width / 2, y: scene.height / 2 };

  return (
    <View style={{ width: scene.width, height: scene.height }}>
      <StationBackdrop scene={scene} />
      <Belt scene={scene} running={running} reduced={reduced} />
      <Stations scene={scene} reduced={reduced} />
      {scene.overflow.map((o) => (
        <View
          key={`over-${o.stationId}`}
          pointerEvents="none"
          style={{
            position: "absolute",
            left: o.x - scene.parcel.w / 2,
            top: o.y - scene.parcel.h / 2,
            width: scene.parcel.w,
            height: scene.parcel.h,
            borderRadius: 6,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: STAGE.rail,
            backgroundColor: "#18130d",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: "700", color: STAGE.labelLit }}>+{o.count}</Text>
        </View>
      ))}
      {scene.parcels.map((p) => (
        <Parcel
          key={p.itemId}
          parcel={p}
          size={scene.parcel}
          reduced={reduced}
          selected={p.itemId === selectedItemId}
          onPress={onPressParcel}
          compact={scene.density === "compact"}
          typingAt={typing[p.itemId]}
          meter={meters[p.itemId] ?? null}
        />
      ))}
      {effects
        // An item's effect plays on its parcel; one whose parcel is not on this floor (another
        // project's, or behind an overflow counter) is skipped rather than drawn mid-floor.
        .filter((e) => e.kind !== "static" && (!e.itemId || at.has(e.itemId)))
        .map((e) => {
          const p = e.itemId ? at.get(e.itemId) : undefined;
          // An item scoped off the floor gets no effect; an item-less beat plays mid-floor.
          if (e.itemId && !p) return null;
          return <EffectSprite key={e.beatId} effect={e} x={p?.x ?? center.x} y={p?.y ?? center.y} reduced={reduced} />;
        })}
      {gap ? <StaticOverlay reduced={reduced} /> : null}
    </View>
  );
}
