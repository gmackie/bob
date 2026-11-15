/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from "cloudflare:workers";
import { EdgeController } from "./controller";
import { attachUser, greet, greetedSockets, handleCommand, ingestResponse, parseCommandMessage, parseHello } from "./edge-sockets";
import { SDLC_USER_HEADER } from "./routes";
import { durableObjectSql } from "./sql";
import { fetchBizPulseRepos } from "./topology";

interface SdlcEdgeEnv {
  BOB_BIZPULSE_API_URL?: string;
  BOB_BIZPULSE_API_KEY?: string;
  /** Re-checked on every command: the list can change while a socket is open. */
  SDLC_VIEWER_USER_IDS?: string;
}

/**
 * One per workspace (idFromName(SDLC_EDGE_WORKSPACE_ID)): holds the coordinator's SDLC
 * state in SQLite and fans it out to viewers over hibernatable WebSockets. Thin: the
 * behaviour lives in EdgeController and edge-sockets.ts, which run under node tests.
 * The routes in routes.ts authenticate before anything reaches it.
 */
export class SdlcEdge extends DurableObject<SdlcEdgeEnv> {
  private readonly controller: EdgeController;

  constructor(ctx: DurableObjectState, env: SdlcEdgeEnv) {
    super(ctx, env);
    const { BOB_BIZPULSE_API_URL: apiUrl, BOB_BIZPULSE_API_KEY: apiKey } = env;
    this.controller = new EdgeController({
      sql: durableObjectSql(ctx.storage),
      sockets: () => greetedSockets(ctx.getWebSockets()),
      schedule: (work) => ctx.waitUntil(work),
      loadTopology: apiUrl && apiKey ? () => fetchBizPulseRepos({ apiUrl, apiKey }) : undefined,
    });
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/ingest" && request.method === "POST") {
      // routes.ts has already capped the body at MAX_INGEST_BYTES.
      return ingestResponse(this.controller, await request.text());
    }
    if (pathname === "/ws") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server); // Hibernation API: the attachment survives eviction
      // routes.ts is the only way in and sets this from the session or device key it verified.
      attachUser(server, request.headers.get(SDLC_USER_HEADER));
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const hello = parseHello(message);
    if (hello) { greet(this.controller, ws, hello); return; }
    const command = parseCommandMessage(message);
    if (command) handleCommand(this.controller, ws, command, this.env.SDLC_VIEWER_USER_IDS, Date.now());
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    closeQuietly(ws, code);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    closeQuietly(ws, 1011);
  }
}

/** 1005 and 1006 are reserved and cannot be sent; answer those with a normal close. */
function closeQuietly(ws: WebSocket, code: number) {
  const sendable = code === 1000 || (code >= 3000 && code <= 4999) || code === 1011;
  try { ws.close(sendable ? code : 1000, "closing"); } catch { /* already closed */ }
}
