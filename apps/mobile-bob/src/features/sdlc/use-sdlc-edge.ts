// One shared SDLC edge session for every Attention screen. It connects while any screen
// uses it and closes a short while after the last one unmounts, so moving between the
// list, the drill-down and an item keeps the socket (and the view) instead of
// reconnecting on every push. Foregrounding the app reconnects at once.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import type { CommandInput, Confirmation } from "@bob/sdlc-view";

import { getBaseUrl } from "~/utils/base-url";
import { authClient } from "~/utils/auth";
import { createSession   } from "./edge-session";
import type {Session, SessionState} from "./edge-session";
import { edgeSocketHeaders, edgeSocketUrl, rnWebSocketOpener } from "./edge-socket";

const IDLE_CLOSE_MS = 30_000;

let session: Session | null = null;
let users = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function getSession(): Session {
  if (!session) {
    const apiBase = getBaseUrl();
    session = createSession({
      open: rnWebSocketOpener(edgeSocketUrl(apiBase), () => edgeSocketHeaders(apiBase, authClient.getCookie())),
      newId: () => Crypto.randomUUID(),
    });
    AppState.addEventListener("change", (next) => {
      if (next === "active" && users > 0) session?.wake();
    });
  }
  return session;
}

function retain(): () => void {
  const s = getSession();
  users++;
  clearTimeout(idleTimer);
  s.start();
  return () => {
    users--;
    if (users === 0) idleTimer = setTimeout(() => { if (users === 0) s.stop(); }, IDLE_CLOSE_MS);
  };
}

export interface SdlcEdge {
  state: SessionState;
  send: (command: CommandInput, label: string, confirm?: Confirmation) => string;
  /** Restart after an auth failure (e.g. after signing in again). */
  retry: () => void;
}

export function useSdlcEdge(): SdlcEdge {
  const s = getSession();
  useEffect(() => retain(), []);
  const state = useSyncExternalStore((listener) => s.subscribe(listener), () => s.state);
  const send = useCallback<SdlcEdge["send"]>((command, label, confirm) => s.send(command, label, confirm), [s]);
  const retry = useCallback(() => { s.stop(); s.start(); }, [s]);
  return { state, send, retry };
}

// The edge watches one item per socket. Screens stack (item A, then item B pushed over
// it), so the watched item is the most recently focused screen's; focus and unfocus can
// arrive in either order on a pop, which a stack of claims tolerates.
const watchClaims: { token: object; itemId: string }[] = [];
const applyWatch = () => getSession().watch(watchClaims.at(-1)?.itemId ?? null);

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
