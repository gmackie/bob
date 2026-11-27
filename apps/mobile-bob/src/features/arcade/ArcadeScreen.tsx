// Bob Arcade on iPhone and iPad (BOB-91 / BOB-92): the Floor lens over the live SDLC edge.
// The same edge session as the Attention screens (use-sdlc-edge), so opening the Arcade
// does not open a second socket.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Linking, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { beatLine, beatTone, boardProjectView, controlRoomFeed, ciMeter, createBeatLog, desks as deskCards, floorScene, floorSummary, hud, liveCiPhases, projectBoard, shippedToday, WIDE_MIN_WIDTH } from "@bob/arcade";
import type { AttemptDetailLike, BoardRow, Desk } from "@bob/arcade";
import { coordinatedIssueIds, inScope, issueAttention, issueCommands, rows, RELEASE_STAGE_PRESENTATION, STATE_PRESENTATION } from "@bob/sdlc-view";
import type { CommandOption, Confirmation, EdgeView, Scope, TrackedIssue } from "@bob/sdlc-view";

import { attentionEntries, bannerFor, firstQuestion, releaseReason } from "~/features/sdlc/attention-model";
import type { ActionContext, Banner } from "~/features/sdlc/commands-model";
import { ActionButtons, ATTENTION_COLOR, OfflineBanner } from "~/features/sdlc/components";
import { contentFor } from "~/features/sdlc/live-activity";
import { useLiveActivity, useLiveActivityPreview, useNow, useSdlcEdge, useShipped, useWatchDesks } from "~/features/sdlc/use-sdlc-edge";
import { useSystemReducedMotion } from "~/hooks/use-system-reduced-motion";
import { colors } from "~/lib/colors";

import type { LiveEffect } from "./arcade-model";
import { EFFECT_TTL_MS, expire, step, stepAttempts, TONE_COLOR } from "./arcade-model";
import { ControlRoom } from "./ControlRoom";
import { BoardView } from "./BoardView";
import { demoDeskDetail } from "./demo-feed";
import { DesksView } from "./DesksView";
import { FloorView, STAGE } from "./FloorView";
import type { ParcelMeter } from "./FloorView";
import { playHaptic } from "./haptics";
import { ScopeChips, useFloorScope } from "./ScopeChips";
import { useDemoEdge } from "./use-demo-edge";
import { useDeskIds } from "./use-desk-ids";

const MONO = "Menlo";
/**
 * The Needs-you side panel takes 300pt, and the floor wants WIDE_MIN_WIDTH beside it: so
 * iPad landscape gets the panel, iPad portrait keeps the full width for the wide floor.
 */
const SIDE_PANEL_MIN_WIDTH = 300 + WIDE_MIN_WIDTH;

type Attempts = Readonly<Record<string, AttemptDetailLike | undefined>>;
const NO_ATTEMPTS: Attempts = {};

function HudStrip({
  view,
  scope,
  today,
  clock,
  waiting,
}: {
  view: EdgeView;
  scope: Scope;
  today: number | null;
  clock: number;
  waiting: boolean;
}) {
  const h = hud(view, scope, clock);
  const cells: [string, number | null, string][] = [
    ["Agents", h.agents, "#b6d7ff"],
    ["In CI", h.ci, "#a2e2d6"],
    ["In flight", h.inFlight, "#ffd393"],
    ["Needs you", h.needsYou, "#f5c879"],
    ["Stalled", h.stalled, "#ffb581"],
    ["Deploying", h.deploying, "#d8c3ff"],
    ["Shipped", h.shipped, "#a6e6c6"],
    ["Failed", h.failed, "#ffac99"],
    ["Shipped today · all projects", today, "#a6e6c6"],
  ];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, backgroundColor: "#182021" }}
      contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 8, gap: 16 }}
      testID="arcade-hud"
    >
      {cells.map(([label, value, color]) => (
        <View
          key={label}
          accessible
          accessibilityLabel={`${label}, ${waiting || value === null ? "unavailable" : value}`}
        >
          <Text
            style={{
              fontSize: 18,
              lineHeight: 22,
              fontWeight: "800",
              fontVariant: ["tabular-nums"],
              color: value && !waiting ? color : "#bdc2b8",
            }}
          >
            {waiting || value === null ? "–" : value}
          </Text>
          <Text style={{ fontSize: 11, color: "#c3c9bf" }}>{label}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function useArcadeProject(view: EdgeView) {
  const [choice, choose] = useState<{ row: BoardRow; epoch: string | null } | null>(null);
  const project = choice?.epoch === view.epoch ? choice.row : null;
  const floor = useMemo(() => boardProjectView(view, project), [view, project]);
  const [scope, setScope] = useFloorScope(floor);
  function setProject(row: BoardRow | null) {
    choose(row ? { row, epoch: view.epoch } : null);
    setScope({});
  }
  return { project, setProject, floor, scope, setScope };
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

/** Issue actions on the live edge: the Attention screens' context and send. Absent in the demo. */
interface IssueActions {
  ctx: ActionContext;
  send: (option: CommandOption, confirm?: Confirmation) => void;
}

const CHECKS_TEXT = { pending: "checks running", success: "checks passed", failure: "checks failed" } as const;

function openUrl(url: string | null) {
  if (url) void Linking.openURL(url).catch(() => undefined);
}

/** A tracked Kanbanger issue (BOB-99): what it is, its PR, links, and the issue actions. */
function IssuePanel({ view, issue, now, actions, onClose }: { view: EdgeView; issue: TrackedIssue; now: number; actions?: IssueActions; onClose: () => void }) {
  const attention = issueAttention(issue, now);
  const coordinated = coordinatedIssueIds(rows(view)).has(issue.id);
  const options = issueCommands(issue, coordinated);
  const days = Math.floor((now - issue.updatedAt) / 86_400_000);
  const pr = issue.pr;
  return (
    <View style={{ borderRadius: 14, backgroundColor: colors.card, padding: 14, gap: 6 }} testID="arcade-issue-panel">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ATTENTION_COLOR[attention] }} />
        <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>{issue.key}</Text>
        <Text style={{ flex: 1, color: colors.secondaryForeground, fontSize: 13 }} numberOfLines={1}>
          {issue.project?.name ?? issue.team ?? ""}
        </Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close issue" hitSlop={10}>
          <Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text>
        </Pressable>
      </View>
      <Text style={{ color: colors.foreground, fontSize: 14 }} numberOfLines={3}>{issue.title}</Text>
      <Text style={{ color: colors.secondaryForeground, fontSize: 13 }}>
        {issue.state.name} · {days <= 0 ? "changed today" : `untouched ${days}d`}
        {attention === "stalled" ? " · stale" : ""}
      </Text>
      {pr ? (
        <Text style={{ color: pr.checks === "failure" ? ATTENTION_COLOR.failed : colors.secondaryForeground, fontSize: 13 }}>
          PR #{pr.number} · {pr.state === "merged" ? "merged, waiting for production" : pr.state === "closed" ? "closed" : pr.checks ? CHECKS_TEXT[pr.checks] : "no checks yet"}
        </Text>
      ) : (
        <Text style={{ color: colors.muted, fontSize: 12 }}>No pull request linked.</Text>
      )}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
        {issue.url ? (
          <Pressable onPress={() => openUrl(issue.url)} accessibilityRole="link" style={({ pressed }) => ({ borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: colors.foreground, fontSize: 13 }}>Open in Kanbanger</Text>
          </Pressable>
        ) : null}
        {pr ? (
          <Pressable onPress={() => openUrl(pr.url)} accessibilityRole="link" style={({ pressed }) => ({ borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: colors.foreground, fontSize: 13 }}>Open PR #{pr.number}</Text>
          </Pressable>
        ) : null}
      </View>
      {actions ? (
        <View style={{ marginTop: 6 }} testID="arcade-issue-actions">
          <ActionButtons options={options} target={issue.key} ctx={actions.ctx} send={actions.send} />
        </View>
      ) : (
        <Text style={{ color: colors.muted, fontSize: 12 }}>Actions are off in the demo.</Text>
      )}
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
  const { state, retry, send } = useSdlcEdge();
  const now = useNow();
  const { project, setProject, floor, scope, setScope } = useArcadeProject(state.view);
  const ids = useDeskIds(floor, Math.floor(now / 60_000) * 60_000, scope);
  // Only desks inside the session's watch set get live detail, so only those are drawn.
  const watching = useWatchDesks(ids);
  const shipped = useShipped();
  const desks = useMemo(
    () => deskCards(floor, ids.filter((id) => watching.includes(id)), (id) => state.attempts[id], now),
    [floor, state.attempts, ids, watching, now],
  );
  const banner = bannerFor(state.view, state.connection, now, state.error);
  const actions = useMemo<IssueActions>(
    () => ({
      ctx: { connection: state.connection, banner, hasView: state.view.epoch !== null, commands: state.commands },
      send: (option, confirm) => void send(option.command, option.label, confirm),
    }),
    [state.connection, banner, state.view.epoch, state.commands, send],
  );
  return (
    <ArcadeView
      view={state.view} floor={floor} project={project} onProject={setProject}
      banner={banner}
      now={now}
      desks={desks}
      today={shipped ? shippedToday(shipped, now) : null}
      attempts={state.attempts}
      scope={scope}
      onScope={setScope}
      onRetry={retry}
      onOpenItem={onOpenItem}
      actions={actions}
    />
  );
}

/** Dev-only: the Arcade over a scripted feed (demo-feed.ts), for screenshots and the wall demo. */
export function DemoArcadeScreen() {
  const view = useDemoEdge();
  const now = useNow(DEMO_TICK_MS);
  const { project, setProject, floor, scope, setScope } = useArcadeProject(view);
  const ids = useDeskIds(floor, Math.floor(now / 60_000) * 60_000, scope);
  const tick = Math.floor(now / DEMO_TICK_MS);
  // One scripted detail record per tick, fed to the desks and to the floor's attempt beats alike.
  const attempts = useMemo(() => Object.fromEntries(ids.map((id) => [id, demoDeskDetail(view.items[id]?.state, id, tick, now)])), [view, ids, tick, now]);
  const desks = useMemo(() => deskCards(floor, ids, (id) => attempts[id], now), [floor, ids, attempts, now]);
  const today = Object.values(view.items).filter((i) => i.state === "completed").length;
  return (
    <View style={{ flex: 1 }}>
      <ArcadeView view={view} floor={floor} project={project} onProject={setProject} banner={null} now={now} desks={desks} today={today} attempts={attempts} scope={scope} onScope={setScope} demo />
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
  floor,
  project,
  onProject,
  banner,
  now,
  desks,
  today,
  attempts = NO_ATTEMPTS,
  scope,
  onScope,
  onRetry,
  onOpenItem,
  actions,
  demo = false,
}: {
  view: EdgeView;
  floor: EdgeView;
  project: BoardRow | null;
  onProject: (project: BoardRow | null) => void;
  banner: Banner | null;
  now: number;
  desks: Desk[];
  today: number | null;
  /** Live detail per watched item (tail, CI): drives motion between transitions. */
  attempts?: Attempts;
  scope: Scope;
  onScope: (scope: Scope) => void;
  onRetry?: () => void;
  onOpenItem?: (itemId: string) => void;
  actions?: IssueActions;
  demo?: boolean;
}) {
  const reduced = useSystemReducedMotion();
  // BOB-99: with Kanbanger issues on the edge the Arcade opens on the projects board; a
  // project opens its floor. Without issues (an older edge) it is the floor, as before.
  const hasIssues = Object.keys(view.issues).length > 0;

  const visibleIds = useMemo(() => {
    if (!project && !scope.startupId && !scope.repoKey) return undefined;
    return new Set(
      rows(floor)
        .filter((row) => inScope(row, scope))
        .map((row) => row.item.itemId),
    );
  }, [floor, scope, project]);

  // Beats and effects. The first view is a baseline (sdlcBeats never celebrates it).
  const log = useMemo(() => createBeatLog(80), [view.epoch]);
  const prevView = useRef<EdgeView | null>(null);
  const effectsRef = useRef<LiveEffect[]>([]);
  const [effects, setEffects] = useState<LiveEffect[]>([]);
  useEffect(() => {
    const prev = prevView.current;
    prevView.current = view;
    if (!prev || prev === view) return;
    const t = Date.now();
    const out = step(log, prev, view, effectsRef.current, t, visibleIds);
    if (!out.beats.length) return;
    effectsRef.current = out.effects;
    setEffects(out.effects);
    playHaptic(out.haptic);
  }, [view, log, visibleIds]);
  // Attempt stream: new tail lines and CI phases for watched items, between transitions.
  const [typing, setTyping] = useState<Record<string, number>>({});
  const prevAttempts = useRef<{ epoch: string | null; attempts: Attempts } | null>(null);
  const issues = useMemo(
    () => new Map(rows(view).map((r) => [r.item.itemId, r.issue.identifier ?? r.issue.issueId] as const)),
    [view],
  );
  useEffect(() => {
    const last = prevAttempts.current;
    const prev = last?.epoch === view.epoch ? last.attempts : null;
    prevAttempts.current = { epoch: view.epoch, attempts };
    if (!prev || prev === attempts) return;
    const t = Date.now();
    const out = stepAttempts(log, prev, attempts, (id) => issues.get(id), effectsRef.current, t, visibleIds);
    if (!out.beats.length) return;
    effectsRef.current = out.effects;
    setEffects(out.effects);
    if (Object.keys(out.activity).length) setTyping((cur) => ({ ...cur, ...out.activity }));
    playHaptic(out.haptic);
    // A new view alone (same attempts) returns early above: issues is only read, never a trigger.
  }, [attempts, issues, log, visibleIds, view.epoch]);
  const meters = useMemo(() => {
    const out: Record<string, ParcelMeter | null> = {};
    for (const [id, d] of Object.entries(attempts)) {
      const m = ciMeter(d?.ci);
      out[id] = m ? { ...m, phases: liveCiPhases(d?.ci, 8) } : null;
    }
    return out;
  }, [attempts]);

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
  const feed = controlRoomFeed(log.recent(), Date.now(), visibleIds);

  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [screenWidth, setScreenWidth] = useState(0);
  // Ages and stalls move by the minute; laying out the floor every tick would re-render every parcel.
  const clock = Math.floor(now / 60_000) * 60_000;
  const scene = useMemo(
    () => (box ? floorScene(floor, box, { now: clock, scope, density: "auto" }) : null),
    [floor, box, clock, scope],
  );
  const board = useMemo(() => projectBoard(view, clock), [view, clock]);
  const showBoard = !project && (hasIssues || board.rows.length > 1);
  const [selected, setSelected] = useState<string | null>(null);
  const select = useCallback((itemId: string) => setSelected((cur) => (cur === itemId ? null : itemId)), []);
  const side = screenWidth >= SIDE_PANEL_MIN_WIDTH;
  const waiting = view.epoch === null;
  const { height: windowHeight } = useWindowDimensions();
  const live = !waiting && !banner && !view.needsResync;
  const status = demo
    ? "Demo feed"
    : banner?.kind === "auth-failed"
      ? "Sign in required"
      : banner?.kind === "coordinator-offline"
        ? "Offline"
        : banner?.kind === "reconnecting"
          ? "Reconnecting"
          : view.needsResync
            ? "Resyncing"
            : live
              ? "Live feed"
              : "Connecting";

  const selectedIssue = selected ? floor.issues[selected] : undefined;
  const panel = selectedIssue ? (
    <IssuePanel
      view={floor}
      issue={selectedIssue}
      now={clock}
      actions={actions}
      onClose={() => setSelected(null)}
    />
  ) : selected && floor.items[selected] ? (
    <ItemPanel
      view={floor}
      itemId={selected}
      onClose={() => setSelected(null)}
      onOpenItem={
        onOpenItem
          ? (id) => {
              setSelected(null);
              onOpenItem(id);
            }
          : undefined
      }
    />
  ) : side ? (
    <NeedsYou view={floor} onSelect={select} />
  ) : null;

  const header = (
    <View>
      {banner && (
        <View style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
          <OfflineBanner banner={banner} now={now} onRetry={onRetry} />
        </View>
      )}
      <ControlRoom feed={feed} status={status} live={live} reduced={reduced} compact={windowHeight < 470} />
      <HudStrip view={floor} scope={scope} today={today} clock={clock} waiting={waiting} />
    </View>
  );

  const footer = (
    <View style={{ paddingTop: 10, gap: 12 }}>
      {!waiting && (
        <DesksView
          desks={desks}
          width={screenWidth - (side ? 300 : 0)}
          now={now}
          reduced={reduced || !live}
          selectedItemId={selected}
          onPressDesk={select}
        />
      )}
      <View style={{ paddingHorizontal: 16, paddingBottom: 14, gap: 6 }} testID="arcade-ticker">
        <Text accessibilityRole="header" style={{ color: "#efe3cb", fontSize: 16, fontWeight: "700" }}>
          Recent activity
        </Text>
        {feed.events.length ? (
          feed.events.map((b) => (
            <View key={b.id} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <View
                style={{ backgroundColor: TONE_COLOR[beatTone(b)], width: 4, height: 12, borderRadius: 2 }}
              />
              <Text numberOfLines={2} style={{ flex: 1, color: "#cccbc1", fontFamily: MONO, fontSize: 12 }}>
                {beatLine(b)}
              </Text>
            </View>
          ))
        ) : (
          <Text style={{ color: "#b6b4a8", fontSize: 13 }}>No recent floor events.</Text>
        )}
      </View>
    </View>
  );

  return (
    <View
      testID="arcade-screen"
      style={{ flex: 1, backgroundColor: STAGE.bg, flexDirection: side ? "row" : "column" }}
      onLayout={(e) => setScreenWidth(e.nativeEvent.layout.width)}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        {showBoard ? (
          <BoardView
            board={board}
            header={header}
            footer={footer}
            onOpenProject={(row) => {
              setSelected(null);
              onProject(row);
            }}
          />
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
            {header}
            {project && (
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 14 }}
                testID="arcade-project-header"
              >
                <Pressable
                  onPress={() => {
                    onProject(null);
                    setSelected(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="All projects"
                  style={({ pressed }) => ({
                    minHeight: 44,
                    justifyContent: "center",
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text style={{ color: STAGE.labelLit, fontWeight: "700" }}>‹ Projects</Text>
                </Pressable>
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, color: "#f3e7d1", fontSize: 16, fontWeight: "700" }}
                >
                  {project.name}
                </Text>
                {scene && scene.backlog > 0 && (
                  <Text style={{ color: "#cbb797", fontSize: 12 }}>{scene.backlog} in backlog</Text>
                )}
              </View>
            )}
            <ScopeChips view={floor} scope={scope} onScope={onScope} />
            <View
              style={{ height: Math.min(490, Math.max(320, windowHeight * 0.52)) }}
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                setBox((cur) => (cur?.width === width && cur?.height === height ? cur : { width, height }));
              }}
            >
              {waiting ? (
                <Text style={{ color: "#bfbcb3", padding: 16 }}>Waiting for the first snapshot…</Text>
              ) : scene && !scene.parcels.length && !scene.overflow.length ? (
                <View
                  style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 6 }}
                >
                  <Text style={{ fontSize: 22, fontWeight: "700", color: STAGE.labelLit }}>Floor idle</Text>
                  <Text style={{ color: "#bfbcb3", textAlign: "center" }}>
                    {project
                      ? "Nothing in flight in this project."
                      : "Dispatch a plan to see its work on the floor."}
                  </Text>
                </View>
              ) : (
                scene && (
                  <View accessibilityLabel={floorSummary(scene).join(". ")}>
                    <FloorView
                      scene={scene}
                      effects={effects}
                      reduced={reduced || !live}
                      selectedItemId={selected}
                      onPressParcel={select}
                      typing={typing}
                      meters={meters}
                    />
                  </View>
                )
              )}
            </View>
            {footer}
          </ScrollView>
        )}
      </View>
      {side && panel && (
        <ScrollView style={{ width: 300, flexGrow: 0 }} contentContainerStyle={{ padding: 12 }}>
          {panel}
        </ScrollView>
      )}
      {!side && !!panel && (
        <Modal transparent animationType={reduced ? "none" : "fade"} onRequestClose={() => setSelected(null)}>
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0009" }}>
            <Pressable
              style={{ flex: 1 }}
              onPress={() => setSelected(null)}
              accessibilityRole="button"
              accessibilityLabel="Dismiss details"
            />
            <ScrollView
              style={{
                maxHeight: "75%",
                flexGrow: 0,
                backgroundColor: colors.card,
                borderTopLeftRadius: 18,
                borderTopRightRadius: 18,
              }}
              contentContainerStyle={{ padding: 12, paddingBottom: 34 }}
            >
              {panel}
            </ScrollView>
          </View>
        </Modal>
      )}
    </View>
  );
}
