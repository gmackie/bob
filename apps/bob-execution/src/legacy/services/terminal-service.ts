import type { ChildProcess } from "child_process";
import type { IPty } from "node-pty";
import type { WebSocket } from "ws";
import { spawn } from "node-pty";

export interface TerminalSession {
  id: string;
  instanceId: string;
  pty?: IPty;
  claudeProcess?: ChildProcess;
  claudePty?: IPty;
  websocket?: WebSocket;
  createdAt: Date;
}

/** Inbound messages the terminal WebSocket protocol accepts from clients. */
type TerminalClientMessage =
  | { type: "data"; data: string }
  | { type: "resize"; cols: unknown; rows: unknown }
  | { type: "ping" };

function isTerminalClientMessage(
  value: unknown,
): value is TerminalClientMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const { type } = value;
  if (type === "ping") {
    return true;
  }
  if (type === "data") {
    return typeof (value as { data?: unknown }).data === "string";
  }
  if (type === "resize") {
    return "cols" in value && "rows" in value;
  }
  return false;
}

function parseTerminalClientMessage(
  raw: string,
): TerminalClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isTerminalClientMessage(parsed) ? parsed : null;
}

export class TerminalService {
  private sessions = new Map<string, TerminalSession>();

  createSession(instanceId: string, cwd: string): TerminalSession {
    const sessionId = `terminal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const pty = spawn(
      process.platform === "win32" ? "powershell.exe" : "bash",
      [],
      {
        name: "xterm-color",
        cols: 80,
        rows: 30,
        cwd,
        env: process.env,
      },
    );

    const session: TerminalSession = {
      id: sessionId,
      instanceId,
      pty,
      createdAt: new Date(),
    };

    this.sessions.set(sessionId, session);

    pty.onExit(() => {
      this.sessions.delete(sessionId);
      if (session.websocket) {
        session.websocket.close();
      }
    });

    return session;
  }

  createSystemSession(cwd?: string, initialCommand?: string): TerminalSession {
    const sessionId = `system-terminal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const pty = spawn(
      process.platform === "win32" ? "powershell.exe" : "bash",
      [],
      {
        name: "xterm-color",
        cols: 80,
        rows: 30,
        cwd: cwd ?? process.env.HOME ?? "/",
        env: process.env,
      },
    );

    const session: TerminalSession = {
      id: sessionId,
      instanceId: "system",
      pty,
      createdAt: new Date(),
    };

    this.sessions.set(sessionId, session);

    if (initialCommand) {
      setTimeout(() => {
        pty.write(initialCommand + "\r");
      }, 100);
    }

    pty.onExit(() => {
      this.sessions.delete(sessionId);
      if (session.websocket) {
        session.websocket.close();
      }
    });

    return session;
  }

  createAgentPtySession(instanceId: string, agentPty: IPty): TerminalSession {
    const sessionId = `terminal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const session: TerminalSession = {
      id: sessionId,
      instanceId,
      claudePty: agentPty,
      createdAt: new Date(),
    };

    this.sessions.set(sessionId, session);

    agentPty.onExit(() => {
      this.sessions.delete(sessionId);
      if (session.websocket) {
        session.websocket.close();
      }
    });

    return session;
  }

  createClaudeSession(
    instanceId: string,
    claudeProcess: ChildProcess,
  ): TerminalSession {
    const sessionId = `terminal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const session: TerminalSession = {
      id: sessionId,
      instanceId,
      claudeProcess,
      createdAt: new Date(),
    };

    this.sessions.set(sessionId, session);

    claudeProcess.on("exit", () => {
      this.sessions.delete(sessionId);
      if (session.websocket) {
        session.websocket.close();
      }
    });

    return session;
  }

  createClaudePtySession(instanceId: string, claudePty: IPty): TerminalSession {
    const sessionId = `terminal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const session: TerminalSession = {
      id: sessionId,
      instanceId,
      claudePty,
      createdAt: new Date(),
    };

    this.sessions.set(sessionId, session);

    claudePty.onExit(() => {
      this.sessions.delete(sessionId);
      if (session.websocket) {
        session.websocket.close();
      }
    });

    return session;
  }

  attachWebSocket(sessionId: string, ws: WebSocket): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      ws.close(1000, "Session not found");
      return;
    }

    session.websocket = ws;

    if (session.pty) {
      this.attachPtyWebSocket(session, ws);
    } else if (session.claudeProcess) {
      this.attachProcessWebSocket(session, ws);
    } else if (session.claudePty) {
      this.attachClaudePtyWebSocket(session, ws);
    }

    ws.on("close", () => {
      session.websocket = undefined;
    });

    ws.send(JSON.stringify({ type: "ready" }));
  }

  private attachPtyWebSocket(session: TerminalSession, ws: WebSocket): void {
    const { pty } = session;
    if (!pty) return;

    pty.onData((data: string) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    });

    ws.on("message", (message: string) => {
      const msg = parseTerminalClientMessage(message.toString());
      if (!msg) {
        console.error("Error processing terminal message: invalid payload");
        return;
      }

      switch (msg.type) {
        case "data":
          pty.write(msg.data);
          break;
        case "resize":
          if (this.isValidResizeDimensions(msg)) {
            this.safeResize(pty, msg.cols, msg.rows);
          } else {
            console.warn(
              `Invalid resize dimensions: cols=${String(msg.cols)}, rows=${String(msg.rows)}`,
            );
          }
          break;
        case "ping":
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "pong" }));
          }
          break;
      }
    });
  }

  private attachProcessWebSocket(
    session: TerminalSession,
    ws: WebSocket,
  ): void {
    const { claudeProcess } = session;
    if (!claudeProcess) return;

    claudeProcess.stdout?.on("data", (data: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", data: data.toString() }));
      }
    });

    claudeProcess.stderr?.on("data", (data: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", data: data.toString() }));
      }
    });

    ws.on("message", (message: string) => {
      const msg = parseTerminalClientMessage(message.toString());
      if (!msg) {
        console.error("Error processing terminal message: invalid payload");
        return;
      }

      switch (msg.type) {
        case "data":
          if (claudeProcess.stdin?.writable) {
            claudeProcess.stdin.write(msg.data);
          }
          break;
        case "ping":
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "pong" }));
          }
          break;
      }
    });
  }

  private attachClaudePtyWebSocket(
    session: TerminalSession,
    ws: WebSocket,
  ): void {
    const { claudePty } = session;
    if (!claudePty) return;

    claudePty.onData((data: string) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    });

    ws.on("message", (message: string) => {
      const msg = parseTerminalClientMessage(message.toString());
      if (!msg) {
        console.error("Error processing terminal message: invalid payload");
        return;
      }

      switch (msg.type) {
        case "data":
          claudePty.write(msg.data);
          break;
        case "resize":
          if (this.isValidResizeDimensions(msg)) {
            this.safeResize(claudePty, msg.cols, msg.rows);
          } else {
            console.warn(
              `Invalid resize dimensions: cols=${String(msg.cols)}, rows=${String(msg.rows)}`,
            );
          }
          break;
        case "ping":
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "pong" }));
          }
          break;
      }
    });
  }

  private isValidDimension(value: unknown): value is number {
    return (
      typeof value === "number" && Number.isInteger(value) && value > 0
    );
  }

  private isValidResizeDimensions(
    dimensions: { cols: unknown; rows: unknown },
  ): dimensions is { cols: number; rows: number } {
    return (
      this.isValidDimension(dimensions.cols) &&
      this.isValidDimension(dimensions.rows)
    );
  }

  private safeResize(pty: IPty, cols: number, rows: number): void {
    try {
      pty.resize(cols, rows);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Failed to resize terminal (PTY may have exited): ${message}`);
    }
  }

  getSession(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  getSessionsByInstance(instanceId: string): TerminalSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.instanceId === instanceId,
    );
  }

  closeSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      if (session.pty) {
        session.pty.kill();
      }
      this.sessions.delete(id);
      if (session.websocket) {
        session.websocket.close();
      }
    }
  }

  cleanup(): void {
    for (const session of this.sessions.values()) {
      this.closeSession(session.id);
    }
  }
}
