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
        env: process.env as { [key: string]: string },
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
        cwd: cwd || process.env.HOME || "/",
        env: process.env as { [key: string]: string },
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
    if (!session.pty) return;

    session.pty.onData((data: string) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    });

    ws.on("message", (message: string) => {
      try {
        const msg = JSON.parse(message.toString());

        switch (msg.type) {
          case "data":
            session.pty!.write(msg.data);
            break;
          case "resize":
            if (this.isValidResizeDimensions(msg.cols, msg.rows)) {
              this.safeResize(session.pty!, msg.cols, msg.rows);
            } else {
              console.warn(
                `Invalid resize dimensions: cols=${msg.cols}, rows=${msg.rows}`,
              );
            }
            break;
          case "ping":
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: "pong" }));
            }
            break;
        }
      } catch (error) {
        console.error("Error processing terminal message:", error);
      }
    });
  }

  private attachProcessWebSocket(
    session: TerminalSession,
    ws: WebSocket,
  ): void {
    if (!session.claudeProcess) return;

    session.claudeProcess.stdout?.on("data", (data: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", data: data.toString() }));
      }
    });

    session.claudeProcess.stderr?.on("data", (data: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", data: data.toString() }));
      }
    });

    ws.on("message", (message: string) => {
      try {
        const msg = JSON.parse(message.toString());

        switch (msg.type) {
          case "data":
            if (session.claudeProcess?.stdin?.writable) {
              session.claudeProcess.stdin.write(msg.data);
            }
            break;
          case "ping":
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: "pong" }));
            }
            break;
        }
      } catch (error) {
        console.error("Error processing terminal message:", error);
      }
    });
  }

  private attachClaudePtyWebSocket(
    session: TerminalSession,
    ws: WebSocket,
  ): void {
    if (!session.claudePty) return;

    session.claudePty.onData((data: string) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    });

    ws.on("message", (message: string) => {
      try {
        const msg = JSON.parse(message.toString());

        switch (msg.type) {
          case "data":
            session.claudePty!.write(msg.data);
            break;
          case "resize":
            if (this.isValidResizeDimensions(msg.cols, msg.rows)) {
              this.safeResize(session.claudePty!, msg.cols, msg.rows);
            } else {
              console.warn(
                `Invalid resize dimensions: cols=${msg.cols}, rows=${msg.rows}`,
              );
            }
            break;
          case "ping":
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: "pong" }));
            }
            break;
        }
      } catch (error) {
        console.error("Error processing terminal message:", error);
      }
    });
  }

  private isValidResizeDimensions(cols: unknown, rows: unknown): boolean {
    return (
      typeof cols === "number" &&
      typeof rows === "number" &&
      Number.isInteger(cols) &&
      Number.isInteger(rows) &&
      cols > 0 &&
      rows > 0
    );
  }

  private safeResize(pty: IPty, cols: number, rows: number): void {
    try {
      if (pty.pid !== undefined) {
        pty.resize(cols, rows);
      }
    } catch (err) {
      console.warn(`Failed to resize terminal (PTY may have exited): ${err}`);
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
