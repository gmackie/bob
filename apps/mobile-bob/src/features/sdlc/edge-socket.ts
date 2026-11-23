// How the phone opens /api/sdlc/ws. Pure helpers are exported for tests; rnWebSocketOpener
// wires React Native's WebSocket (no new native module: RN's built-in socket takes a
// third `{ headers }` argument on iOS and Android).
//
// Auth: the edge accepts a session cookie with a same-origin Origin, or a device API key
// as a bearer with no Origin (apps/bob/worker/sdlc/routes.ts). React Native always sends
// an Origin on the handshake (iOS SocketRocket and Android OkHttp both derive it from the
// URL, wss -> https), so the bearer branch is unreachable from RN; the cookie branch is
// the one that works. We send the better-auth session cookie from SecureStore and set
// Origin explicitly to the API's https origin so it matches the edge's request origin.
import type { OpenSocket } from "./edge-session";

/** wss://<api host>/api/sdlc/ws (ws:// for an http dev API). */
export function edgeSocketUrl(apiBase: string): string {
  const url = new URL("/api/sdlc/ws", apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** The API's http(s) origin, which the edge compares with its own request origin. */
export const apiOrigin = (apiBase: string) => new URL(apiBase).origin;

/**
 * Handshake headers: the session cookie plus a same-origin Origin. Null without a
 * credential (signed out): there is nothing the edge would accept.
 */
export function edgeSocketHeaders(apiBase: string, cookie: string | null | undefined): Record<string, string> | null {
  if (!cookie) return null;
  return { Cookie: cookie, Origin: apiOrigin(apiBase) };
}

/**
 * RN does not expose the HTTP status of a refused upgrade, only an error message:
 * iOS "Received bad response code from server: 403.", Android
 * "Expected HTTP 101 response but was '401 Unauthorized'". Null when there is none.
 */
export function rejectedStatusFrom(message: unknown): number | null {
  if (typeof message !== "string") return null;
  const match = /(?:response code from server:?|but was ')\s*(\d{3})/i.exec(message);
  return match ? Number(match[1]) : null;
}

type RNWebSocketCtor = new (
  url: string,
  protocols?: string | string[] | null,
  options?: { headers: Record<string, string> },
) => WebSocket;

export function rnWebSocketOpener(url: string, headers: () => Record<string, string> | null): OpenSocket {
  return (handlers) => {
    const h = headers();
    if (!h) {
      // Signed out: report as a 401 so the session stops instead of spinning.
      queueMicrotask(() => handlers.onRejected(401));
      return { send: () => undefined, close: () => undefined };
    }
    const Ctor = WebSocket as unknown as RNWebSocketCtor;
    const socket = new Ctor(url, null, { headers: h });
    let closed = false;
    socket.onopen = () => handlers.onOpen();
    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data === "string") handlers.onMessage(event.data);
    };
    socket.onerror = (event: Event) => {
      const status = rejectedStatusFrom((event as Event & { message?: string }).message);
      if (status !== null && status !== 101) handlers.onRejected(status);
    };
    socket.onclose = () => {
      if (closed) return;
      closed = true;
      handlers.onClose();
    };
    return {
      send: (data) => { if (socket.readyState === WebSocket.OPEN) socket.send(data); },
      close: () => socket.close(),
    };
  };
}
