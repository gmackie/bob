// The real socket: `ws`, because Node's global WebSocket cannot set request headers.
// It authenticates with `Authorization: Bearer <device key>` and sends no Origin header,
// which is how the edge tells a native client from a browser.
import WebSocket from "ws";

import type { OpenSocket } from "./session";

export function wsOpener(url: string, apiKey: string): OpenSocket {
  return (handlers) => {
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: 15_000 });
    socket.on("open", () => handlers.onOpen());
    socket.on("message", (data, isBinary) => { if (!isBinary) handlers.onMessage(data.toString()); });
    socket.on("unexpected-response", (_req, res) => {
      handlers.onRejected(res.statusCode ?? 0);
      res.resume();
      socket.terminate();
    });
    socket.on("error", () => { /* "close" follows; the session reconnects */ });
    socket.on("close", () => handlers.onClose());
    return {
      send: (data) => { if (socket.readyState === WebSocket.OPEN) socket.send(data); },
      close: () => socket.close(),
    };
  };
}
