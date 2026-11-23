// One shared SDLC edge session for every Attention screen. It connects while any screen
// uses it and closes a short while after the last one unmounts, so moving between the
// list, the drill-down and an item keeps the socket (and the view) instead of
// reconnecting on every push. It stops in the background and reconnects on return, and is
// dropped when the account changes (edge-lifecycle.ts).
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import type { CommandInput, Confirmation, EdgeView, LiveActivityContent } from "@bob/sdlc-view";

import { getBaseUrl } from "~/utils/base-url";
import { getSessionCookie } from "~/utils/auth";
import { BobLiveActivity } from "../../../modules/bob-live-activity";
import { createEdgeLifecycle } from "./edge-lifecycle";
import { createLiveActivityController } from "./live-activity";
import type { LiveActivityController } from "./live-activity";
import { createSession } from "./edge-session";
import type { SessionState } from "./edge-session";
import { edgeSocketHeaders, edgeSocketUrl, rnWebSocketOpener } from "./edge-socket";

const IDLE_CLOSE_MS = 30_000;

let appStateWired = false;

const lifecycle = createEdgeLifecycle({
  idleCloseMs: IDLE_CLOSE_MS,
  create: () => {
    if (!appStateWired) {
      appStateWired = true;
      AppState.addEventListener("change", (next) => lifecycle.appStateChanged(next));
    }
    const apiBase = getBaseUrl();
    const session = createSession({
      open: rnWebSocketOpener(edgeSocketUrl(apiBase), () => edgeSocketHeaders(apiBase, getSessionCookie())),
      newId: () => Crypto.randomUUID(),
    });
    // Followed items' Live Activities track the app's view while it is fresher than the last push.
    session.subscribe((next) => liveActivities().viewChanged(next.view));
    return session;
  },
});

let liveActivityController: LiveActivityController | null = null;
/** The one Live Activity controller; its registrations go over whichever session is current (GMA-774). */
function liveActivities(): LiveActivityController {
  liveActivityController ??= createLiveActivityController(BobLiveActivity, (registration) => {
    // The /arcade/demo feed's items (dev builds) are local; their activities never reach the edge.
    if (__DEV__ && registration.itemId.startsWith("demo-")) return;
    lifecycle.get().registerLiveActivity(registration);
  });
  return liveActivityController;
}

/** Dev builds: drive followed activities from a local view (the /arcade/demo feed) instead of the edge. */
export function useLiveActivityPreview(view: EdgeView): void {
  useEffect(() => { liveActivities().viewChanged(view); }, [view]);
}

export interface LiveActivityState {
  /** This build and device can show Live Activities, and the user allows them for Bob. */
  supported: boolean;
  following: boolean;
  follow: () => Promise<void>;
  stop: () => Promise<void>;
}

/** Follow one item on the lock screen and Dynamic Island. */
export function useLiveActivity(itemId: string, content: LiveActivityContent | null): LiveActivityState {
  const c = liveActivities();
  const following = useSyncExternalStore((listener) => c.subscribe(listener), () => c.following().has(itemId));
  const follow = useCallback(async () => { if (content) await c.follow(itemId, content); }, [c, itemId, content]);
  const stop = useCallback(() => c.stop(itemId), [c, itemId]);
  return { supported: c.supported && content !== null, following, follow, stop };
}

/**
 * The signed-in account, from the auth gate (null: signed out). Signing out or switching
 * accounts stops the session and drops it, with its queued commands and view.
 */
export function setSdlcEdgeAccount(userId: string | null): void {
  lifecycle.accountChanged(userId);
}

export interface SdlcEdge {
  state: SessionState;
  send: (command: CommandInput, label: string, confirm?: Confirmation) => string;
  /** Restart after an auth failure (e.g. after signing in again). */
  retry: () => void;
}

export function useSdlcEdge(): SdlcEdge {
  const s = lifecycle.get();
  useEffect(() => lifecycle.retain(), [s]);
  const state = useSyncExternalStore((listener) => s.subscribe(listener), () => s.state);
  const send = useCallback<SdlcEdge["send"]>((command, label, confirm) => s.send(command, label, confirm), [s]);
  const retry = useCallback(() => { s.stop(); s.start(); }, [s]);
  return { state, send, retry };
}

// The edge watches one item per socket. Screens stack (item A, then item B pushed over
// it), so the watched item is the most recently focused screen's; focus and unfocus can
// arrive in either order on a pop, which a stack of claims tolerates.
const watchClaims: { token: object; itemId: string }[] = [];
const applyWatch = () => lifecycle.get().watch(watchClaims.at(-1)?.itemId ?? null);

/** Watches one item's attempt detail while the calling screen is focused. */
export function useWatchItem(itemId: string | null) {
  useFocusEffect(
    useCallback(() => {
      if (!itemId) return undefined;
      const token = {};
      watchClaims.push({ token, itemId });
      applyWatch();
      return () => {
        const index = watchClaims.findIndex((c) => c.token === token);
        if (index >= 0) watchClaims.splice(index, 1);
        applyWatch();
      };
    }, [itemId]),
  );
}

/** A clock for the offline banner: re-renders every intervalMs. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Watches the Arcade desks' items (BOB-98) while the calling screen is mounted, after the
 * focused item, within the edge's cap. Returns the session's watch set so the caller draws
 * only desks that get live detail.
 */
export function useWatchDesks(itemIds: readonly string[]): readonly string[] {
  const s = lifecycle.get();
  const key = itemIds.join("\u0000");
  useEffect(() => {
    s.watchDesks(key ? key.split("\u0000") : []);
  }, [s, key]);
  useEffect(() => () => s.watchDesks([]), [s]);
  return useSyncExternalStore((listener) => s.subscribe(listener), () => s.state.watching);
}

/** Opts the session into shipped-today entries (BOB-95); null until the edge answers. */
export function useShipped(): SessionState["shipped"] {
  const s = lifecycle.get();
  useEffect(() => s.followShipped(), [s]);
  return useSyncExternalStore((listener) => s.subscribe(listener), () => s.state.shipped);
}
