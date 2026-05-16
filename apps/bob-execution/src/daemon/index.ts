#!/usr/bin/env node
/**
 * Bob Execution Daemon
 *
 * Connects to the ws-gateway, receives session_available nudges,
 * spawns headless agent CLIs, and reports status/events back.
 *
 * Run: BOB_API_KEY=... BOB_WORKSPACE_ID=... GATEWAY_WS_URL=ws://... node daemon/index.js
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { computeCostUsd, type TokenCounts } from "@gmacko/core/agent/model-pricing";

interface AgentExecutionResult {
  exitCode: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

function initTelemetry(_config: { serviceName: string; serviceVersion?: string }): void {
  // Telemetry is optional — OTel bundling doesn't work in standalone ESM builds.
}

async function traceAgentExecution(
  _ctx: Record<string, unknown>,
  fn: (span: null) => Promise<void>,
): Promise<void> {
  await fn(null);
}

function setAgentResult(_span: unknown, _result: AgentExecutionResult): void {
  // no-op
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GATEWAY_WS_URL = process.env.GATEWAY_WS_URL ?? "ws://100.101.32.120:3003/sessions";
const BOB_API_KEY = process.env.BOB_API_KEY ?? "";
const BOB_WORKSPACE_ID = process.env.BOB_WORKSPACE_ID ?? "";
const DEV_DIR = process.env.BOB_DEV_DIR ?? process.env.HOME ?? "/home/mackieg";
const CLIENT_ID = `executor-${process.pid}`;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT ?? "2", 10);
const RECONNECT_DELAY_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 25_000;

if (!BOB_API_KEY || !BOB_WORKSPACE_ID) {
  console.error("[executor] FATAL: BOB_API_KEY and BOB_WORKSPACE_ID required");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Types (inline subset of @bob/ws protocol to keep daemon self-contained)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let reconnectAttempt = 0;
const activeSessions = new Map<string, ChildProcess>();

// ---------------------------------------------------------------------------
// WebSocket connection
// ---------------------------------------------------------------------------

function connect(): void {
  console.log(`[executor] Connecting to ${GATEWAY_WS_URL}`);
  ws = new WebSocket(GATEWAY_WS_URL);

  ws.on("open", () => {
    reconnectAttempt = 0;
    console.log("[executor] Connected, sending hello");
    send({
      type: "hello",
      clientId: CLIENT_ID,
      deviceType: "daemon",
      token: BOB_API_KEY,
      workspaceId: BOB_WORKSPACE_ID,
    });
    startHeartbeat();
  });

  ws.on("message", (data) => {
    const raw = data.toString();
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    handleMessage(msg);
  });

  ws.on("close", () => {
    cleanup();
    reconnectAttempt++;
    const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempt - 1), 60_000);
    console.log(`[executor] Disconnected, reconnecting in ${delay / 1000}s (attempt ${reconnectAttempt})...`);
    setTimeout(connect, delay);
  });

  ws.on("error", (err) => {
    console.error("[executor] WebSocket error:", err.message);
  });
}

function send(msg: Record<string, unknown>): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function startHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    send({ type: "ping", ts: new Date().toISOString() });
  }, HEARTBEAT_INTERVAL_MS);
}

function cleanup(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function handleMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case "hello_ok":
      console.log(`[executor] Authenticated as user ${(msg as any).userId}`);
      break;

    case "error":
      console.error(`[executor] Server error: ${(msg as any).code} - ${(msg as any).message}`);
      break;

    case "session_available":
      handleSessionAvailable(msg as ServerSessionAvailable);
      break;

    case "pong":
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Session execution
// ---------------------------------------------------------------------------

async function handleSessionAvailable(session: ServerSessionAvailable): Promise<void> {
  if (activeSessions.size >= MAX_CONCURRENT) {
    console.log(`[executor] At capacity (${MAX_CONCURRENT}), skipping ${session.sessionId}`);
    return;
  }

  console.log(`[executor] Claiming session ${session.sessionId}: ${session.title}`);

  // Claim the session
  send({ type: "session_claimed", sessionId: session.sessionId });

  // Report starting
  send({ type: "session_status", sessionId: session.sessionId, status: "starting" });

  // Prepare working directory
  const workDir = resolveWorkDir(session);
  if (!existsSync(workDir)) {
    console.error(`[executor] Working directory not found: ${workDir}`);
    send({ type: "session_status", sessionId: session.sessionId, status: "error" });
    return;
  }

  // Create branch if specified
  if (session.branch) {
    try {
      await gitCheckoutBranch(workDir, session.branch);
    } catch (err) {
      console.warn(`[executor] Branch checkout failed: ${err}`);
    }
  }

  // Build the prompt from session metadata
  const prompt = buildPrompt(session);

  // Spawn the agent
  const agentType = session.agentType || "claude";
  console.log(`[executor] Starting ${agentType} for ${session.identifier ?? session.sessionId}`);

  send({ type: "session_status", sessionId: session.sessionId, status: "running" });
  sendEvent(session.sessionId, "state", "system", { status: "running" });

  try {
    await traceAgentExecution(
      {
        agentType,
        sessionId: session.sessionId,
        taskIdentifier: session.identifier,
        taskTitle: session.title,
        workspaceId: BOB_WORKSPACE_ID,
        branch: session.branch,
      },
      async (span) => {
        const persona = getPersonaConfig(session);
        const result = await runAgent(session, workDir, prompt, persona);
        setAgentResult(span, result);
      },
    );
    send({ type: "session_status", sessionId: session.sessionId, status: "completed" });
    sendEvent(session.sessionId, "state", "system", { status: "completed" });
    console.log(`[executor] Session ${session.sessionId} completed`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[executor] Session ${session.sessionId} failed: ${errMsg}`);
    send({ type: "session_status", sessionId: session.sessionId, status: "error" });
    sendEvent(session.sessionId, "error", "system", { code: "AGENT_ERROR", message: errMsg });
  } finally {
    activeSessions.delete(session.sessionId);
  }
}

function resolveWorkDir(session: ServerSessionAvailable): string {
  if (session.workingDirectory && existsSync(session.workingDirectory)) {
    return session.workingDirectory;
  }
  return DEV_DIR;
}

function buildPrompt(session: ServerSessionAvailable): string {
  const parts: string[] = [];

  if (session.identifier && session.title) {
    parts.push(`Task: ${session.identifier} - ${session.title}`);
  } else if (session.title) {
    parts.push(`Task: ${session.title}`);
  }

  if (session.description) {
    parts.push(`\nDescription:\n${session.description}`);
  }

  if (session.branch) {
    parts.push(`\nWork on branch: ${session.branch}`);
  }

  if (session.planningContext) {
    const pc = session.planningContext;
    if (pc.projectName) {
      parts.push(`\nProject: ${pc.projectName}`);
    }
    if (pc.launchContext) {
      const lc = pc.launchContext;
      parts.push(`\nPlanning intent: ${lc.intent}`);
      if (lc.notes) parts.push(`\nBrief: ${lc.notes}`);
      if (lc.workItem) {
        parts.push(`\nWork item: ${lc.workItem.identifier} - ${lc.workItem.title} (${lc.workItem.kind})`);
      }
      if (lc.selectedRepoSources?.length) {
        parts.push(`\nRepo context:`);
        for (const src of lc.selectedRepoSources) {
          parts.push(`  - ${src.label} (${src.path}): ${src.detail}`);
        }
      }
      if (lc.attachedFiles?.length) {
        parts.push(`\nAttached files:`);
        for (const f of lc.attachedFiles) {
          parts.push(`  - ${f.name} [${f.sizeLabel}]`);
          if (f.content?.trim()) {
            parts.push(`    ${f.content.trim().split("\n").join("\n    ")}`);
          }
        }
      }
    }
  }

  const bizpulse = session.personaConfig?.metadata?.bizpulse as
    | { startupSlug?: string }
    | undefined;
  if (bizpulse?.startupSlug) {
    parts.push(`\nYou are operating on startup: ${bizpulse.startupSlug}`);
  }

  if (session.sessionType === "planning") {
    parts.push("\n\nAnalyze the codebase and create a structured plan with draft tasks.");
  } else {
    parts.push("\n\nImplement this task. Create a commit when done.");
  }

  return parts.join("\n");
}

function sendEvent(
  sessionId: string,
  eventType: string,
  direction: string,
  payload: Record<string, unknown>,
): void {
  send({
    type: "session_event",
    sessionId,
    eventType,
    direction,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Git operations
// ---------------------------------------------------------------------------

function gitCheckoutBranch(workDir: string, branch: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["checkout", "-B", branch], { cwd: workDir, stdio: "pipe" });
    let stderr = "";
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git checkout failed: ${stderr}`));
    });
    child.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Agent runner
// ---------------------------------------------------------------------------

function runAgent(session: ServerSessionAvailable, workDir: string, prompt: string, persona?: PersonaConfig): Promise<AgentExecutionResult> {
  return new Promise((resolve, reject) => {
    const sessionId = session.sessionId;
    const agentType = session.agentType || "claude";
    const { command, args } = getAgentCommand(agentType, prompt, persona);
    console.log(`[executor] Spawning: ${command} ${args.join(" ").slice(0, 80)}...`);

    const startTime = Date.now();

    const child = spawn(command, args, {
      cwd: workDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CI: "true",
        TERM: "dumb",
        PULSE_API_KEY: process.env.PULSE_API_KEY ?? "",
        PULSE_API_URL: process.env.PULSE_API_URL ?? "https://bizpulse.cc",
      },
    });

    activeSessions.set(sessionId, child);

    let output = "";

    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      sendEvent(sessionId, "output_chunk", "agent", {
        data: chunk,
        stream: "stdout",
      });
    });

    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      sendEvent(sessionId, "output_chunk", "agent", {
        data: chunk,
        stream: "stderr",
      });
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - startTime;
      const tokenUsage = parseTokenUsage(output, persona?.model);
      const result: AgentExecutionResult = {
        exitCode: code ?? 1,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        costUsd: tokenUsage.costUsd,
      };

      void reportToBizPulse(
        session,
        code === 0 ? "completed" : "failed",
        tokenUsage,
        durationMs,
        output,
      );

      if (code === 0) {
        sendEvent(sessionId, "message_final", "agent", {
          content: output.slice(-2000),
          role: "assistant",
        });
        resolve(result);
      } else {
        reject(new Error(`Agent exited with code ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn agent: ${err.message}`));
    });

    // Safety timeout — 30 minutes max per task
    const timeout = setTimeout(() => {
      console.warn(`[executor] Session ${sessionId} timed out, killing agent`);
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000);
    }, 30 * 60 * 1000);

    child.on("close", () => clearTimeout(timeout));
  });
}

interface ParsedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  model: string;
}

function parseTokenUsage(output: string, personaModel?: string): ParsedTokenUsage {
  const defaults: ParsedTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    model: personaModel ?? "claude-sonnet-4-6",
  };

  try {
    const lines = output.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i]!.trim();
      if (!trimmed.startsWith("{")) continue;
      const json = JSON.parse(trimmed);
      if (json.type === "result" && json.usage) {
        const tokens: TokenCounts = {
          input: json.usage.input_tokens ?? 0,
          output: json.usage.output_tokens ?? 0,
          cacheRead: json.usage.cache_read_input_tokens ?? 0,
          cacheCreation: json.usage.cache_creation_input_tokens ?? 0,
        };
        const model = personaModel ?? "claude-sonnet-4-6";
        return {
          inputTokens: tokens.input,
          outputTokens: tokens.output,
          cacheReadTokens: tokens.cacheRead,
          cacheCreationTokens: tokens.cacheCreation,
          costUsd: json.total_cost_usd ?? computeCostUsd(model, tokens),
          model,
        };
      }
    }
  } catch {
    // best-effort parsing
  }
  return defaults;
}

async function reportToBizPulse(
  session: ServerSessionAvailable,
  status: "completed" | "failed",
  tokenUsage: ParsedTokenUsage,
  durationMs: number,
  finalOutput: string,
): Promise<void> {
  const bizpulse = session.personaConfig?.metadata?.bizpulse as
    | { apiUrl?: string; agentSlug?: string; startupSlug?: string }
    | undefined;

  if (!bizpulse?.apiUrl || !bizpulse?.agentSlug) return;

  const costMicrocents = Math.round(tokenUsage.costUsd * 100_000_000);

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
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        cacheReadTokens: tokenUsage.cacheReadTokens,
        cacheCreationTokens: tokenUsage.cacheCreationTokens,
        costMicrocents,
        durationMs,
        summary: finalOutput.slice(-2000),
      }),
    });
    console.log(`[executor] BizPulse report sent for session ${session.sessionId}`);
  } catch (err) {
    console.warn(`[executor] BizPulse report failed (fire-and-forget):`, err);
  }
}

interface PersonaConfig {
  model?: string;
  allowedTools?: string[];
  systemPrompt?: string;
  autonomyLevel?: string;
}

function getPersonaConfig(session: ServerSessionAvailable): PersonaConfig {
  if (session.personaConfig) {
    let systemPrompt = session.personaConfig.systemPrompt;
    const autonomyLevel = session.personaConfig.autonomyLevel;
    if (autonomyLevel && systemPrompt) {
      systemPrompt = `${systemPrompt}\n\nAutonomy level: ${autonomyLevel}. Operate within this level.`;
    } else if (autonomyLevel) {
      systemPrompt = `Autonomy level: ${autonomyLevel}. Operate within this level.`;
    }
    return {
      model: session.personaConfig.model,
      allowedTools: session.personaConfig.allowedTools,
      systemPrompt,
      autonomyLevel,
    };
  }

  const meta = (session as any).personaMetadata as Record<string, unknown> | null;
  if (!meta) return {};

  let systemPrompt = typeof meta.systemPrompt === "string" ? meta.systemPrompt : undefined;
  const autonomyLevel = typeof meta.autonomyLevel === "string" ? meta.autonomyLevel : undefined;
  if (autonomyLevel && systemPrompt) {
    systemPrompt = `${systemPrompt}\n\nAutonomy level: ${autonomyLevel}. Operate within this level.`;
  } else if (autonomyLevel) {
    systemPrompt = `Autonomy level: ${autonomyLevel}. Operate within this level.`;
  }

  return {
    model: typeof meta.model === "string" ? meta.model : undefined,
    allowedTools: Array.isArray(meta.allowedTools) ? meta.allowedTools as string[] : undefined,
    systemPrompt,
    autonomyLevel,
  };
}

function getAgentCommand(agentType: string, prompt: string, persona?: PersonaConfig): { command: string; args: string[] } {
  switch (agentType) {
    case "claude": {
      const args = ["--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
      if (persona?.model) args.push("--model", persona.model);
      if (persona?.allowedTools?.length) args.push("--allowedTools", persona.allowedTools.join(","));
      if (persona?.systemPrompt) args.push("--append-system-prompt", persona.systemPrompt);
      args.push(prompt);
      return { command: "claude", args };
    }
    case "codex":
      return { command: "codex", args: ["--quiet", "--full-auto", prompt] };
    case "opencode":
      return { command: "opencode", args: ["run", prompt] };
    default: {
      const defaultArgs = ["--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
      if (persona?.model) defaultArgs.push("--model", persona.model);
      if (persona?.allowedTools?.length) defaultArgs.push("--allowedTools", persona.allowedTools.join(","));
      if (persona?.systemPrompt) defaultArgs.push("--append-system-prompt", persona.systemPrompt);
      defaultArgs.push(prompt);
      return { command: "claude", args: defaultArgs };
    }
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

function gracefulShutdown(): void {
  console.log("[executor] Shutting down...");
  cleanup();

  for (const [sessionId, child] of activeSessions) {
    console.log(`[executor] Killing agent for session ${sessionId}`);
    child.kill("SIGTERM");
  }

  if (ws) {
    ws.close();
    ws = null;
  }

  setTimeout(() => process.exit(0), 3000);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

console.log("[executor] Bob Execution Daemon starting");
console.log(`[executor] Gateway: ${GATEWAY_WS_URL}`);
console.log(`[executor] Workspace: ${BOB_WORKSPACE_ID}`);
console.log(`[executor] Dev dir: ${DEV_DIR}`);
console.log(`[executor] Max concurrent: ${MAX_CONCURRENT}`);

initTelemetry({ serviceName: "bob-daemon", serviceVersion: "0.1.0" });

connect();
