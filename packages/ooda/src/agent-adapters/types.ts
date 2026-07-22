import { z } from "zod";

export const AdapterCapabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: z.enum(["stdio", "api"]),
  supportedModels: z.array(z.string()),
  requiresApiKey: z.boolean(),
  apiKeyEnvVar: z.string(),
});

export type AdapterCapability = z.infer<typeof AdapterCapabilitySchema>;

export interface AdapterCommand {
  binary: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  /**
   * The user prompt, for ACP/stdio-RPC adapters that deliver the prompt
   * over the protocol (e.g. `session/prompt`) rather than as a CLI arg.
   * CLI-spawn adapters bake the prompt into `args` and leave this unset.
   */
  prompt?: string;
}

export interface BuildCommandOptions {
  prompt: string;
  workspaceRoot: string;
  systemPrompt?: string;
  /** Persona-selected model (e.g. a specific Claude model id). */
  model?: string;
  /** Persona-restricted tool allowlist passed to the agent CLI. */
  allowedTools?: string[];
  /**
   * "prompt" (default): the agent runs WITHOUT blanket permission bypass;
   * tool calls outside the allowlist surface as permission_request events
   * that a human resolves via AdapterProcessHandle.respondPermission.
   * "skip": legacy full-autonomy behavior (--dangerously-skip-permissions);
   * selected by personas with autonomyLevel "full".
   */
  permissionMode?: "prompt" | "skip";
}

export interface AdapterEvent {
  type:
    | "stdout"
    | "stderr"
    | "exit"
    | "error"
    // ACP-native structured event types (populated by adapters that speak
    // a protocol with first-class reasoning + tool-call streams). Consumers
    // that don't recognize them simply ignore them — they are additive.
    | "thought"
    | "tool_call"
    | "tool_result"
    // The agent is paused waiting for a human permission decision
    // (permissionMode "prompt"). Resolved via handle.respondPermission.
    | "permission_request";
  /** Text for stdout/stderr/thought; a short JSON-ish summary otherwise. */
  data: string;
  timestamp: string;
  exitCode?: number;
  /** Structured payload for `tool_call` / `tool_result` events. */
  tool?: {
    id: string;
    name: string;
    status: "started" | "completed" | "failed";
    input?: unknown;
    output?: string;
  };
  /** Structured payload for `thought` events. */
  thought?: { text: string };
  /** Structured payload for `permission_request` events. */
  permission?: {
    requestId: string;
    toolName?: string;
    input?: unknown;
  };
}

/**
 * Live control surface for a running agent, surfaced via
 * `ExecuteOptions#onSpawn`. Lets the caller steer (queue follow-up user
 * messages) and stop the agent mid-run. Adapters that can't support an
 * operation return false from `write` / make `kill` a no-op.
 */
export interface AdapterProcessHandle {
  /** Queue a follow-up user message for the running agent. False if unsupported or the input channel is closed. */
  write(text: string): boolean;
  /** Terminate the agent (SIGTERM, escalating to SIGKILL after a grace period). */
  kill(): void;
  /**
   * Resolve a pending permission_request. Idempotent per requestId — the
   * second call for the same id returns false. False also when the adapter
   * doesn't support permission prompts or the request is unknown.
   */
  respondPermission?(
    requestId: string,
    behavior: "allow" | "deny",
    message?: string,
  ): boolean;
}

/**
 * Minimal ChildProcess-shaped surface adapters actually use. Lets the runner
 * inject a supervised spawn (a detached wrapper process reached over a unix
 * socket) without adapters knowing the difference.
 */
export interface SpawnedProcessLike {
  stdin: {
    write(data: string): boolean;
    end(): void;
    destroyed: boolean;
    on(event: "error", cb: (err: Error) => void): void;
  } | null;
  stdout: { on(event: "data", cb: (data: Buffer) => void): void } | null;
  stderr: { on(event: "data", cb: (data: Buffer) => void): void } | null;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "close", cb: (exitCode: number | null) => void): void;
  kill(signal?: string): void;
  exitCode: number | null;
  signalCode: string | null;
}

export interface ExecuteOptions {
  /** Called once the agent process is live, with its control handle. */
  onSpawn?: (handle: AdapterProcessHandle) => void;
  /**
   * Spawn injection: when set, adapters create the agent process through
   * this instead of child_process.spawn — the runner uses it to run agents
   * under a detached supervisor wrapper that survives runner restarts.
   */
  spawnImpl?: (
    binary: string,
    args: string[],
    opts: { cwd: string; env: Record<string, string | undefined> },
  ) => SpawnedProcessLike;
}

export interface AgentAdapter {
  id: string;
  name: string;
  transport: "stdio" | "api";

  isAvailable(): boolean;

  buildCommand(opts: BuildCommandOptions): AdapterCommand;

  execute(
    command: AdapterCommand,
    onEvent: (event: AdapterEvent) => void,
    options?: ExecuteOptions,
  ): Promise<{ exitCode: number }>;

  /**
   * Register tool descriptors for this adapter's upcoming ACP session.
   *
   * Optional: CLI-spawn adapters (Codex, Claude) don't have a dispatcher
   * to receive registrations yet. When ACP support lands (V2), adapters
   * that speak it will consume the stashed list here to register with
   * the remote agent.
   *
   * See `tool-registry.ts` for the import-facing helpers.
   */
  registerTools?(tools: ToolDescriptorLike[]): void;

  /**
   * Advertise MCP servers for this adapter's upcoming ACP session. Grok
   * connects OUT to these (via `session/new.mcpServers`) and calls their
   * tools mid-session — the live buddy-tool seam. The session executor
   * stands up an in-process MCP server, registers the session's gated
   * descriptor set, and passes the resulting per-session config here.
   *
   * Optional: only ACP adapters that speak `session/new.mcpServers` (Grok)
   * implement it; CLI-spawn adapters no-op.
   */
  registerMcpServers?(servers: McpServerConfigLike[]): void;
}

/**
 * Structural type for an `mcpServers` entry threaded to
 * `AgentAdapter#registerMcpServers`. Avoids importing the concrete
 * `McpServerConfig` (which lives in `buddy-mcp-server.ts`) into this base
 * module; that type conforms to this shape.
 */
export interface McpServerConfigLike {
  type: "http";
  name: string;
  url: string;
  headers: Array<{ name: string; value: string }>;
}

/**
 * Structural type used by the optional `AgentAdapter#registerTools` hook.
 * Avoids a circular import into `tool-registry.ts` — the concrete
 * `ToolDescriptor` type lives there and conforms to this shape.
 */
export interface ToolDescriptorLike {
  name: string;
  description: string;
}
