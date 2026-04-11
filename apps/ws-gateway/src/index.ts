import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { db } from "@bob/db/client";
import { sessionEvents } from "@bob/db/schema";

import { PersistenceWriter, type SessionEventRecord } from "./persistence.js";
import { Relay } from "./relay.js";
import { createNudgeHandler } from "./nudge.js";
import { validateBrowserToken, validateDaemonAuth } from "./auth.js";

const PORT = parseInt(process.env.GATEWAY_PORT ?? "3002", 10);
const HEARTBEAT_INTERVAL_MS = 30_000;
const NUDGE_SHARED_SECRET = process.env.NUDGE_SHARED_SECRET ?? "";

if (!NUDGE_SHARED_SECRET && process.env.NODE_ENV !== "test") {
  console.error("[ws-gateway] FATAL: NUDGE_SHARED_SECRET env var is required");
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

const nudgeHandler = createNudgeHandler({
  sharedSecret: NUDGE_SHARED_SECRET,
  onNudge: (body) => relay.nudgeSession(body),
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
