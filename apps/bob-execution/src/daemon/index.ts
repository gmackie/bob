#!/usr/bin/env node
/**
 * Bob Execution Daemon
 *
 * Connects to the ws-gateway, receives session_available nudges,
 * spawns headless agent CLIs, and reports status/events back.
 *
 * Run: BOB_API_KEY=... BOB_WORKSPACE_ID=... GATEWAY_WS_URL=ws://... node daemon/index.js
 */
import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { computeCostUsd } from "@gmacko/core/agent/model-pricing";
import type { TokenCounts } from "@gmacko/core/agent/model-pricing";
import {
  captureCriticalFailure,
  identifyTenant,
  initNodeObservability,
  resolveObservabilityConfig,
  shutdownNodeObservability,
} from "@bob/observability";
import {
  initTelemetry,
  traceAgentExecution,
  setAgentResult,
  shutdownTelemetry,
} from "@bob/telemetry";
import {
  buildProviderCommand,
  buildProviderEnvironment,
  normalizeProviderId,
  parseProviderStream,
} from "../providers/runtime.js";
import { probeCliProvider } from "../providers/cli-provider.js";
import { providerIds } from "../providers/contract.js";
import { createOracleClient, fetchOracleSeed, buildSeedQuestion } from "../oracle-client.js";
import { readOracleConfig } from "../oracle-config.js";
import { SessionAdmission } from "./session-admission.js";
import { claudeOracleArgs } from "./oracle-args.js";

interface AgentExecutionResult {
  exitCode: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  providerCapacity?: {
    provider: string;
    collectedAt: string;
    allowance: { status: "unavailable"; source: "provider" };
    observed?: {
      source: "provider" | "bob_metered" | "estimated";
      inputTokens: number;
      outputTokens: number;
      costUsd?: number;
    };
  };
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
const DEFAULT_AGENT_TYPE = process.env.DEFAULT_AGENT_TYPE ?? "claude";
const CODEX_MODEL = process.env.CODEX_MODEL ?? "gpt-5.5";
const CODEX_SANDBOX = process.env.CODEX_SANDBOX ?? "read-only";

const ORACLE = readOracleConfig();
const oracleClient = ORACLE.enabled ? createOracleClient(ORACLE.apiUrl, ORACLE.token) : null;

function setupOracleMcpConfig(): string | null {
  if (!ORACLE.enabled) return null;
  const mcpServerPath = fileURLToPath(new URL("../ooda-oracle-mcp.ts", import.meta.url));
  // Resolved for the tsx (no-build) deploy. If the server file is missing (e.g. a
  // bundled dist/ run that didn't emit it), degrade to "oracle disabled" rather than
  // spawning a broken MCP child on every claude session.
  if (!existsSync(mcpServerPath)) {
    console.log(`[oracle] MCP server not found at ${mcpServerPath}; live tool disabled.`);
    return null;
  }
  const configPath = join(tmpdir(), `ooda-oracle-mcp.${process.pid}.json`);
  const config = {
    mcpServers: {
      ooda: {
        command: "tsx",
        args: [mcpServerPath],
        env: { OODA_API_URL: ORACLE.apiUrl, OODA_ORACLE_TOKEN: ORACLE.token },
      },
    },
  };
  // 0o600: the config embeds OODA_ORACLE_TOKEN, so keep it owner-only in tmpdir.
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  console.log(`[oracle] MCP config written to ${configPath} (server ${mcpServerPath})`);
  return configPath;
}

const ORACLE_MCP_CONFIG_PATH = setupOracleMcpConfig();

const observabilityConfig = resolveObservabilityConfig({
  serviceName: "bob-execution",
});
initNodeObservability(observabilityConfig);
initTelemetry({
  serviceName: "bob-execution",
  disabled: !process.env.OTEL_EXPORTER_OTLP_ENDPOINT && !process.env.SIGNOZ_ENDPOINT,
});
if (observabilityConfig.tenantId || BOB_WORKSPACE_ID) {
  identifyTenant({
    tenantId: observabilityConfig.tenantId ?? BOB_WORKSPACE_ID,
    workspaceId: BOB_WORKSPACE_ID,
  });
}

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
  /** Legacy fallback persona shape sent by older gateway/API versions. */
  personaMetadata?: Record<string, unknown> | null;
  planningContext?: {
    workspaceId?: string;
    projectId?: string;
    projectName?: string;
    launchContext?: {
      intent: "shape" | "breakdown";
      notes: string;
      workItem?: { id: string; identifier: string; title: string; kind: string };
      selectedRepoSources: { id: string; label: string; path: string; detail: string }[];
      attachedFiles: { name: string; sizeLabel: string; content?: string }[];
    };
  };
}

type KnownServerMessage =
  | { type: "hello_ok"; userId: string; heartbeatIntervalMs: number }
  | { type: "error"; code: string; message: string }
  | { type: "pong" }
  | ServerSessionAvailable;

/** Any inbound gateway message: known variants, plus unrecognized ones we ignore. */
type ServerMessage = KnownServerMessage | { type: string };

/**
 * Minimal runtime check for inbound gateway messages: only `type` is
 * guaranteed to exist and be a string (the gateway's message protocol is
 * internal/unpublished, so we don't have a shared schema to validate
 * against). Downstream code in `handleMessage` further narrows per-variant
 * fields via the `KnownServerMessage` discriminated union, falling back to
 * the generic `{ type: string }` shape (handled by `default:`) for anything
 * else the gateway might send.
 */
function isServerMessage(value: unknown): value is ServerMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

/**
 * `msg.type` has already been checked against a specific literal by the
 * caller's switch statement, but the `{ type: string }` catch-all member of
 * `ServerMessage` prevents TypeScript's control-flow analysis from
 * discriminating the union on that check alone. This narrows explicitly
 * instead of falling back to `any`.
 */
function asKnownMessage<T extends KnownServerMessage["type"]>(
  msg: ServerMessage,
  type: T,
): Extract<KnownServerMessage, { type: T }> {
  if (msg.type !== type) {
    throw new Error(`asKnownMessage: expected type "${type}", got "${msg.type}"`);
  }
  return msg as Extract<KnownServerMessage, { type: T }>;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let reconnectAttempt = 0;
const activeSessions = new Map<string, ChildProcess>();
const sessionAdmission = new SessionAdmission(MAX_CONCURRENT);
let providerSnapshot: Awaited<ReturnType<typeof probeCliProvider>>[] = [];
let lastProviderProbeAt = 0;

async function collectHostSnapshot() {
  if (Date.now() - lastProviderProbeAt > 5 * 60_000 || providerSnapshot.length === 0) {
    providerSnapshot = await Promise.all(
      providerIds.map((provider) =>
        probeCliProvider(provider, (command, args) =>
          new Promise((resolve, reject) => {
            execFile(command, args, { timeout: 10_000 }, (error, stdout, stderr) => {
              if (error && "code" in error && error.code === "ENOENT") {
                reject(error instanceof Error ? error : new Error("command not found"));
                return;
              }
              resolve({
                code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
                stdout,
                stderr,
              });
            });
          }),
        ),
      ),
    );
    lastProviderProbeAt = Date.now();
  }
  return {
    schemaVersion: 1 as const,
    hostId: CLIENT_ID,
    daemonVersion: "dev",
    queueDepth: sessionAdmission.size,
    checkedAt: new Date().toISOString(),
    providers: providerSnapshot,
  };
}

// ---------------------------------------------------------------------------
// WebSocket connection
// ---------------------------------------------------------------------------

function connect(): void {
  console.log(`[executor] Connecting to ${GATEWAY_WS_URL}`);
  ws = new WebSocket(GATEWAY_WS_URL);

  ws.on("open", () => {
    reconnectAttempt = 0;
    console.log("[executor] Connected, sending hello");
    void collectHostSnapshot().then((hostSnapshot) => {
      send({
        type: "hello",
        clientId: CLIENT_ID,
        deviceType: "daemon",
        token: BOB_API_KEY,
        workspaceId: BOB_WORKSPACE_ID,
        hostSnapshot,
      });
    });
    startHeartbeat();
  });

  ws.on("message", (data: WebSocket.RawData) => {
    let raw: string;
    if (Array.isArray(data)) {
      raw = Buffer.concat(data).toString("utf8");
    } else if (data instanceof ArrayBuffer) {
      raw = Buffer.from(data).toString("utf8");
    } else {
      raw = data.toString("utf8");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isServerMessage(parsed)) {
      console.warn("[executor] Ignoring malformed gateway message:", raw);
      return;
    }
    handleMessage(parsed);
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
    captureCriticalFailure({
      surface: "job",
      operation: "gateway_websocket",
      error: err,
      alertId: "job-gateway-disconnect",
      tenant: {
        tenantId: observabilityConfig.tenantId ?? BOB_WORKSPACE_ID,
        workspaceId: BOB_WORKSPACE_ID,
      },
    });
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
    void collectHostSnapshot().then((hostSnapshot) => {
      send({ type: "ping", ts: new Date().toISOString(), hostSnapshot });
      console.log(`[executor] Heartbeat sent (${hostSnapshot.queueDepth} in flight)`);
    });
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
    case "hello_ok": {
      const helloOk = asKnownMessage(msg, "hello_ok");
      console.log(`[executor] Authenticated as user ${helloOk.userId}`);
      break;
    }

    case "error": {
      const errorMsg = asKnownMessage(msg, "error");
      console.error(`[executor] Server error: ${errorMsg.code} - ${errorMsg.message}`);
      break;
    }

    case "session_available":
      void handleSessionAvailable(asKnownMessage(msg, "session_available"));
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
  if (!sessionAdmission.reserve(session.sessionId)) {
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
    sessionAdmission.release(session.sessionId);
    return;
  }

  // Create branch if specified
  if (session.branch) {
    try {
      await gitCheckoutBranch(workDir, session.branch);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[executor] Branch checkout failed: ${message}`);
    }
  }

  // Build the prompt from session metadata
  let prompt = buildPrompt(session);
  if (oracleClient && session.sessionType === "planning") {
    const lc = session.planningContext?.launchContext;
    // Seed the oracle with the planning substance (work-item title + brief), not the
    // intent enum ("shape"/"breakdown"). Fall back to the session title/description.
    const question =
      buildSeedQuestion(lc?.workItem?.title, lc?.notes) ||
      buildSeedQuestion(session.title, session.description);
    // Repo hint comes from the selected repo source, not the git branch (a branch name
    // is not a repository identifier and would silently mis-filter oracle results).
    const repo = lc?.selectedRepoSources[0]?.label ?? lc?.selectedRepoSources[0]?.path;
    const section = await fetchOracleSeed(oracleClient, { question, repo }, (m) => console.log(m));
    if (section) prompt = `${prompt}\n\n${section}`;
  }

  // Spawn the agent
  const agentType = session.agentType || DEFAULT_AGENT_TYPE;
  console.log(`[executor] Starting ${agentType} for ${session.identifier ?? session.sessionId}`);

  send({ type: "session_status", sessionId: session.sessionId, status: "running" });
  sendEvent(session.sessionId, "state", "system", { status: "running" });

  try {
    let executionResult: AgentExecutionResult | undefined;
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
        executionResult = await runAgent(session, workDir, prompt, persona);
        setAgentResult(span, executionResult);
      },
    );
    send({
      type: "session_status",
      sessionId: session.sessionId,
      status: "completed",
      summary: executionResult?.providerCapacity
        ? { providerCapacity: executionResult.providerCapacity }
        : undefined,
    });
    sendEvent(session.sessionId, "state", "system", { status: "completed" });
    console.log(`[executor] Session ${session.sessionId} completed`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[executor] Session ${session.sessionId} failed: ${errMsg}`);
    captureCriticalFailure({
      surface: "job",
      operation: "execute_session",
      error: err,
      alertId: "job-session-failure",
      tenant: {
        tenantId: observabilityConfig.tenantId ?? BOB_WORKSPACE_ID,
        workspaceId: BOB_WORKSPACE_ID,
      },
      metadata: {
        sessionId: session.sessionId,
        agentType: session.agentType,
        identifier: session.identifier,
      },
    });
    send({ type: "session_status", sessionId: session.sessionId, status: "error" });
    sendEvent(session.sessionId, "error", "system", { code: "AGENT_ERROR", message: errMsg });
  } finally {
    activeSessions.delete(session.sessionId);
    sessionAdmission.release(session.sessionId);
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
      if (lc.selectedRepoSources.length) {
        parts.push(`\nRepo context:`);
        for (const src of lc.selectedRepoSources) {
          parts.push(`  - ${src.label} (${src.path}): ${src.detail}`);
        }
      }
      if (lc.attachedFiles.length) {
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
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code: number | null) => {
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
    const agentType = session.agentType || DEFAULT_AGENT_TYPE;
    const providerId = normalizeProviderId(agentType);
    const { command, args } =
      providerId === "claude" && ORACLE_MCP_CONFIG_PATH
        ? getAgentCommand(agentType, prompt, persona, ORACLE_MCP_CONFIG_PATH)
        : providerId
          ? buildProviderCommand(providerId, prompt, {
              model: persona?.model ?? (providerId === "codex" ? CODEX_MODEL : undefined),
              sandbox: CODEX_SANDBOX,
              allowedTools: persona?.allowedTools,
              systemPrompt: persona?.systemPrompt,
            })
          : getAgentCommand(agentType, prompt, persona, ORACLE_MCP_CONFIG_PATH);
    console.log(`[executor] Spawning: ${command} ${args.join(" ").slice(0, 80)}...`);

    const startTime = Date.now();

    const child = spawn(command, args, {
      cwd: workDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...buildProviderEnvironment(providerId, process.env),
        CI: "true",
        TERM: "dumb",
        PULSE_API_KEY: process.env.PULSE_API_KEY ?? "",
        PULSE_API_URL: process.env.PULSE_API_URL ?? "https://bizpulse.cc",
      },
    });

    activeSessions.set(sessionId, child);

    let output = "";

    child.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      sendEvent(sessionId, "output_chunk", "agent", {
        data: chunk,
        stream: "stdout",
      });
    });

    child.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString();
      sendEvent(sessionId, "output_chunk", "agent", {
        data: chunk,
        stream: "stderr",
      });
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - startTime;
      const providerUsage = providerId
        ? parseProviderStream(providerId, output, prompt).usage
        : undefined;
      const tokenUsage = providerUsage
        ? {
            inputTokens: providerUsage.inputTokens,
            outputTokens: providerUsage.outputTokens,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            costUsd: providerUsage.costUsd ?? 0,
            model: persona?.model ?? agentType,
          }
        : parseTokenUsage(output, persona?.model);
      const result: AgentExecutionResult = {
        exitCode: code ?? 1,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        costUsd: tokenUsage.costUsd,
        ...(providerId
          ? {
              providerCapacity: {
                provider: providerId,
                collectedAt: new Date().toISOString(),
                allowance: { status: "unavailable" as const, source: "provider" as const },
                ...(tokenUsage.inputTokens > 0 || tokenUsage.outputTokens > 0
                  ? {
                      observed: {
                        source: providerUsage?.source ?? "bob_metered" as const,
                        inputTokens: tokenUsage.inputTokens,
                        outputTokens: tokenUsage.outputTokens,
                        ...(tokenUsage.costUsd > 0 ? { costUsd: tokenUsage.costUsd } : {}),
                      },
                    }
                  : {}),
              },
            }
          : {}),
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

interface ClaudeResultUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ClaudeResultLine {
  type: "result";
  usage: ClaudeResultUsage;
  total_cost_usd?: number;
}

function isClaudeResultLine(value: unknown): value is ClaudeResultLine {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("type" in value) || value.type !== "result") {
    return false;
  }
  if (!("usage" in value) || typeof value.usage !== "object" || value.usage === null) {
    return false;
  }
  return true;
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
      const trimmed = lines[i]?.trim();
      if (!trimmed?.startsWith("{")) continue;
      const parsed: unknown = JSON.parse(trimmed);
      if (!isClaudeResultLine(parsed)) continue;

      const { usage } = parsed;
      const tokens: TokenCounts = {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheCreation: usage.cache_creation_input_tokens ?? 0,
      };
      const model = personaModel ?? "claude-sonnet-4-6";
      return {
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cacheReadTokens: tokens.cacheRead,
        cacheCreationTokens: tokens.cacheCreation,
        costUsd: parsed.total_cost_usd ?? computeCostUsd(model, tokens),
        model,
      };
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

  if (!bizpulse?.apiUrl || !bizpulse.agentSlug) return;

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

  const meta = session.personaMetadata;
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

function getAgentCommand(
  agentType: string, prompt: string, persona?: PersonaConfig, mcpConfigPath?: string | null,
): { command: string; args: string[] } {
  switch (agentType) {
    case "claude": {
      const args = ["--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
      if (persona?.model) args.push("--model", persona.model);
      if (persona?.allowedTools?.length) args.push("--allowedTools", persona.allowedTools.join(","));
      if (persona?.systemPrompt) args.push("--append-system-prompt", persona.systemPrompt);
      const { mcpArgs, toolsToAdd } = claudeOracleArgs(persona, mcpConfigPath ?? null);
      // ensure tools are present even if persona.allowedTools already pushed
      if (toolsToAdd.length) {
        const have = persona?.allowedTools ?? [];
        const merged = Array.from(new Set([...have, ...toolsToAdd]));
        // replace any earlier --allowedTools value
        const idx = args.indexOf("--allowedTools");
        if (idx >= 0) args[idx + 1] = merged.join(",");
        else args.push("--allowedTools", merged.join(","));
      }
      args.push(...mcpArgs);
      args.push(prompt);
      return { command: "claude", args };
    }
    case "codex": {
      const codexArgs = ["exec"];
      if (CODEX_SANDBOX === "bypass") {
        codexArgs.push("--dangerously-bypass-approvals-and-sandbox");
      } else {
        codexArgs.push("-s", CODEX_SANDBOX);
      }
      codexArgs.push("-m", persona?.model ?? CODEX_MODEL);
      codexArgs.push(prompt);
      return { command: "codex", args: codexArgs };
    }
    case "opencode":
      return { command: "opencode", args: ["run", prompt] };
    default: {
      const defaultArgs = ["--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
      if (persona?.model) defaultArgs.push("--model", persona.model);
      if (persona?.allowedTools?.length) defaultArgs.push("--allowedTools", persona.allowedTools.join(","));
      if (persona?.systemPrompt) defaultArgs.push("--append-system-prompt", persona.systemPrompt);
      const { mcpArgs, toolsToAdd } = claudeOracleArgs(persona, mcpConfigPath ?? null);
      // ensure tools are present even if persona.allowedTools already pushed
      if (toolsToAdd.length) {
        const have = persona?.allowedTools ?? [];
        const merged = Array.from(new Set([...have, ...toolsToAdd]));
        // replace any earlier --allowedTools value
        const idx = defaultArgs.indexOf("--allowedTools");
        if (idx >= 0) defaultArgs[idx + 1] = merged.join(",");
        else defaultArgs.push("--allowedTools", merged.join(","));
      }
      defaultArgs.push(...mcpArgs);
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
    console.log(`[executor] Interrupting session ${sessionId}`);
    send({ type: "session_status", sessionId, status: "interrupted" });
    child.kill("SIGTERM");
  }

  if (ws) {
    setTimeout(() => {
      ws?.close();
      ws = null;
    }, 500);
  }

  void Promise.all([shutdownNodeObservability(), shutdownTelemetry()]).finally(() => {
    setTimeout(() => process.exit(0), 3000);
  });
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
