// BOB-96: Live Activity registrations and the updates planned after each ingest; the APNs sender.
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIVE_ACTIVITY_LIMITS, type ItemSnapshot, type PlanSnapshot } from "@bob/sdlc-view";
import { apnsConfigFromEnv, apnsTarget, liveActivityPayload, liveActivitySender, providerToken, resetApnsTokenCache, sendLiveActivities, type ApnsConfig } from "./apns";
import { EdgeController } from "./controller";
import { attachUser, greet, greetedSockets } from "./edge-sockets";
import { LIVE_ACTIVITY_SCHEMA, LiveActivityEdge, migrateLiveActivities, parseLiveActivityRegistration, type LiveActivitySend } from "./live-activity";
import type { IngestBatch } from "./store";
import { nodeSqlitePort } from "./test-helpers/node-sqlite";

const target = { environmentId: "e", projectId: "bob", repository: { integrationId: "forgegraph", repositoryId: "bob" } };
const plan = (rv = 1, state: PlanSnapshot["state"] = "active"): PlanSnapshot => ({
  planId: "p1", resourceVersion: rv, state,
  definition: {
    items: ["i1", "i2"].map((itemId) => ({ itemId, issue: { integrationId: "k", workspaceId: "w", teamId: "t", projectId: "p", issueId: itemId, identifier: `BOB-${itemId}` }, target, completionTarget: "production-verified" })),
    dependencies: [], concurrencyLimit: 1,
  },
});
const item = (itemId: string, rv: number, state: ItemSnapshot["state"]): ItemSnapshot =>
  ({ itemId, planId: "p1", resourceVersion: rv, state, achievedMilestones: [], operationIds: [], evidenceRefs: [] });
const TOKEN = "ab".repeat(32), TOKEN2 = "cd".repeat(32);

function fakeSocket() {
  let attachment: unknown = null;
  const socket = {
    sent: [] as string[],
    send(data: string) { socket.sent.push(data); },
    serializeAttachment(value: unknown) { attachment = structuredClone(value); },
    deserializeAttachment() { return attachment; },
  };
  return socket;
}

function harness() {
  let clock = 1_000_000, watermark = 0, viewers = "u1, u2";
  const sql = nodeSqlitePort();
  const handed: LiveActivitySend[][] = [];
  let edge!: LiveActivityEdge;
  const controller = new EdgeController({ sql, sockets: () => greetedSockets([]), now: () => clock, newEpoch: () => "e1", afterIngest: (now) => edge.flush(now) });
  edge = new LiveActivityEdge({ sql, item: (id) => controller.store.item(id), plan: (id) => controller.store.plan(id), viewerIds: () => viewers, send: (s) => { handed.push(s); } });
  const ingest = (b: Partial<IngestBatch>) => {
    const from = watermark;
    if (b.kind !== "heartbeat") watermark++;
    return controller.ingest({ contractVersion: "1", kind: "changes", fromSequence: from, watermark, plans: [], items: [], ...b });
  };
  ingest({ kind: "snapshot", plans: [plan()], items: [item("i1", 1, "running"), item("i2", 1, "running")] });
  const connect = (userId: string | null, greeted = true) => {
    const s = fakeSocket();
    attachUser(s, userId);
    if (greeted) greet(controller, s, { cursor: null, epoch: null }, () => {});
    return s;
  };
  const register = (s: ReturnType<typeof fakeSocket>, itemId: string, token: string | null, app?: string) =>
    edge.register(s, parseLiveActivityRegistration(JSON.stringify({ type: "liveActivity", itemId, token, app }))!, clock);
  return {
    edge, ingest, connect, register, handed, sql,
    heartbeat: () => ingest({ kind: "heartbeat" }),
    tick: (ms: number) => { clock += ms; },
    setViewers: (v: string) => { viewers = v; },
  };
}

describe("registration (BOB-96)", () => {
  it("parses strictly and lowercases the token", () => {
    expect(parseLiveActivityRegistration(JSON.stringify({ type: "liveActivity", itemId: "i1", token: TOKEN.toUpperCase() }))).toEqual({ type: "liveActivity", itemId: "i1", token: TOKEN });
    expect(parseLiveActivityRegistration(JSON.stringify({ type: "liveActivity", itemId: "i1", token: null }))).toEqual({ type: "liveActivity", itemId: "i1", token: null });
    for (const bad of [{ type: "liveActivity", itemId: "i1", token: "nothex" }, { type: "liveActivity", itemId: "", token: TOKEN }, { type: "liveActivity", token: TOKEN }, { type: "watch", itemId: "i1" }]) {
      expect(parseLiveActivityRegistration(JSON.stringify(bad))).toBeNull();
    }
    expect(parseLiveActivityRegistration("x".repeat(2000))).toBeNull();
  });

  it("accepts only Bob's own apps (GMA-774)", () => {
    expect(parseLiveActivityRegistration(JSON.stringify({ type: "liveActivity", itemId: "i1", token: TOKEN, app: "com.gmacko.bob.dev" }))).toEqual({ type: "liveActivity", itemId: "i1", token: TOKEN, app: "com.gmacko.bob.dev" });
    expect(parseLiveActivityRegistration(JSON.stringify({ type: "liveActivity", itemId: "i1", token: null, app: "com.gmacko.bob" }))).toEqual({ type: "liveActivity", itemId: "i1", token: null, app: "com.gmacko.bob" });
    for (const app of ["com.evil.app", "", 1, null, "toString"]) {
      expect(parseLiveActivityRegistration(JSON.stringify({ type: "liveActivity", itemId: "i1", token: TOKEN, app }))).toBeNull();
    }
  });

  it("sends each token to the app it was registered from; re-registering moves it (GMA-774)", () => {
    const h = harness();
    const s = h.connect("u1");
    h.register(s, "i1", TOKEN, "com.gmacko.bob.dev");
    h.register(s, "i2", TOKEN2);
    h.heartbeat();
    const sends = h.handed.flat();
    expect(sends.find((x) => x.token === TOKEN)!.app).toBe("com.gmacko.bob.dev");
    expect(sends.find((x) => x.token === TOKEN2)!.app).toBeNull();
    h.register(s, "i1", TOKEN, "com.gmacko.bob");
    expect(h.sql.exec<{ app: string }>("SELECT app FROM sdlc_live_activities WHERE token = ?", TOKEN)[0]!.app).toBe("com.gmacko.bob");
  });

  it("adds the app column to a table created before it (GMA-774)", () => {
    const sql = nodeSqlitePort();
    sql.exec("CREATE TABLE sdlc_live_activities (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, item_id TEXT NOT NULL, created_at INTEGER NOT NULL, sent_at INTEGER, sent_json TEXT)");
    sql.exec("INSERT INTO sdlc_live_activities VALUES (?, 'u1', 'i1', 1, NULL, NULL)", TOKEN);
    for (const statement of LIVE_ACTIVITY_SCHEMA) sql.exec(statement);
    migrateLiveActivities(sql);
    migrateLiveActivities(sql); // idempotent
    expect(sql.exec<{ token: string; app: string | null }>("SELECT token, app FROM sdlc_live_activities")).toEqual([{ token: TOKEN, app: null }]);
  });

  it("refuses sockets that may not watch", () => {
    const h = harness();
    for (const s of [h.connect("u1", false), h.connect(null), h.connect("u9")]) expect(h.register(s, "i1", TOKEN)).toBe(false);
    expect(h.edge.count()).toBe(0);
  });

  it("keeps at most perUser activities per user, dropping the oldest", () => {
    const h = harness();
    const s = h.connect("u1");
    const tokens = Array.from({ length: LIVE_ACTIVITY_LIMITS.perUser + 2 }, (_, i) => i.toString(16).padStart(64, "0"));
    for (const t of tokens) { h.register(s, "i1", t); h.tick(1); }
    const kept = h.sql.exec<{ token: string }>("SELECT token FROM sdlc_live_activities ORDER BY created_at").map((r) => r.token);
    expect(kept).toEqual(tokens.slice(2));
  });

  it("token null forgets the user's activities for that item", () => {
    const h = harness();
    const a = h.connect("u1"), b = h.connect("u2");
    h.register(a, "i1", TOKEN); h.register(b, "i1", TOKEN2);
    h.register(a, "i1", null);
    expect(h.sql.exec<{ token: string }>("SELECT token FROM sdlc_live_activities").map((r) => r.token)).toEqual([TOKEN2]);
  });
});

describe("planned updates after ingest (BOB-96)", () => {
  it("sends the current content on the first ingest after registering, then only changes", () => {
    const h = harness();
    h.register(h.connect("u1"), "i1", TOKEN);
    h.heartbeat();
    expect(h.handed).toEqual([[expect.objectContaining({ token: TOKEN, event: "update", priority: 5, alert: null, content: expect.objectContaining({ issue: "BOB-i1", stage: 1 }) })]]);
    h.heartbeat();
    h.ingest({ items: [item("i2", 2, "validating")] }); // another item
    expect(h.handed).toHaveLength(1);
  });

  it("coalesces ordinary changes within minIntervalMs and sends the latest after it", () => {
    const h = harness();
    h.register(h.connect("u1"), "i1", TOKEN);
    h.heartbeat();
    h.ingest({ items: [item("i1", 2, "validating")] });
    expect(h.handed).toHaveLength(1);
    h.tick(LIVE_ACTIVITY_LIMITS.minIntervalMs);
    h.heartbeat();
    expect(h.handed).toHaveLength(2);
    expect(h.handed[1]![0]!.content.state).toBe("validating");
  });

  it("sends needs-you at once, at priority 10, with an alert that carries no agent text", () => {
    const h = harness();
    h.register(h.connect("u1"), "i1", TOKEN);
    h.heartbeat();
    h.ingest({ items: [{ ...item("i1", 2, "waiting-input"), pendingInput: { attemptId: "a", promptId: "r", kind: "user_input", createdAt: "t", questions: [{ id: "q", question: "SECRET", options: [], multiSelect: false }] } }] });
    const send = h.handed[1]![0]!;
    expect(send).toMatchObject({ priority: 10, alert: { title: "BOB-i1 needs you", body: "Waiting for input" }, content: { needsYou: true } });
    expect(JSON.stringify(send)).not.toContain("SECRET");
  });

  it("ends the activity when the item completes, and forgets it", () => {
    const h = harness();
    h.register(h.connect("u1"), "i1", TOKEN);
    h.heartbeat();
    h.ingest({ items: [item("i1", 2, "completed")] });
    expect(h.handed[1]![0]).toMatchObject({ event: "end", priority: 10, content: { ended: true, stage: 5 } });
    expect(h.edge.count()).toBe(0);
  });

  it("ends with the last content sent when the item's plan ends and it leaves the edge", () => {
    const h = harness();
    h.register(h.connect("u1"), "i1", TOKEN);
    h.heartbeat();
    h.ingest({ plans: [plan(2, "completed")] });
    expect(h.handed[1]![0]).toMatchObject({ event: "end", content: { state: "running", ended: true } });
    expect(h.edge.count()).toBe(0);
  });

  it("forgets tokens past tokenTtlMs or whose user left the allow-list, without sending", () => {
    const h = harness();
    h.register(h.connect("u1"), "i1", TOKEN);
    h.register(h.connect("u2"), "i2", TOKEN2);
    h.setViewers("u1");
    h.tick(LIVE_ACTIVITY_LIMITS.tokenTtlMs + 1);
    h.heartbeat();
    expect(h.handed).toEqual([]);
    expect(h.edge.count()).toBe(0);
  });

  it("forget() drops dead tokens", () => {
    const h = harness();
    h.register(h.connect("u1"), "i1", TOKEN);
    h.edge.forget([TOKEN]);
    expect(h.edge.count()).toBe(0);
  });
});

// ─── APNs ─────────────────────────────────────────────────────────────────────

async function testKey(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString("base64").replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----`;
  return { pem, publicKey: pair.publicKey };
}
const content = { issue: "BOB-1", repository: "bob", state: "running" as const, label: "Running", stage: 1, needsYou: false, failed: false, ended: false };
const send = (over: Partial<LiveActivitySend> = {}): LiveActivitySend => ({ token: TOKEN, app: null, event: "update", content, priority: 5, alert: null, ...over });

describe("APNs sender (BOB-96)", () => {
  afterEach(() => resetApnsTokenCache());

  it("is configured only with every value; sandbox only when asked", () => {
    const env = { APNS_TEAM_ID: "T", APNS_KEY_ID: "K", APNS_PRIVATE_KEY: "P", APNS_BUNDLE_ID: "app.bob" };
    expect(apnsConfigFromEnv({ ...env, APNS_KEY_ID: "" })).toBeNull();
    expect(apnsConfigFromEnv(env)!.host).toBe("https://api.push.apple.com");
    expect(apnsConfigFromEnv({ ...env, APNS_ENVIRONMENT: "sandbox" })!.host).toBe("https://api.sandbox.push.apple.com");
  });

  it("routes a registered app to its own topic and environment, else the configured default (GMA-774)", () => {
    const config = { bundleId: "app.bob", host: "https://apns.test" };
    expect(apnsTarget(config, { app: null })).toEqual(config);
    expect(apnsTarget(config, { app: "com.gmacko.bob" })).toEqual({ bundleId: "com.gmacko.bob", host: "https://api.push.apple.com" });
    expect(apnsTarget(config, { app: "com.gmacko.bob.dev" })).toEqual({ bundleId: "com.gmacko.bob.dev", host: "https://api.sandbox.push.apple.com" });
    expect(apnsTarget(config, { app: "com.gmacko.bob.preview" })).toEqual({ bundleId: "com.gmacko.bob.preview", host: "https://api.sandbox.push.apple.com" });
  });

  it("signs an ES256 provider token that verifies", async () => {
    const { pem, publicKey } = await testKey();
    const jwt = await providerToken({ teamId: "TEAM", keyId: "KEY", privateKey: pem }, 1_700_000_000_000);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY" });
    expect(JSON.parse(Buffer.from(c!, "base64url").toString())).toEqual({ iss: "TEAM", iat: 1_700_000_000 });
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, Buffer.from(s!, "base64url"), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it("builds update and end payloads", () => {
    expect(liveActivityPayload(send(), 10_000)).toEqual({ aps: { timestamp: 10, event: "update", "content-state": content } });
    const end = liveActivityPayload(send({ event: "end", alert: { title: "t", body: "b" } }), 10_000);
    expect(end).toMatchObject({ aps: { event: "end", "dismissal-date": 10 + 15 * 60, alert: { title: "t", body: "b" }, sound: "default" } });
  });

  it("posts with liveactivity headers and reports dead tokens", async () => {
    const { pem } = await testKey();
    const config: ApnsConfig = { teamId: "T", keyId: "K", privateKey: pem, bundleId: "app.bob", host: "https://apns.test" };
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init!.headers as Record<string, string> });
      if (String(url).endsWith(TOKEN2)) return Response.json({ reason: "BadDeviceToken" }, { status: 400 });
      if (String(url).endsWith("ef".repeat(32))) return new Response(null, { status: 410 });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const result = await sendLiveActivities(config, [send(), send({ token: TOKEN2, priority: 10 }), send({ token: "ef".repeat(32) }), send({ token: "12".repeat(32), app: "com.gmacko.bob.dev" })], { fetch: fakeFetch, now: () => 1_000 });
    expect({ ...result, dead: [...result.dead].sort() }).toEqual({ sent: 2, failed: 2, dead: [TOKEN2, "ef".repeat(32)].sort() });
    expect(calls[0]!.url).toBe(`https://apns.test/3/device/${TOKEN}`);
    expect(calls[0]!.headers).toMatchObject({ "apns-push-type": "liveactivity", "apns-topic": "app.bob.push-type.liveactivity", "apns-priority": "5" });
    expect(calls[0]!.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(calls[1]!.headers["apns-priority"]).toBe("10");
    expect(calls[3]!.url).toBe(`https://api.sandbox.push.apple.com/3/device/${"12".repeat(32)}`);
    expect(calls[3]!.headers["apns-topic"]).toBe("com.gmacko.bob.dev.push-type.liveactivity");
  });

  it("without config sends nothing and logs counts only", async () => {
    const lines: string[] = [];
    const fakeFetch = vi.fn() as unknown as typeof fetch;
    await liveActivitySender({}, () => {}, { fetch: fakeFetch, log: (l) => lines.push(l) })([send()]);
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(lines).toEqual([JSON.stringify({ event: "sdlc_live_activity_unconfigured", planned: 1 })]);
  });

  it("forgets dead tokens and never logs a token", async () => {
    const { pem } = await testKey();
    const lines: string[] = [];
    const forgotten: string[][] = [];
    const fakeFetch = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch;
    const env = { APNS_TEAM_ID: "T", APNS_KEY_ID: "K", APNS_PRIVATE_KEY: pem, APNS_BUNDLE_ID: "app.bob" };
    await liveActivitySender(env, (t) => forgotten.push(t), { fetch: fakeFetch, log: (l) => lines.push(l) })([send()]);
    expect(forgotten).toEqual([[TOKEN]]);
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "sdlc_live_activity_sent", sent: 0, failed: 1, dead: 1 });
  });
});
