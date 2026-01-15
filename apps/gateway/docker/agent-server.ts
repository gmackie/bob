import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";

const PORT = parseInt(process.env.AGENT_PORT ?? "3100", 10);

interface Session {
  id: string;
  agentType: string;
  pty: pty.IPty;
  ws: WebSocket;
  cwd: string;
}

const sessions = new Map<string, Session>();

const AGENT_COMMANDS: Record<string, string> = {
  claude: "claude",
  kiro: "kiro-cli",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
  "cursor-agent": "cursor-agent",
  shell: process.env.SHELL ?? "/bin/bash",
};

function generateId(): string {
  return crypto.randomUUID();
}

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      status: "ok", 
      sessions: sessions.size,
      user: process.env.USER,
    }));
    return;
  }

  if (req.url === "/sessions") {
    res.writeHead(200, { "Content-Type": "application/json" });
    const sessionList = Array.from(sessions.values()).map(s => ({
      id: s.id,
      agentType: s.agentType,
      cwd: s.cwd,
    }));
    res.end(JSON.stringify(sessionList));
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const agentType = url.searchParams.get("agent") ?? "shell";
  const cwd = url.searchParams.get("cwd") ?? process.env.HOME ?? "/home/node";
  
  const sessionId = generateId();
  const command = AGENT_COMMANDS[agentType] ?? AGENT_COMMANDS.shell;

  console.log(`[Agent] New session ${sessionId}: ${agentType} in ${cwd}`);

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(command, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
      },
    });
  } catch (error) {
    console.error(`[Agent] Failed to spawn ${command}:`, error);
    ws.send(JSON.stringify({ 
      type: "error", 
      message: `Failed to start ${agentType}: ${error}` 
    }));
    ws.close();
    return;
  }

  const session: Session = {
    id: sessionId,
    agentType,
    pty: ptyProcess,
    ws,
    cwd,
  };

  sessions.set(sessionId, session);

  ws.send(JSON.stringify({ type: "connected", sessionId, agentType }));

  ptyProcess.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "data", data }));
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[Agent] Session ${sessionId} exited with code ${exitCode}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "exit", exitCode }));
      ws.close();
    }
    sessions.delete(sessionId);
  });

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "data":
          ptyProcess.write(message.data);
          break;

        case "resize":
          if (message.cols && message.rows) {
            ptyProcess.resize(message.cols, message.rows);
          }
          break;

        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;
      }
    } catch (error) {
      console.error(`[Agent] Failed to parse message:`, error);
    }
  });

  ws.on("close", () => {
    console.log(`[Agent] Connection closed: ${sessionId}`);
    ptyProcess.kill();
    sessions.delete(sessionId);
  });

  ws.on("error", (error) => {
    console.error(`[Agent] WebSocket error for ${sessionId}:`, error);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Agent] Server running on port ${PORT}`);
  console.log(`[Agent] Available agents: ${Object.keys(AGENT_COMMANDS).join(", ")}`);
});

process.on("SIGTERM", () => {
  console.log("[Agent] Shutting down...");
  for (const session of sessions.values()) {
    session.pty.kill();
    session.ws.close();
  }
  server.close(() => process.exit(0));
});
