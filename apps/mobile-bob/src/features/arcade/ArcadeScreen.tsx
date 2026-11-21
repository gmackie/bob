// Bob Arcade on iPhone and iPad (BOB-91 / BOB-92): the Floor lens over the live SDLC edge.
// The same edge session as the Attention screens (use-sdlc-edge), so opening the Arcade
// does not open a second socket.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { beatLine, createBeatLog, desks as deskCards, floorScene, floorSummary, hud, shippedToday, WIDE_MIN_WIDTH } from "@bob/arcade";
import type { Desk } from "@bob/arcade";
import { rows, RELEASE_STAGE_PRESENTATION, STATE_PRESENTATION } from "@bob/sdlc-view";
import type { EdgeView } from "@bob/sdlc-view";

import { attentionEntries, bannerFor, firstQuestion, releaseReason } from "~/features/sdlc/attention-model";
import type { Banner } from "~/features/sdlc/commands-model";
import { ATTENTION_COLOR, OfflineBanner } from "~/features/sdlc/components";
import { contentFor } from "~/features/sdlc/live-activity";
import { useLiveActivity, useLiveActivityPreview, useNow, useSdlcEdge, useShipped, useWatchDesks } from "~/features/sdlc/use-sdlc-edge";
import { colors } from "~/lib/colors";

import type { LiveEffect } from "./arcade-model";
import { EFFECT_TTL_MS, expire, step } from "./arcade-model";
import { demoDeskDetail } from "./demo-feed";
import { DesksView } from "./DesksView";
import { FloorView, STAGE } from "./FloorView";
import { playHaptic } from "./haptics";
import { useDemoEdge } from "./use-demo-edge";
import { useDeskIds } from "./use-desk-ids";

const MONO = "Menlo";
/**
 * The Needs-you side panel takes 300pt, and the floor wants WIDE_MIN_WIDTH beside it: so
 * iPad landscape gets the panel, iPad portrait keeps the full width for the wide floor.
 */
const SIDE_PANEL_MIN_WIDTH = 300 + WIDE_MIN_WIDTH;

function HudStrip({ view, demo, today, clock }: { view: EdgeView; demo: boolean; today: number | null; clock: number }) {
  const h = hud(view, {}, clock);
  const cells: [string, number | string, string][] = [
    ["AGENTS", h.agents, "#ffd27a"],
    ["IN FLIGHT", h.inFlight, "#ffd27a"],
    ["CI", h.ci, "#6fb4ff"],
    ["NEEDS YOU", h.needsYou, h.needsYou ? colors.accent : "#ffd27a"],
    // Sat too long where the system should have moved it on (BOB-101).
    ["STALLED", h.stalled, h.stalled ? "#ff9f43" : "#ffd27a"],
    ["DEPLOYING", h.deploying, "#6fb4ff"],
    ["SHIPPED", h.shipped, "#7dffb0"],
    ["FAILED", h.failed, h.failed ? "#ff6b6b" : "#ffd27a"],
    // Reached production since local midnight (BOB-95); a dash until the edge answers.
    ["TODAY", today ?? "–", "#7dffb0"],
  ];
  return (
    <View
      accessible
      accessibilityLabel={cells.map(([k, v]) => `${k.toLowerCase()} ${v}`).join(", ")}
      style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4, paddingHorizontal: 14, paddingVertical: 10 }}
      testID="arcade-hud"
    >
      {demo ? <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: "#000", backgroundColor: "#ffd27a", paddingHorizontal: 4 }}>DEMO FEED</Text> : null}
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
          style={({ pressed }) => ({ marginTop: 4, alignItems: "center", borderRadius: 12, paddingVertical: 8, backgroundColor: colors.accent, opacity: pressed ? 0.7 : 1 })}
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
          <Pressable key={e.itemId} onPress={() => onSelect(e.itemId)} accessibilityRole="button" accessibilityLabel={`${e.title}, ${e.stateLabel}`} style={({ pressed }) => ({ borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 })}>
            <Text style={{ color: colors.foreground, fontWeight: "600" }} numberOfLines={1}>{e.title}</Text>
            <Text style={{ color: ATTENTION_COLOR[e.attention], fontSize: 12 }} numberOfLines={1}>{e.question ? `“${e.question}”` : e.stateLabel}</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

/** The Arcade over the live SDLC edge. */
export function ArcadeScreen({ onOpenItem }: { onOpenItem?: (itemId: string) => void }) {
  const { state, retry } = useSdlcEdge();
  const now = useNow();
  const ids = useDeskIds(state.view);
  // Only desks inside the session's watch set get live detail, so only those are drawn.
  const watching = useWatchDesks(ids);
  const shipped = useShipped();
  const desks = useMemo(
    () => deskCards(state.view, ids.filter((id) => watching.includes(id)), (id) => state.attempts[id], now),
    [state.view, state.attempts, ids, watching, now],
  );
  return (
    <ArcadeView
      view={state.view}
      banner={bannerFor(state.view, state.connection, now, state.error)}
      now={now}
      desks={desks}
      today={shipped ? shippedToday(shipped, now) : null}
      onRetry={retry}
      onOpenItem={onOpenItem}
    />
  );
}

/** Dev-only: the Arcade over a scripted feed (demo-feed.ts), for screenshots and the wall demo. */
export function DemoArcadeScreen() {
  const view = useDemoEdge();
  const now = useNow(DEMO_TICK_MS);
  const ids = useDeskIds(view);
  const tick = Math.floor(now / DEMO_TICK_MS);
  const desks = useMemo(() => deskCards(view, ids, (id) => demoDeskDetail(view.items[id]?.state, id, tick, now), now), [view, ids, tick, now]);
  const today = Object.values(view.items).filter((i) => i.state === "completed").length;
  return (
    <View style={{ flex: 1 }}>
      <ArcadeView view={view} banner={null} now={now} desks={desks} today={today} demo />
      <DemoLiveActivityToggle view={view} />
    </View>
  );
}

const DEMO_FOLLOW_ITEM = "demo-0";
const DEMO_TICK_MS = 1_100;

/** Dev demo only: follow the first demo item on the lock screen; the scripted feed moves it (GMA-774). */
function DemoLiveActivityToggle({ view }: { view: EdgeView }) {
  useLiveActivityPreview(view);
  const live = useLiveActivity(DEMO_FOLLOW_ITEM, contentFor(view, DEMO_FOLLOW_ITEM));
  if (!live.supported) return null;
  return (
    <Pressable
      testID="arcade-demo-live-activity"
      onPress={() => void (live.following ? live.stop() : live.follow()).catch(() => undefined)}
      accessibilityRole="button"
      className="rounded-full border px-3 py-2 active:opacity-80"
      style={{ position: "absolute", bottom: 96, right: 16, backgroundColor: colors.card, borderColor: live.following ? colors.accent : colors.border }}
    >
      <Text className="text-xs font-semibold" style={{ color: live.following ? colors.accent : colors.secondaryForeground }}>
        {live.following ? "Lock Screen: following · stop" : "Follow on Lock Screen"}
      </Text>
    </Pressable>
  );
}

/** The iPad shell's Arcade pane: /arcade, or /arcade/demo for the scripted feed in dev builds. */
export function TabletArcadePane({ demo = false }: { demo?: boolean }) {
  return __DEV__ && demo ? <DemoArcadeScreen /> : <ArcadeScreen />;
}

function ArcadeView({
  view,
  banner,
  now,
  desks,
  today,
  onRetry,
  onOpenItem,
  demo = false,
}: {
  view: EdgeView;
  banner: Banner | null;
  now: number;
  desks: Desk[];
  today: number | null;
  onRetry?: () => void;
  onOpenItem?: (itemId: string) => void;
  demo?: boolean;
}) {
  const reduced = useReducedMotion();

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
  const subscribeLog = useCallback((listener: () => void) => log.subscribe(listener), [log]);
  const logVersion = useCallback(() => log.version(), [log]);
  useSyncExternalStore(subscribeLog, logVersion);
  const ticker = log.recent(4);

  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [screenWidth, setScreenWidth] = useState(0);
  // Ages and stalls move by the minute; laying out the floor every tick would re-render every parcel.
  const clock = Math.floor(now / 60_000) * 60_000;
  const scene = useMemo(() => (box ? floorScene(view, box, { now: clock }) : null), [view, box, clock]);
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
          <OfflineBanner banner={banner} now={now} onRetry={onRetry} />
        </View>
      ) : null}
      <HudStrip view={view} demo={demo} today={today} clock={clock} />
      <View style={{ flex: 1, flexDirection: side ? "row" : "column" }}>
        <View
          style={{ flex: 1, minHeight: 260 }}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setBox((cur) => (cur?.width === width && cur.height === height ? cur : { width, height }));
          }}
          accessible={false}
        >
          {waiting ? (
            <Text style={{ color: colors.muted, padding: 16 }}>Waiting for the first snapshot…</Text>
          ) : scene?.parcels.length === 0 && scene.overflow.length === 0 ? (
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
      {waiting ? null : <DesksView desks={desks} width={screenWidth} now={now} reduced={reduced} selectedItemId={selected} onPressDesk={select} />}
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
