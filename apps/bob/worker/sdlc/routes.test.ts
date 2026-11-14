import { describe, expect, it } from "vitest";
import { MAX_INGEST_BYTES } from "./store";
import { bearerMatches, handleSdlcRoute, type SdlcRouteEnv } from "./routes";

const TOKEN = "k".repeat(40);

interface Forwarded { path: string; method: string; body: string; upgrade: string | null; cookie: string | null }
/** A fake DurableObjectNamespace: records the name it was addressed by and every request the stub got. */
function namespace() {
  const names: string[] = [];
  const calls: Forwarded[] = [];
  return {
    names,
    calls,
    idFromName: (name: string) => { names.push(name); return name; },
    get: (_id: unknown) => ({
      fetch: async (input: RequestInfo, init?: RequestInit) => {
        const request = new Request(input, init);
        calls.push({
          path: new URL(request.url).pathname,
          method: request.method,
          body: request.body ? await request.text() : "",
          upgrade: request.headers.get("upgrade"),
          cookie: request.headers.get("cookie"),
        });
        return new Response("forwarded", { status: 200 });
      },
    }),
  };
}
type FakeEnv = Omit<SdlcRouteEnv, "SDLC_EDGE"> & { SDLC_EDGE?: ReturnType<typeof namespace> };
const env = (over: Partial<FakeEnv> = {}): FakeEnv & { SDLC_EDGE: ReturnType<typeof namespace> } =>
  ({ SDLC_EDGE: namespace(), SDLC_EDGE_WORKSPACE_ID: "gmacko", SDLC_EDGE_INGEST_TOKEN: TOKEN, SDLC_VIEWER_USER_IDS: "u1, u3", ...over }) as never;
const req = (path: string, init: RequestInit = {}) => new Request(`https://bob.test${path}`, init);
const ingest = (body: BodyInit, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
  req("/api/sdlc/ingest", { method: "POST", body, headers });
const upgrade = (headers: Record<string, string> = {}) => req("/api/sdlc/ws", { headers: { upgrade: "websocket", ...headers } });
const route = (request: Request, e: FakeEnv, userId: string | null = null) =>
  handleSdlcRoute(request, e as unknown as SdlcRouteEnv, async () => userId);

/** A body stream of `chunks` chunks of `size` bytes that records how many it handed out and whether it was cancelled. */
function countingStream(chunks: number, size: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled === chunks) { controller.close(); return; }
      state.pulled++;
      controller.enqueue(new Uint8Array(size).fill(0x20));
    },
    cancel() { state.cancelled = true; },
  });
  return { stream, state };
}
/** A request whose Content-Length header lies about its body. Request itself would not let us set one. */
const lyingRequest = (body: ReadableStream<Uint8Array>, contentLength: string) =>
  ({
    url: "https://bob.test/api/sdlc/ingest",
    method: "POST",
    headers: new Headers({ authorization: `Bearer ${TOKEN}`, "content-length": contentLength }),
    body,
  }) as unknown as Request;

describe("bearerMatches", () => {
  it("accepts only the exact token, and only tokens of at least 32 characters", () => {
    expect(bearerMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(bearerMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(bearerMatches(`Bearer ${TOKEN.slice(1)}`, TOKEN)).toBe(false);
    expect(bearerMatches(`bearer ${TOKEN}`, TOKEN)).toBe(false);
    expect(bearerMatches(TOKEN, TOKEN)).toBe(false);
    expect(bearerMatches(null, TOKEN)).toBe(false);
    expect(bearerMatches(`Bearer ${"s".repeat(31)}`, "s".repeat(31))).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer x", undefined)).toBe(false);
  });
});

describe("handleSdlcRoute: configuration", () => {
  it("answers 503 before anything else while the workspace id or the binding is missing", async () => {
    for (const over of [{ SDLC_EDGE_WORKSPACE_ID: undefined }, { SDLC_EDGE_WORKSPACE_ID: "" }, { SDLC_EDGE: undefined }]) {
      const e = env(over as Partial<FakeEnv>);
      // No upgrade header, no token, no session: 503 still comes first.
      expect((await route(req("/api/sdlc/ws"), e)).status).toBe(503);
      expect((await route(req("/api/sdlc/ingest", { method: "POST", body: "{}" }), e)).status).toBe(503);
    }
  });
});

describe("handleSdlcRoute: ingest", () => {
  it("answers 401 without the exact bearer token and forwards nothing", async () => {
    const e = env();
    for (const authorization of [undefined, "Bearer nope", `Bearer ${TOKEN}x`, `Basic ${TOKEN}`]) {
      const res = await route(ingest("{}", authorization ? { authorization } : {}), e);
      expect(res.status).toBe(401);
    }
    expect(e.SDLC_EDGE.calls).toEqual([]);
  });
  it("answers 401 when the configured token is shorter than 32 characters, even if it matches", async () => {
    const short = "s".repeat(31);
    const e = env({ SDLC_EDGE_INGEST_TOKEN: short });
    expect((await route(ingest("{}", { authorization: `Bearer ${short}` }), e)).status).toBe(401);
    expect((await route(ingest("{}", { authorization: "Bearer x" }), env({ SDLC_EDGE_INGEST_TOKEN: undefined }))).status).toBe(401);
    expect(e.SDLC_EDGE.calls).toEqual([]);
  });
  it("answers 405 to anything but POST", async () => {
    const e = env();
    expect((await route(req("/api/sdlc/ingest", { headers: { authorization: `Bearer ${TOKEN}` } }), e)).status).toBe(405);
    expect(e.SDLC_EDGE.calls).toEqual([]);
  });
  it("forwards an authorised body, byte for byte, to the workspace's Durable Object", async () => {
    const e = env();
    const body = JSON.stringify({ contractVersion: "1", kind: "heartbeat", watermark: 3, plans: [], items: [], note: "héllo" });
    const res = await route(ingest(body), e);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("forwarded");
    expect(e.SDLC_EDGE.names).toEqual(["gmacko"]);
    expect(e.SDLC_EDGE.calls).toEqual([{ path: "/ingest", method: "POST", body, upgrade: null, cookie: null }]);
  });
  it("does not parse the body: malformed JSON is the Durable Object's to refuse", async () => {
    const e = env();
    expect((await route(ingest("not json"), e)).status).toBe(200);
    expect(e.SDLC_EDGE.calls.map((c) => c.body)).toEqual(["not json"]);
  });
  it("accepts a body of exactly MAX_INGEST_BYTES and refuses one byte more with 413", async () => {
    const e = env();
    expect((await route(ingest("x".repeat(MAX_INGEST_BYTES)), e)).status).toBe(200);
    expect((await route(ingest("x".repeat(MAX_INGEST_BYTES + 1)), e)).status).toBe(413);
    expect(e.SDLC_EDGE.calls).toHaveLength(1);
  });
  it("counts bytes, not characters", async () => {
    const e = env();
    // 2-byte characters: half the cap in characters is exactly the cap in bytes.
    expect((await route(ingest("é".repeat(MAX_INGEST_BYTES / 2)), e)).status).toBe(200);
    expect((await route(ingest("é".repeat(MAX_INGEST_BYTES / 2) + "x"), e)).status).toBe(413);
  });
  it("enforces the cap on the bytes it reads when Content-Length understates the body, and stops reading", async () => {
    const e = env();
    const chunk = 64 * 1024;
    const { stream, state } = countingStream(1_000, chunk); // ~65 MB on offer
    const res = await route(lyingRequest(stream, "10"), e);
    expect(res.status).toBe(413);
    expect(state.pulled * chunk).toBeLessThan(MAX_INGEST_BYTES + 2 * chunk);
    expect(state.cancelled).toBe(true);
    expect(e.SDLC_EDGE.calls).toEqual([]);
  });
  it("does not refuse a small body whose Content-Length overstates it", async () => {
    const e = env();
    const { stream } = countingStream(2, 10);
    const res = await route(lyingRequest(stream, String(MAX_INGEST_BYTES * 10)), e);
    expect(res.status).toBe(200);
    expect(e.SDLC_EDGE.calls.map((c) => c.body.length)).toEqual([20]);
  });
});

describe("handleSdlcRoute: socket", () => {
  it("answers 426 without a websocket upgrade, before looking up the session", async () => {
    let asked = false;
    const res = await handleSdlcRoute(req("/api/sdlc/ws"), env() as never, async () => { asked = true; return "u1"; });
    expect(res.status).toBe(426);
    expect(asked).toBe(false);
  });
  it("answers 401 without a session user", async () => {
    const e = env();
    expect((await route(upgrade(), e, null)).status).toBe(401);
    expect(e.SDLC_EDGE.calls).toEqual([]);
  });
  it("answers 403 to a user missing from SDLC_VIEWER_USER_IDS, and to everyone when the list is empty", async () => {
    const e = env();
    expect((await route(upgrade(), e, "u2")).status).toBe(403);
    expect((await route(upgrade(), e, "u")).status).toBe(403);
    expect((await route(upgrade(), env({ SDLC_VIEWER_USER_IDS: "" }), "u1")).status).toBe(403);
    expect((await route(upgrade(), env({ SDLC_VIEWER_USER_IDS: undefined }), "u1")).status).toBe(403);
    expect(e.SDLC_EDGE.calls).toEqual([]);
  });
  it("forwards a listed user's upgrade to the workspace's Durable Object without their cookies", async () => {
    const e = env();
    const res = await route(upgrade({ cookie: "session=secret" }), e, "u3");
    expect(res.status).toBe(200);
    expect(e.SDLC_EDGE.names).toEqual(["gmacko"]);
    expect(e.SDLC_EDGE.calls).toEqual([{ path: "/ws", method: "GET", body: "", upgrade: "websocket", cookie: null }]);
  });
  it("accepts the upgrade header in any case", async () => {
    const e = env();
    expect((await route(req("/api/sdlc/ws", { headers: { upgrade: "WebSocket" } }), e, "u1")).status).toBe(200);
  });
});

describe("handleSdlcRoute: other paths", () => {
  it("answers 404 to an unknown /api/sdlc path", async () => {
    expect((await route(req("/api/sdlc/other"), env(), "u1")).status).toBe(404);
  });
});
