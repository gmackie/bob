// Bob Arcade on iPhone and iPad (BOB-91 / BOB-92): the Floor lens over the live SDLC edge.
// The same edge session as the Attention screens (use-sdlc-edge), so opening the Arcade
// does not open a second socket.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { beatLine, createBeatLog, floorScene, floorSummary, hud } from "@bob/arcade";
import { rows, RELEASE_STAGE_PRESENTATION, STATE_PRESENTATION } from "@bob/sdlc-view";
import type { EdgeView } from "@bob/sdlc-view";

import { attentionEntries, bannerFor, firstQuestion, releaseReason } from "~/features/sdlc/attention-model";
import { ATTENTION_COLOR, OfflineBanner } from "~/features/sdlc/components";
import { useNow, useSdlcEdge } from "~/features/sdlc/use-sdlc-edge";
import { colors } from "~/lib/colors";

import type { LiveEffect } from "./arcade-model";
import { EFFECT_TTL_MS, expire, step } from "./arcade-model";
import { FloorView, STAGE } from "./FloorView";
import { playHaptic } from "./haptics";

const MONO = "Menlo";
const SIDE_PANEL_MIN_WIDTH = 700;

function HudStrip({ view }: { view: EdgeView }) {
  const h = hud(view);
  const cells: [string, number, string][] = [
    ["AGENTS", h.agents, "#ffd27a"],
    ["IN FLIGHT", h.inFlight, "#ffd27a"],
    ["CI", h.ci, "#6fb4ff"],
    ["NEEDS YOU", h.needsYou, h.needsYou ? colors.accent : "#ffd27a"],
    ["DEPLOYING", h.deploying, "#6fb4ff"],
    ["SHIPPED", h.shipped, "#7dffb0"],
    ["FAILED", h.failed, h.failed ? "#ff6b6b" : "#ffd27a"],
  ];
  return (
    <View
      accessible
      accessibilityLabel={cells.map(([k, v]) => `${k.toLowerCase()} ${v}`).join(", ")}
      style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4, paddingHorizontal: 14, paddingVertical: 10 }}
      testID="arcade-hud"
    >
      {cells.map(([k, v, c]) => (
        <Text key={k} style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: STAGE.label }}>
          {k} <Text style={{ fontSize: 13, fontWeight: "800", color: c }}>{v}</Text>
        </Text>
      ))}
    </View>
  );
}

function ItemPanel({ view, itemId, onClose, onOpenItem }: { view: EdgeView; itemId: string; onClose: () => void; onOpenItem?: (itemId: string) => void }) {
  const row = rows(view).find((r) => r.item.itemId === itemId);
  if (!row) return null;
  const release = row.item.release ? RELEASE_STAGE_PRESENTATION[row.item.release.stage].label : null;
  const question = firstQuestion(row);
  const reason = releaseReason(row.item);
  return (
    <View style={{ borderRadius: 14, backgroundColor: colors.card, padding: 14, gap: 6 }} testID="arcade-item-panel">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ATTENTION_COLOR[row.attention] }} />
        <Text style={{ flex: 1, color: colors.foreground, fontSize: 16, fontWeight: "700" }} numberOfLines={1}>
          {row.issue.identifier ?? row.issue.issueId}
        </Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close item" hitSlop={10}>
          <Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text>
        </Pressable>
      </View>
      <Text style={{ color: colors.secondaryForeground, fontSize: 13 }}>
        {row.target.repository.repositoryId} · {STATE_PRESENTATION[row.item.state].label}
        {release ? ` · ${release}` : ""}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{STATE_PRESENTATION[row.item.state].hint}</Text>
      {question ? <Text style={{ color: colors.foreground, fontSize: 14 }}>“{question}”</Text> : null}
      {reason ? <Text style={{ color: ATTENTION_COLOR[row.attention], fontSize: 13 }}>{reason}</Text> : null}
      {onOpenItem ? (
        <Pressable
          onPress={() => onOpenItem(itemId)}
          accessibilityRole="button"
          className="mt-1 items-center rounded-xl py-2 active:opacity-70"
          style={{ backgroundColor: colors.accent }}
          testID="arcade-open-item"
        >
          <Text style={{ color: colors.accentForeground, fontWeight: "700" }}>Open item</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function NeedsYou({ view, onSelect }: { view: EdgeView; onSelect: (itemId: string) => void }) {
  const entries = attentionEntries(view).slice(0, 6);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: STAGE.label }}>NEEDS YOU</Text>
      {entries.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 13 }}>Nothing is waiting on you. Tap a parcel to inspect it.</Text>
      ) : (
        entries.map((e) => (
          <Pressable key={e.itemId} onPress={() => onSelect(e.itemId)} accessibilityRole="button" accessibilityLabel={`${e.title}, ${e.stateLabel}`} className="rounded-xl px-3 py-2 active:opacity-70" style={{ backgroundColor: colors.card }}>
            <Text style={{ color: colors.foreground, fontWeight: "600" }} numberOfLines={1}>{e.title}</Text>
            <Text style={{ color: ATTENTION_COLOR[e.attention], fontSize: 12 }} numberOfLines={1}>{e.question ? `“${e.question}”` : e.stateLabel}</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

export function ArcadeScreen({ onOpenItem }: { onOpenItem?: (itemId: string) => void }) {
  const { state, retry } = useSdlcEdge();
  const view = state.view;
  const now = useNow();
  const reduced = useReducedMotion();
  const banner = bannerFor(view, state.connection, now, state.error);

  // Beats and effects. The first view is a baseline (sdlcBeats never celebrates it).
  const log = useMemo(() => createBeatLog(80), []);
  const prevView = useRef<EdgeView | null>(null);
  const effectsRef = useRef<LiveEffect[]>([]);
  const [effects, setEffects] = useState<LiveEffect[]>([]);
  useEffect(() => {
    const prev = prevView.current;
    prevView.current = view;
    if (!prev || prev === view) return;
    const t = Date.now();
    const out = step(log, prev, view, effectsRef.current, t);
    if (!out.beats.length) return;
    effectsRef.current = out.effects;
    setEffects(out.effects);
    playHaptic(out.haptic);
  }, [view, log]);
  useEffect(() => {
    if (!effects.length) return undefined;
    const id = setTimeout(() => {
      effectsRef.current = expire(effectsRef.current, Date.now());
      setEffects(effectsRef.current);
    }, EFFECT_TTL_MS);
    return () => clearTimeout(id);
  }, [effects]);
  useSyncExternalStore(log.subscribe, log.version);
  const ticker = log.recent(4);

  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [screenWidth, setScreenWidth] = useState(0);
  const scene = useMemo(() => (box ? floorScene(view, box) : null), [view, box]);
  const [selected, setSelected] = useState<string | null>(null);
  const select = useCallback((itemId: string) => setSelected((cur) => (cur === itemId ? null : itemId)), []);
  const side = screenWidth >= SIDE_PANEL_MIN_WIDTH;
  const waiting = view.epoch === null;

  const panel = selected ? (
    <ItemPanel view={view} itemId={selected} onClose={() => setSelected(null)} onOpenItem={onOpenItem} />
  ) : side ? (
    <NeedsYou view={view} onSelect={select} />
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: STAGE.bg }} onLayout={(e) => setScreenWidth(e.nativeEvent.layout.width)} testID="arcade-screen">
      {banner ? (
        <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
          <OfflineBanner banner={banner} now={now} onRetry={retry} />
        </View>
      ) : null}
      <HudStrip view={view} />
      <View style={{ flex: 1, flexDirection: side ? "row" : "column" }}>
        <View
          style={{ flex: 1, minHeight: 260 }}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setBox((cur) => (cur && cur.width === width && cur.height === height ? cur : { width, height }));
          }}
          accessible={false}
        >
          {waiting ? (
            <Text style={{ color: colors.muted, padding: 16 }}>Waiting for the first snapshot…</Text>
          ) : scene && scene.parcels.length === 0 && scene.overflow.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
              <Text style={{ fontFamily: MONO, color: STAGE.labelLit, letterSpacing: 2 }}>FLOOR IDLE</Text>
              <Text style={{ color: colors.muted, marginTop: 6, textAlign: "center" }}>No plan is running. Dispatch a plan and its issues roll onto the belt.</Text>
            </View>
          ) : scene ? (
            <View accessibilityLabel={floorSummary(scene).join(". ")}>
              <FloorView scene={scene} effects={effects} reduced={reduced} selectedItemId={selected} onPressParcel={select} />
            </View>
          ) : null}
        </View>
        {panel ? (
          side ? (
            <ScrollView style={{ width: 300, flexGrow: 0 }} contentContainerStyle={{ padding: 12 }}>{panel}</ScrollView>
          ) : (
            <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>{panel}</View>
          )
        ) : null}
      </View>
      <View style={{ paddingHorizontal: 14, paddingBottom: 12, paddingTop: 4, minHeight: 68 }} accessibilityLabel="Recent floor events" testID="arcade-ticker">
        {ticker.map((b) => (
          <Text key={b.id} numberOfLines={1} style={{ fontFamily: MONO, fontSize: 11, color: STAGE.label }}>
            {beatLine(b)}
          </Text>
        ))}
      </View>
    </View>
  );
}
