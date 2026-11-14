"use client";

import { useEffect, useState } from "react";
import { emptyView, type EdgeView } from "@bob/sdlc-view";

import { createBackoff, createEdgeClient, type EdgeConnection } from "./edge-client";

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
export function useSdlcEdge(): { view: EdgeView; connection: EdgeConnection } {
  const [view, setView] = useState<EdgeView>(emptyView);
  const [connection, setConnection] = useState<EdgeConnection>("connecting");

  useEffect(() => {
    let socket: WebSocket | null = null;
    const backoff = createBackoff();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const client = createEdgeClient({
      send: (data) => { if (socket?.readyState === WebSocket.OPEN) socket.send(data); },
      onView: setView,
    });

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
      clearTimeout(timer);
      socket?.close();
    };
  }, []);

  return { view, connection };
}
