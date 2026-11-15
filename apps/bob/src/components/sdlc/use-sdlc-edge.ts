"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emptyView, type CommandInput, type Confirmation, type EdgeView } from "@bob/sdlc-view";

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

export function useSdlcEdge(): { view: EdgeView; connection: EdgeConnection; commands: CommandsState; send: SendCommand } {
  const [view, setView] = useState<EdgeView>(emptyView);
  const [connection, setConnection] = useState<EdgeConnection>("connecting");
  const [commands, setCommands] = useState<CommandsState>(emptyCommands);
  const clientRef = useRef<EdgeClient | null>(null);

  useEffect(() => {
    let socket: WebSocket | null = null;
    const backoff = createBackoff();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const client = createEdgeClient({
      send: (data) => { if (socket?.readyState === WebSocket.OPEN) socket.send(data); },
      onView: setView,
      onCommands: setCommands,
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

    return () => {
      disposed = true;
      clientRef.current = null;
      clearTimeout(timer);
      socket?.close();
    };
  }, []);

  const send = useCallback<SendCommand>((command, label, confirm) => clientRef.current?.send(command, label, confirm) ?? null, []);

  return { view, connection, commands, send };
}
