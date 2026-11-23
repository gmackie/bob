"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emptyView, type CommandInput, type Confirmation, type EdgeView, type ShippedEntry } from "@bob/sdlc-view";

import { emptyAttempt, type AttemptState } from "./attempt-model";
import { emptyCommands, type CommandsState } from "./commands-model";
import { createBackoff, createEdgeClient, type EdgeClient, type EdgeConnection } from "./edge-client";

export type { EdgeConnection } from "./edge-client";

/** The edge socket URL on this origin: wss on https. */
export function edgeSocketUrl(href: string): string {
  const url = new URL("/api/sdlc/ws", href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/**
 * The live SDLC view from the edge: connects to /api/sdlc/ws, says hello with the last
 * seq and epoch, folds messages through reduce(), and reconnects with capped, jittered backoff.
 * The view survives reconnects, so a resumed socket only needs the deltas it missed.
 */
export type SendCommand = (command: CommandInput, label: string, confirm?: Confirmation) => string | null;

export interface SdlcEdge {
  view: EdgeView;
  connection: EdgeConnection;
  commands: CommandsState;
  send: SendCommand;
  /** Live attempt detail for the watched item (and the last few watched). */
  attempt: AttemptState;
  /** Watch an item's attempt detail; null stops. Re-sent after every reconnect. */
  watch: (itemId: string | null) => void;
  /** Also watch these items for the Arcade desks (BOB-98), within the edge's cap. */
  watchDesks: (itemIds: readonly string[]) => void;
  /** The ids watched on this socket, the watched item first; desks outside it get no detail. */
  watching: readonly string[];
  /** Ask for shipped-today entries (BOB-95). */
  followShipped: () => void;
  /** Shipped entries, newest first; null until the edge answers followShipped(). */
  shipped: readonly ShippedEntry[] | null;
}

export function useSdlcEdge(): SdlcEdge {
  const [view, setView] = useState<EdgeView>(emptyView);
  const [connection, setConnection] = useState<EdgeConnection>("connecting");
  const [commands, setCommands] = useState<CommandsState>(emptyCommands);
  const [attempt, setAttempt] = useState<AttemptState>(emptyAttempt);
  const [shipped, setShipped] = useState<readonly ShippedEntry[] | null>(null);
  const [watching, setWatching] = useState<readonly string[]>([]);
  const clientRef = useRef<EdgeClient | null>(null);

  useEffect(() => {
    let socket: WebSocket | null = null;
    const backoff = createBackoff();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const client = createEdgeClient({
      send: (data) => {
        if (socket?.readyState !== WebSocket.OPEN) return false;
        socket.send(data);
        return true;
      },
      onView: setView,
      onCommands: setCommands,
      onAttempt: setAttempt,
      onShipped: setShipped,
    });
    clientRef.current = client;

    const open = () => {
      const current = new WebSocket(edgeSocketUrl(window.location.href));
      socket = current;
      current.onopen = () => {
        setConnection("live");
        client.opened();
      };
      current.onmessage = (event) => { if (client.received(event.data)) backoff.heard(); };
      current.onclose = () => {
        if (disposed || socket !== current) return;
        socket = null;
        setConnection("reconnecting");
        timer = setTimeout(open, backoff.nextDelay());
      };
    };
    open();
    // A socket that stopped answering commands is replaced; opened() resends them (BOB-89).
    const watchdog = setInterval(() => {
      if (disposed || socket?.readyState !== WebSocket.OPEN || !client.overdue()) return;
      const dead = socket;
      socket = null;
      dead.close();
      setConnection("reconnecting");
      open();
    }, 2_000);

    return () => {
      disposed = true;
      clientRef.current = null;
      clearTimeout(timer);
      clearInterval(watchdog);
      socket?.close();
    };
  }, []);

  const send = useCallback<SendCommand>((command, label, confirm) => clientRef.current?.send(command, label, confirm) ?? null, []);

  const watch = useCallback((itemId: string | null) => {
    const client = clientRef.current;
    if (!client) return;
    client.watch(itemId);
    setWatching(client.watching);
  }, []);
  const watchDesks = useCallback((itemIds: readonly string[]) => {
    const client = clientRef.current;
    if (!client) return;
    client.watchDesks(itemIds);
    setWatching(client.watching);
  }, []);
  const followShipped = useCallback(() => clientRef.current?.followShipped(), []);

  return { view, connection, commands, send, attempt, watch, watchDesks, watching, followShipped, shipped };
}
