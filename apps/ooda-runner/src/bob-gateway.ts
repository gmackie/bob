import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import WebSocket from "ws";

import type { AgentAdapter, AdapterEvent } from "@gmacko/ooda/agent-adapters";

const RECONNECT_DELAY_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 25_000;

export interface BobGatewayConfig {
  gatewayUrl: string;
  apiKey: string;
  workspaceId: string;
  devDir: string;
  maxConcurrent: number;
}

interface ServerSessionAvailable {
  type: "session_available";
  sessionId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
  sessionType?: "execution" | "planning";
  description?: string;
  identifier?: string;
  branch?: string;
  personaId?: string;
  personaConfig?: {
    model?: string;
    systemPrompt?: string;
    allowedTools?: string[];
    autonomyLevel?: string;
    metadata?: Record<string, unknown>;
  };
  planningContext?: {
    workspaceId?: string;
    projectId?: string;
    projectName?: string;
    launchContext?: {
      intent: "shape" | "breakdown";
      notes: string;
      workItem?: { id: string; identifier: string; title: string; kind: string };
      selectedRepoSources: Array<{ id: string; label: string; path: string; detail: string }>;
      attachedFiles: Array<{ name: string; sizeLabel: string; content?: string }>;
    };
  };
}

type ServerMessage =
  | { type: "hello_ok"; userId: string; heartbeatIntervalMs: number }
  | { type: "error"; code: string; message: string }
  | { type: "pong" }
  | ServerSessionAvailable
  | { type: string };

export class BobGatewayConnector {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private activeSessions = new Map<string, ChildProcess>();
  private adapters: Map<string, AgentAdapter>;
  private stopped = false;

  constructor(
    private config: BobGatewayConfig,
    adapters: Map<string, AgentAdapter>,
  ) {
    this.adapters = adapters;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.cleanup();
    for (const [sessionId, child] of this.activeSessions) {
      console.log(`[bob-gw] Killing agent for session ${sessionId}`);
      child.kill("SIGTERM");
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private connect(): void {
    if (this.stopped) return;
    console.log(`[bob-gw] Connecting to ${this.config.gatewayUrl}`);
    this.ws = new WebSocket(this.config.gatewayUrl);

    this.ws.on("open", () => {
      this.reconnectAttempt = 0;
      console.log("[bob-gw] Connected, sending hello");
      this.send({
        type: "hello",
        clientId: `executor-${process.pid}`,
        deviceType: "daemon",
        token: this.config.apiKey,
        workspaceId: this.config.workspaceId,
      });
      this.startHeartbeat();
    });

    this.ws.on("message", (data) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.handleMessage(msg);
    });

    this.ws.on("close", () => {
      this.cleanup();
      if (this.stopped) return;
      this.reconnectAttempt++;
      const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt - 1), 60_000);
      console.log(`[bob-gw] Disconnected, reconnecting in ${delay / 1000}s`);
      setTimeout(() => this.connect(), delay);
    });

    this.ws.on("error", (err) => {
      console.error("[bob-gw] WebSocket error:", err.message);
    });
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "ping", ts: new Date().toISOString() });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "hello_ok":
        console.log(`[bob-gw] Authenticated as user ${(msg as any).userId}`);
        break;
      case "error":
        console.error(`[bob-gw] Server error: ${(msg as any).code} - ${(msg as any).message}`);
        break;
      case "session_available":
        void this.handleSessionAvailable(msg as ServerSessionAvailable);
        break;
      case "pong":
        break;
    }
  }

  private async handleSessionAvailable(session: ServerSessionAvailable): Promise<void> {
    if (this.activeSessions.size >= this.config.maxConcurrent) {
      console.log(`[bob-gw] At capacity (${this.config.maxConcurrent}), skipping ${session.sessionId}`);
      return;
    }

    console.log(`[bob-gw] Claiming session ${session.sessionId}: ${session.title}`);
    this.send({ type: "session_claimed", sessionId: session.sessionId });
    this.send({ type: "session_status", sessionId: session.sessionId, status: "starting" });

    const workDir = this.resolveWorkDir(session);
    if (!existsSync(workDir)) {
      console.error(`[bob-gw] Working directory not found: ${workDir}`);
      this.send({ type: "session_status", sessionId: session.sessionId, status: "error" });
      return;
    }

    if (session.branch) {
      await this.gitCheckoutBranch(workDir, session.branch).catch(() => {});
    }

    const prompt = this.buildPrompt(session);
    const adapterId = session.agentType || "claude";
    const adapter = adapterId !== "codex" ? this.adapters.get(adapterId) : undefined;

    this.send({ type: "session_status", sessionId: session.sessionId, status: "running" });
    this.sendEvent(session.sessionId, "state", "system", { status: "running" });

    const startTime = Date.now();
    try {
      if (adapter) {
        await this.runWithAdapter(session, adapter, workDir, prompt);
      } else {
        await this.runWithCli(session, workDir, prompt);
      }
      this.send({ type: "session_status", sessionId: session.sessionId, status: "completed" });
      this.sendEvent(session.sessionId, "state", "system", { status: "completed" });
      console.log(`[bob-gw] Session ${session.sessionId} completed`);
      void this.reportToBizPulse(session, "completed", Date.now() - startTime);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[bob-gw] Session ${session.sessionId} failed: ${errMsg}`);
      this.send({ type: "session_status", sessionId: session.sessionId, status: "error" });
      this.sendEvent(session.sessionId, "error", "system", { code: "AGENT_ERROR", message: errMsg });
      void this.reportToBizPulse(session, "failed", Date.now() - startTime);
    } finally {
      this.activeSessions.delete(session.sessionId);
    }
  }

  private async runWithAdapter(
    session: ServerSessionAvailable,
    adapter: AgentAdapter,
    workDir: string,
    prompt: string,
  ): Promise<void> {
    const systemPrompt = this.buildSystemPrompt(session);
    const command = adapter.buildCommand({ prompt, workspaceRoot: workDir, systemPrompt });

    await adapter.execute(command, (event: AdapterEvent) => {
      if (event.type === "stdout" || event.type === "stderr") {
        this.sendEvent(session.sessionId, "output_chunk", "agent", {
          data: event.data,
          stream: event.type,
        });
      }
    });
  }

  private runWithCli(
    session: ServerSessionAvailable,
    workDir: string,
    prompt: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const { command, args } = this.getCliCommand(session.agentType || "claude", prompt, session);
      console.log(`[bob-gw] Spawning: ${command} ${args.join(" ").slice(0, 80)}...`);

      const child = spawn(command, args, {
        cwd: workDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CI: "true", TERM: "dumb" },
      });

      this.activeSessions.set(session.sessionId, child);

      child.stdout?.on("data", (data: Buffer) => {
        this.sendEvent(session.sessionId, "output_chunk", "agent", {
          data: data.toString(),
          stream: "stdout",
        });
      });

      child.stderr?.on("data", (data: Buffer) => {
        this.sendEvent(session.sessionId, "output_chunk", "agent", {
          data: data.toString(),
          stream: "stderr",
        });
      });

      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Agent exited with code ${code}`));
      });

      child.on("error", (err) => reject(new Error(`Failed to spawn agent: ${err.message}`)));

      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 5000);
      }, 30 * 60 * 1000);

      child.on("close", () => clearTimeout(timeout));
    });
  }

  private getCliCommand(
    agentType: string,
    prompt: string,
    session: ServerSessionAvailable,
  ): { command: string; args: string[] } {
    const persona = session.personaConfig;
    switch (agentType) {
      case "claude": {
        const args = ["--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
        if (persona?.model) args.push("--model", persona.model);
        if (persona?.allowedTools?.length) args.push("--allowedTools", persona.allowedTools.join(","));
        if (persona?.systemPrompt) args.push("--append-system-prompt", persona.systemPrompt);
        args.push(prompt);
        return { command: "claude", args };
      }
      case "codex": {
        const codexPrompt = persona?.systemPrompt
          ? `${persona.systemPrompt}\n\n---\n\n${prompt}`
          : prompt;
        return { command: "codex", args: ["exec", "--full-auto", codexPrompt] };
      }
      case "cursor": {
        const cursorArgs = ["--print", "--yolo", "--trust"];
        if (persona?.model) cursorArgs.push("--model", persona.model);
        const cursorPrompt = persona?.systemPrompt
          ? `${persona.systemPrompt}\n\n---\n\n${prompt}`
          : prompt;
        cursorArgs.push(cursorPrompt);
        return { command: "agent", args: cursorArgs };
      }
      default: {
        const args = ["--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
        if (persona?.model) args.push("--model", persona.model);
        if (persona?.systemPrompt) args.push("--append-system-prompt", persona.systemPrompt);
        args.push(prompt);
        return { command: "claude", args };
      }
    }
  }

  private buildSystemPrompt(session: ServerSessionAvailable): string | undefined {
    const persona = session.personaConfig;
    if (!persona?.systemPrompt && !persona?.autonomyLevel) return undefined;
    let sp = persona?.systemPrompt ?? "";
    if (persona?.autonomyLevel) {
      sp += `\n\nAutonomy level: ${persona.autonomyLevel}. Operate within this level.`;
    }
    return sp.trim() || undefined;
  }

  private buildPrompt(session: ServerSessionAvailable): string {
    const parts: string[] = [];
    if (session.identifier && session.title) {
      parts.push(`Task: ${session.identifier} - ${session.title}`);
    } else if (session.title) {
      parts.push(`Task: ${session.title}`);
    }
    if (session.description) parts.push(`\nDescription:\n${session.description}`);
    if (session.branch) parts.push(`\nWork on branch: ${session.branch}`);

    const bizpulse = session.personaConfig?.metadata?.bizpulse as
      | { startupSlug?: string }
      | undefined;
    if (bizpulse?.startupSlug) {
      parts.push(`\nYou are operating on startup: ${bizpulse.startupSlug}`);
    }

    if (session.planningContext?.launchContext) {
      const lc = session.planningContext.launchContext;
      parts.push(`\nPlanning intent: ${lc.intent}`);
      if (lc.notes) parts.push(`\nBrief: ${lc.notes}`);
      if (lc.workItem) {
        parts.push(`\nWork item: ${lc.workItem.identifier} - ${lc.workItem.title} (${lc.workItem.kind})`);
      }
    }

    if (session.sessionType === "planning") {
      parts.push("\n\nAnalyze the codebase and create a structured plan with draft tasks.");
    } else {
      parts.push("\n\nImplement this task. Create a commit when done.");
    }
    return parts.join("\n");
  }

  private resolveWorkDir(session: ServerSessionAvailable): string {
    if (session.workingDirectory && existsSync(session.workingDirectory)) {
      return session.workingDirectory;
    }
    return this.config.devDir;
  }

  private sendEvent(sessionId: string, eventType: string, direction: string, payload: Record<string, unknown>): void {
    this.send({ type: "session_event", sessionId, eventType, direction, payload });
  }

  private async reportToBizPulse(
    session: ServerSessionAvailable,
    status: "completed" | "failed",
    durationMs: number,
  ): Promise<void> {
    const bizpulse = session.personaConfig?.metadata?.bizpulse as
      | { apiUrl?: string; agentSlug?: string; startupSlug?: string }
      | undefined;
    if (!bizpulse?.apiUrl || !bizpulse?.agentSlug) return;

    try {
      await fetch(`${bizpulse.apiUrl}/api/agent/report-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.PULSE_API_KEY ?? ""}`,
        },
        body: JSON.stringify({
          agentSlug: bizpulse.agentSlug,
          externalSessionId: session.sessionId,
          startupSlug: bizpulse.startupSlug ?? null,
          title: session.title ?? null,
          status,
          durationMs,
        }),
      });
      console.log(`[bob-gw] BizPulse report sent for session ${session.sessionId}`);
    } catch (err) {
      console.warn(`[bob-gw] BizPulse report failed:`, err instanceof Error ? err.message : err);
    }
  }

  private gitCheckoutBranch(workDir: string, branch: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", ["checkout", "-B", branch], { cwd: workDir, stdio: "pipe" });
      let stderr = "";
      child.stderr?.on("data", (d) => { stderr += d.toString(); });
      child.on("close", (code) => { if (code === 0) resolve(); else reject(new Error(stderr)); });
      child.on("error", reject);
    });
  }
}
