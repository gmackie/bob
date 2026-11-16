// The real socket: `ws`, because Node's global WebSocket cannot set request headers.
// It authenticates with `Authorization: Bearer <device key>` and sends no Origin header,
// which is how the edge tells a native client from a browser.
import WebSocket from "ws";

import type { TcpNetConnectOpts } from "node:net";
import type { ClientOptions } from "ws";

import type { OpenSocket } from "./session";

/**
 * `autoSelectFamily` makes the connect try IPv6 and IPv4 in parallel (happy
 * eyeballs). Without it, `ws` dials the first address the resolver returns and,
 * on a network whose IPv6 route is broken, waits for ETIMEDOUT (GMA-769).
 * `ws` hands its options to `tls.connect`, which honours the flag; its types omit it.
 */
export function socketOptions(apiKey: string): ClientOptions & Pick<TcpNetConnectOpts, "autoSelectFamily"> {
  return { headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: 15_000, autoSelectFamily: true };
}

export function wsOpener(url: string, apiKey: string): OpenSocket {
  return (handlers) => {
    const socket = new WebSocket(url, socketOptions(apiKey));
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
