import { createServer } from "node:http";
import { fileURLToPath, parse } from "node:url";

import { WebSocketServer } from "ws";
import next from "next";

import { getAgentCommand } from "@bob/legacy";
import { agentFactory } from "@bob/legacy/agents";
import { AgentService, GitService, TerminalService } from "@bob/legacy/services";

/**
 * NOTE: Next.js route handlers and this custom server run in the same Node
 * process. We intentionally share a single ServiceManager instance via
 * globalThis so that:
 * - HTTP endpoints can create terminal sessions
 * - WebSocket upgrades can attach to the same in-memory session by id
 */

// eslint-disable-next-line no-var
var __serviceManager;

class ServiceManager {
  constructor() {
    this._gitService = null;
    this._agentService = null;
    this._terminalService = null;
    this._initialized = false;
  }

  async initialize() {
    if (this._initialized) return;

    this._gitService = new GitService();
    await this._gitService.initialize();

    this._agentService = new AgentService({
      gitService: this._gitService,
      agentFactory,
      getAgentCommand,
    });
    await this._agentService.initialize();

    this._terminalService = new TerminalService();

    this._initialized = true;
    console.log("[ServiceManager] Services initialized");
  }

  get gitService() {
    if (!this._gitService) {
      throw new Error("ServiceManager not initialized. Call initialize() first.");
    }
    return this._gitService;
  }

  get agentService() {
    if (!this._agentService) {
      throw new Error("ServiceManager not initialized. Call initialize() first.");
    }
    return this._agentService;
  }

  get terminalService() {
    if (!this._terminalService) {
      throw new Error("ServiceManager not initialized. Call initialize() first.");
    }
    return this._terminalService;
  }

  async cleanup() {
    if (this._agentService) {
      await this._agentService.cleanup();
    }
    if (this._terminalService) {
      this._terminalService.cleanup();
    }
    this._initialized = false;
  }
}

function getServiceManager() {
  if (!globalThis.__serviceManager) {
    globalThis.__serviceManager = new ServiceManager();
  }
  return globalThis.__serviceManager;
}

async function getServices() {
  const manager = getServiceManager();
  await manager.initialize();
  return {
    gitService: manager.gitService,
    agentService: manager.agentService,
    terminalService: manager.terminalService,
  };
}

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
    await services.agentService.cleanup();
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
