import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { db } from "@bob/db/client";
import { sessionEvents } from "@bob/db/schema";
import {
  captureException,
  captureMessage,
  initObservability,
  trackEvent,
} from "@bob/monitoring/server";

import { PersistenceWriter, type SessionEventRecord } from "./persistence.js";
import { Relay } from "./relay.js";
import { createNudgeHandler, readJsonBody } from "./nudge.js";
import { validateBrowserToken, validateDaemonAuth } from "./auth.js";

const PORT = parseInt(process.env.GATEWAY_PORT ?? "3002", 10);
const HEARTBEAT_INTERVAL_MS = 30_000;
const NUDGE_SHARED_SECRET = process.env.NUDGE_SHARED_SECRET ?? "";

void initObservability({ serviceName: "ws-gateway" });

if (!NUDGE_SHARED_SECRET && process.env.NODE_ENV !== "test") {
  console.error("[ws-gateway] FATAL: NUDGE_SHARED_SECRET env var is required");
  void captureMessage("ws-gateway missing NUDGE_SHARED_SECRET", {
    serviceName: "ws-gateway",
    operation: "startup",
  });
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
    void captureException(err, {
      serviceName: "ws-gateway",
      operation: "persist_session_events",
      eventCount: events.length,
    });
    void trackEvent("gateway_persistence_failed", {
      eventCount: events.length,
    });
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
  onError: (err, context) => {
    void captureException(err, {
      serviceName: "ws-gateway",
      operation: "relay",
      ...context,
    });
  },
});

const nudgeHandler = createNudgeHandler({
  sharedSecret: NUDGE_SHARED_SECRET,
  onNudge: (body) =>
    relay.nudgeSession(body as unknown as Parameters<typeof relay.nudgeSession>[0]),
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
    try {
      await nudgeHandler(req, res);
    } catch (err) {
      void captureException(err, {
        serviceName: "ws-gateway",
        operation: "internal_nudge",
      });
      throw err;
    }
    return;
  }

  if (req.method === "POST" && req.url === "/internal/session-send") {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${NUDGE_SHARED_SECRET}`) {
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
    if (!delivered) {
      void trackEvent("gateway_session_send_missed", {
        userId: body.userId,
        sessionId: body.sessionId,
      });
    }
    res.writeHead(delivered ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: delivered }));
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
  server.close();
  wss.clients.forEach((ws) => ws.close());
  await writer.stop();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
