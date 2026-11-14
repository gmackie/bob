/// <reference types="@cloudflare/workers-types" />
import { MAX_INGEST_BYTES } from "./store";

/** The worker env the SDLC routes read. SDLC_EDGE_INGEST_TOKEN is a secret, the others are vars. */
export interface SdlcRouteEnv {
  SDLC_EDGE?: DurableObjectNamespace;
  /** The coordinator's workspaceId; names the one SdlcEdge instance. Empty: the routes answer 503. */
  SDLC_EDGE_WORKSPACE_ID?: string;
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

const listed = (userId: string, csv: string | undefined) =>
  (csv ?? "").split(",").map((s) => s.trim()).filter(Boolean).includes(userId);

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

const error = (status: number, message: string) => Response.json({ error: message }, { status });

/**
 * POST /api/sdlc/ingest: the coordinator exporter's batches, by bearer token.
 * GET /api/sdlc/ws: a websocket for a signed-in user on SDLC_VIEWER_USER_IDS.
 * Both go to the one SdlcEdge Durable Object named by SDLC_EDGE_WORKSPACE_ID; until that
 * and the binding exist, both answer 503 before checking anything else.
 */
export async function handleSdlcRoute(
  request: Request,
  env: SdlcRouteEnv,
  getUserId: () => Promise<string | null>,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  const namespace = env.SDLC_EDGE;
  if (!env.SDLC_EDGE_WORKSPACE_ID || !namespace) return error(503, "sdlc edge not configured");
  const stub = () => namespace.get(namespace.idFromName(env.SDLC_EDGE_WORKSPACE_ID!));

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

  if (pathname === "/api/sdlc/ws") {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return error(426, "expected websocket");
    const userId = await getUserId();
    if (!userId) return error(401, "unauthorized");
    if (!listed(userId, env.SDLC_VIEWER_USER_IDS)) return error(403, "forbidden");
    // Only the upgrade goes through: the DO needs no cookies or other credentials.
    return stub().fetch("https://sdlc-edge/ws", { headers: { upgrade: "websocket" } });
  }

  return error(404, "not found");
}
