/// <reference types="@cloudflare/workers-types" />
import { isViewer } from "../../src/lib/sdlc-viewers";
export { isViewer, viewerList } from "../../src/lib/sdlc-viewers";
import { MAX_INGEST_BYTES } from "./store";
import { MAX_TAIL_BYTES } from "./tail";

/** The worker env the SDLC routes read. SDLC_EDGE_INGEST_TOKEN is a secret, the others are vars. */
export interface SdlcRouteEnv {
  SDLC_EDGE?: DurableObjectNamespace;
  /** The coordinator's workspaceId; names the one SdlcEdge instance. Empty: the routes answer 503. */
  SDLC_EDGE_WORKSPACE_ID?: string;
  /** Bob workspace whose grants can access this coordinator. Defaults to the edge ID. */
  SDLC_BOB_WORKSPACE_ID?: string;
  /** The coordinator exporter's bearer token, at least 32 characters. */
  SDLC_EDGE_INGEST_TOKEN?: string;
  /** Comma-separated user ids allowed to watch. Empty: nobody. */
  SDLC_VIEWER_USER_IDS?: string;
}

const MIN_TOKEN_LENGTH = 32;
const encoder = new TextEncoder();

/** Constant-time in the token: every byte of the longer of the two is compared. */
export function bearerMatches(header: string | null, token: string | undefined): boolean {
  if (!token || token.length < MIN_TOKEN_LENGTH || !header?.startsWith("Bearer ")) return false;
  const a = encoder.encode(header.slice(7)), b = encoder.encode(token);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const listed = isViewer;

/**
 * Reads a body up to `limit` bytes, counting what actually arrives (Content-Length is
 * not trusted). Returns null, having cancelled the stream, as soon as it goes over.
 */
export async function readCapped(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

/**
 * The header the route sets on the upgrade it forwards to the DO: the verified Bob user id.
 * The forwarded request is built from scratch, so a client's own copy never reaches the DO.
 */
export const SDLC_USER_HEADER = "x-bob-sdlc-user-id";

/** A verified API key: its user and the permissions it was minted with (packages/bob/src/auth/src/api-key.ts). */
export interface VerifiedApiKey { userId: string; permissions: readonly string[] }
/** Resolves a device API key (bob_/gmk_, minted by /api/v1/device/*) to its user and permissions; null when invalid, revoked or expired. */
export type VerifyApiKey = (key: string) => Promise<VerifiedApiKey | null>;

/**
 * The socket can send commands, so a key needs `write` or `admin`; a read-only key is
 * refused. Device-login keys are minted with ["read", "write"] (api/v1/device/approve).
 */
/** Resolves a single-use socket ticket (bob_sdlc_connect, src/server/mcp/sdlc-ticket.ts) to its user; null when unknown, used or expired. */
export type ConsumeTicket = (ticket: string, workspaceId: string) => Promise<string | null>;

export const keyMayConnect = (permissions: readonly string[]) => permissions.includes("write") || permissions.includes("admin");

const error = (status: number, message: string) => Response.json({ error: message }, { status });

/**
 * POST /api/sdlc/ingest: the coordinator exporter's batches, by bearer token.
 * POST /api/sdlc/issues: the coordinator's Kanbanger mirror (BOB-99), same bearer token.
 * POST /api/sdlc/tail: the coordinator tail relay's live frames (BOB-80), by the same
 *   bearer token, capped at MAX_TAIL_BYTES; relayed to watchers, never stored.
 * GET /api/sdlc/ws: a websocket for a user on SDLC_VIEWER_USER_IDS: a browser by session
 *   cookie with a same-origin Origin, or a native client (no Origin) by `Authorization:
 *   Bearer <device API key>` with `write` or `admin` permission
 *   (read-only: 403), or an MCP Apps view by `?ticket=` from bob_sdlc_connect (any Origin:
 *   its sandboxed frame has an opaque one; the single-use ticket is the credential).
 *   Otherwise a foreign Origin is refused whatever else is sent.
 * Both go to the one SdlcEdge Durable Object named by SDLC_EDGE_WORKSPACE_ID; until that
 * and the binding exist, both answer 503 before checking anything else.
 */
export async function handleSdlcRoute(
  request: Request,
  env: SdlcRouteEnv,
  getUserId: () => Promise<string | null>,
  verifyApiKey: VerifyApiKey = async () => null,
  consumeTicket: ConsumeTicket = async () => null,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  const namespace = env.SDLC_EDGE;
  const coordinatorWorkspaceId = env.SDLC_EDGE_WORKSPACE_ID;
  if (!coordinatorWorkspaceId || !namespace) return error(503, "sdlc edge not configured");
  const stub = () => namespace.get(namespace.idFromName(coordinatorWorkspaceId));

  if (pathname === "/api/sdlc/ingest") {
    if (!bearerMatches(request.headers.get("authorization"), env.SDLC_EDGE_INGEST_TOKEN)) return error(401, "unauthorized");
    if (request.method !== "POST") return error(405, "method not allowed");
    const body = await readCapped(request.body, MAX_INGEST_BYTES);
    if (!body) return error(413, "batch too large");
    return stub().fetch("https://sdlc-edge/ingest", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });
  }

  if (pathname === "/api/sdlc/issues") {
    // BOB-99: the coordinator's Kanbanger mirror, by the same bearer token as ingest.
    if (!bearerMatches(request.headers.get("authorization"), env.SDLC_EDGE_INGEST_TOKEN)) return error(401, "unauthorized");
    if (request.method !== "POST") return error(405, "method not allowed");
    const body = await readCapped(request.body, MAX_INGEST_BYTES);
    if (!body) return error(413, "batch too large");
    return stub().fetch("https://sdlc-edge/issues", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });
  }

  if (pathname === "/api/sdlc/tail") {
    if (!bearerMatches(request.headers.get("authorization"), env.SDLC_EDGE_INGEST_TOKEN)) return error(401, "unauthorized");
    if (request.method !== "POST") return error(405, "method not allowed");
    const body = await readCapped(request.body, MAX_TAIL_BYTES);
    if (!body) return error(413, "tail too large");
    return stub().fetch("https://sdlc-edge/tail", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });
  }

  if (pathname === "/api/sdlc/ws") {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return error(426, "expected websocket");
    // Cross-site WebSocket hijacking: the session cookie rides along on any site's
    // handshake, so only our own origin may open one. Browsers always send Origin here.
    // Native clients send no Origin and authenticate by bearer key instead; with no
    // Origin and no bearer, or a foreign Origin, the answer stays 403.
    const origin = request.headers.get("origin");
    const authorization = request.headers.get("authorization");
    const ticket = new URL(request.url).searchParams.get("ticket");
    let userId: string | null;
    if (ticket !== null) {
      userId = await consumeTicket(ticket, env.SDLC_BOB_WORKSPACE_ID ?? coordinatorWorkspaceId);
    } else if (origin === null && authorization?.startsWith("Bearer ")) {
      const key = authorization.slice(7).trim();
      const verified = key ? await verifyApiKey(key) : null;
      if (verified && !keyMayConnect(verified.permissions)) return error(403, "insufficient permission");
      userId = verified?.userId ?? null;
    } else {
      if (origin !== new URL(request.url).origin) return error(403, "forbidden origin");
      userId = await getUserId();
    }
    if (!userId) return error(401, "unauthorized");
    if (!listed(userId, env.SDLC_VIEWER_USER_IDS)) return error(403, "forbidden");
    // Only the upgrade and the verified user id go through: no cookies, keys or client headers.
    return stub().fetch("https://sdlc-edge/ws", { headers: { upgrade: "websocket", [SDLC_USER_HEADER]: userId } });
  }

  return error(404, "not found");
}
