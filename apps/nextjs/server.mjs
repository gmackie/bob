import { createServer } from "node:http";
import { fileURLToPath, parse } from "node:url";

import { WebSocketServer } from "ws";
import next from "next";

import { TerminalService } from "@bob/legacy/services";

// NOTE: The monorepo commonly uses `PORT` for other services (legacy backend).
// To avoid collisions, this server uses `NEXT_PORT` (or `NEXTJS_PORT`) instead.
const port = Number.parseInt(
  process.env.NEXT_PORT ?? process.env.NEXTJS_PORT ?? "3000",
  10,
);
const hostname = process.env.HOSTNAME ?? "127.0.0.1";
const dev = process.env.NODE_ENV !== "production";

const dir = fileURLToPath(new URL(".", import.meta.url));

const app = next({ dev, dir });
const handle = app.getRequestHandler();

await app.prepare();

/**
 * @typedef {Object} Services
 * @property {import("@bob/legacy/services").TerminalService} terminalService
 */

/** @type {Promise<Services> | undefined} */
let servicesPromise;

async function getServices() {
  if (!servicesPromise) {
    servicesPromise = (async () => {
      const terminalService = new TerminalService();

      console.log("[server] Terminal service initialized");

      return { terminalService };
    })();
  }
  return servicesPromise;
}

const server = createServer((req, res) => {
  try {
    const parsedUrl = parse(req.url ?? "", true);
    handle(req, res, parsedUrl);
  } catch (error) {
    console.error("[server] Unhandled request error", error);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
});

// WebSocket server for terminal streaming.
// Clients connect to: ws(s)://<host>/ws?sessionId=<id>
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  try {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } catch (error) {
    console.error("[server] WebSocket upgrade error", error);
    socket.destroy();
  }
});

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host}`);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    ws.close(1000, "Session ID required");
    return;
  }

  const { terminalService } = await getServices();
  terminalService.attachWebSocket(sessionId, ws);
});

async function gracefulShutdown() {
  try {
    console.log("[server] Shutting down gracefully...");

    // Close WS first so clients can reconnect after restart.
    wss.close();

    const services = await getServices();
    services.terminalService.cleanup();
  } catch (error) {
    console.error("[server] Error during shutdown", error);
  } finally {
    server.close(() => process.exit(0));
  }
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

server.listen(port, hostname, () => {
  console.log(`[server] Next.js + WS listening on http://${hostname}:${port}`);
  console.log(`[server] Terminal WS endpoint: /ws?sessionId=<id>`);
});
