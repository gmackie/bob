/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from "cloudflare:workers";
import { EdgeController } from "./controller";
import { sendAlertsThroughBob } from "./alert-send";
import { AttemptEdge, tailResponse } from "./attempt-edge";
import { attachUser, greet, greetedSockets, handleCommand, ingestResponse, parseCommandMessage, parseHello, parseWatchMessage } from "./edge-sockets";
import { CI_POLL_MS, fgCiSourceFromEnv, type FgEnv } from "./fg";
import { SDLC_USER_HEADER, viewerList } from "./routes";
import { parseShippedRequest, ShippedEdge } from "./shipped";
import { durableObjectSql } from "./sql";
import { fetchBizPulseRepos } from "./topology";

interface SdlcEdgeEnv extends FgEnv {
  BOB_BIZPULSE_API_URL?: string;
  BOB_BIZPULSE_API_KEY?: string;
  /** Re-checked on every command: the list can change while a socket is open. */
  SDLC_VIEWER_USER_IDS?: string;
  /** Bob's Postgres, for SDLC alerts (BOB-81): the same binding the worker's cron uses. */
  HYPERDRIVE?: { connectionString: string };
}

/**
 * One per workspace (idFromName(SDLC_EDGE_WORKSPACE_ID)): holds the coordinator's SDLC
 * state in SQLite and fans it out to viewers over hibernatable WebSockets. Thin: the
 * behaviour lives in EdgeController and edge-sockets.ts, which run under node tests.
 * The routes in routes.ts authenticate before anything reaches it.
 */
export class SdlcEdge extends DurableObject<SdlcEdgeEnv> {
  private readonly controller: EdgeController;
  /** Watches, the in-memory live tail and CI detail (BOB-80). Nothing of it is stored. */
  private readonly attempt: AttemptEdge;
  /** Opt-in "shipped today" entries (BOB-95). */
  private readonly shipped: ShippedEdge;

  constructor(ctx: DurableObjectState, env: SdlcEdgeEnv) {
    super(ctx, env);
    const { BOB_BIZPULSE_API_URL: apiUrl, BOB_BIZPULSE_API_KEY: apiKey } = env;
    this.controller = new EdgeController({
      sql: durableObjectSql(ctx.storage),
      sockets: () => greetedSockets(ctx.getWebSockets()),
      schedule: (work) => ctx.waitUntil(work),
      loadTopology: apiUrl && apiKey ? () => fetchBizPulseRepos({ apiUrl, apiKey }) : undefined,
      // SDLC push alerts go to every viewer, sent in the background so ingest never waits on them.
      alertRecipients: () => viewerList(this.env.SDLC_VIEWER_USER_IDS),
      notify: (deliveries) => ctx.waitUntil(sendAlertsThroughBob(this.env, deliveries)),
      onShipped: (entries) => this.shipped.publish(entries),
    });
    const store = this.controller.store;
    this.shipped = new ShippedEdge({
      sockets: () => ctx.getWebSockets(),
      recent: (now) => store.shipped.recent(now),
      viewerIds: () => this.env.SDLC_VIEWER_USER_IDS,
    });
    this.attempt = new AttemptEdge({
      sockets: () => ctx.getWebSockets(),
      item: (id) => store.item(id),
      plan: (id) => store.plan(id),
      topology: () => store.meta().topology,
      ci: fgCiSourceFromEnv(env),
      viewerIds: () => this.env.SDLC_VIEWER_USER_IDS,
      schedule: (work) => ctx.waitUntil(work),
    });
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/ingest" && request.method === "POST") {
      // routes.ts has already capped the body at MAX_INGEST_BYTES.
      return ingestResponse(this.controller, await request.text());
    }
    if (pathname === "/tail" && request.method === "POST") {
      // routes.ts has already checked the bearer and capped the body at MAX_TAIL_BYTES.
      return tailResponse(this.attempt, await request.text());
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
    const watch = parseWatchMessage(message);
    if (watch) {
      if (this.attempt.watch(ws, watch)) await this.armCiPoll();
      return;
    }
    if (parseShippedRequest(message)) { this.shipped.request(ws); return; }
    const command = parseCommandMessage(message);
    if (command) handleCommand(this.controller, ws, command, this.env.SDLC_VIEWER_USER_IDS, Date.now());
  }

  /** CI detail for watched items, every CI_POLL_MS while anything is watched. */
  async alarm(): Promise<void> {
    if (await this.attempt.pollCi()) await this.ctx.storage.setAlarm(Date.now() + CI_POLL_MS);
  }

  private async armCiPoll(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + CI_POLL_MS);
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
