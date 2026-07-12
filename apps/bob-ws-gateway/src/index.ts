import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { db } from "@bob/db/client";
import { sessionEvents } from "@bob/db/schema";

import { PersistenceWriter, type SessionEventRecord } from "./persistence.js";
import { OutboxWorker } from "./outbox.js";
import { Relay } from "./relay.js";
import { createNudgeHandler, createWorkspaceEventHandler, readJsonBody, bearerFrom } from "./nudge.js";
import {
  assertNoAuthBypassInProduction,
  validateBrowserToken,
  validateDaemonAuth,
  validateInternalBearer,
} from "./auth.js";

// Boot guard: a stray BOB_AUTH_BYPASS in a production unit must be a loud
// startup failure, never a silently fake-authenticated control plane.
try {
  assertNoAuthBypassInProduction();
} catch (err) {
  console.error(`[ws-gateway] FATAL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const PORT = parseInt(process.env.GATEWAY_PORT ?? "3002", 10);
const HEARTBEAT_INTERVAL_MS = 30_000;
const NUDGE_SHARED_SECRET = process.env.NUDGE_SHARED_SECRET ?? "";

if (!NUDGE_SHARED_SECRET && process.env.BOB_ALLOW_LEGACY_NUDGE_SECRET !== "false" && process.env.NODE_ENV !== "test") {
  console.error(
    "[ws-gateway] FATAL: NUDGE_SHARED_SECRET env var is required " +
      "(or set BOB_ALLOW_LEGACY_NUDGE_SECRET=false once every internal caller uses an API key)",
  );
  process.exit(1);
}

// Persistence: writes session events to Postgres in batches
const writer = new PersistenceWriter({
  batchSize: 50,
  flushIntervalMs: 100,
  onBatchWrite: async (batch) => {
    await db.insert(sessionEvents).values(
      batch.map((e) => ({
        sessionId: e.sessionId,
        seq: e.seq,
        direction: e.direction,
        eventType: e.eventType,
        payload: e.payload,
      })),
    );
  },
  onError: (err, events) => {
    console.error(`[ws-gateway] Failed to persist ${events.length} events:`, err);
  },
});
writer.start();

const relay = new Relay({
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  persistEvent: (event: SessionEventRecord) => {
    writer.enqueue(event);
  },
  validateBrowserToken,
  validateDaemonAuth,
});

// Outbox worker: delivers transition pushes with retries; receipts cron
// resolves downstream APNs/FCM failures and prunes dead tokens.
const outboxWorker = new OutboxWorker();
outboxWorker.start();

const nudgeHandler = createNudgeHandler({
  authorize: validateInternalBearer,
  onNudge: (body) =>
    relay.nudgeSession(body as unknown as Parameters<typeof relay.nudgeSession>[0]),
});
const workspaceEventHandler = createWorkspaceEventHandler({
  authorize: validateInternalBearer,
  onEvent: (body) => relay.notifyWorkspaceEvent(body),
});

// HTTP server (handles /health and /internal/nudge)
const server = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(404);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    const stats = relay.getStats();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        uptimeSeconds: Math.floor(process.uptime()),
        ...stats,
        writerHealthy: writer.isHealthy(),
      }),
    );
    return;
  }

  if (req.method === "POST" && req.url === "/internal/nudge") {
    await nudgeHandler(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/internal/workspace-event") {
    await workspaceEventHandler(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/internal/session-send") {
    const bearer = bearerFrom(req.headers.authorization);
    if (!bearer || !(await validateInternalBearer(bearer))) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const body = await readJsonBody(req) as { userId?: string; sessionId?: string; message?: string } | null;
    if (!body?.userId || !body?.sessionId || !body?.message) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing userId, sessionId, or message" }));
      return;
    }
    const delivered = await relay.sendToSession(body.sessionId, body.userId, body.message);
    res.writeHead(delivered ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: delivered }));
    return;
  }

  if (req.method === "POST" && req.url === "/internal/session-stop") {
    const bearer = bearerFrom(req.headers.authorization);
    if (!bearer || !(await validateInternalBearer(bearer))) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const body = await readJsonBody(req) as { userId?: string; sessionId?: string } | null;
    if (!body?.userId || !body?.sessionId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing userId or sessionId" }));
      return;
    }
    const result = await relay.requestSessionStop(body.userId, body.sessionId);
    if (result === "not_found") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, delivered: result.delivered }));
    return;
  }

  res.writeHead(404);
  res.end();
});

// WebSocket server mounted on /sessions
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/sessions") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    relay.handleConnection(ws);
  });
});

server.listen(PORT, () => {
  console.log(`[ws-gateway] listening on port ${PORT}`);
});

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[ws-gateway] received ${signal}, shutting down`);
  outboxWorker.stop();
  server.close();
  wss.clients.forEach((ws) => ws.close());
  await writer.stop();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
