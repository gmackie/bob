// Grok Build ACP glue: the pure `session/update` -> AdapterEvent mapping
// and the request sequence that drives one prompt to completion.
//
// Kept separate from `grok-adapter.ts` (which owns process spawning) so
// both pieces are unit testable without a real `grok` binary.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { isAbsolute, resolve, dirname } from "node:path";

import type { AcpClient } from "./acp-client";
import { dispatchBuddyTool } from "./tool-dispatcher";
import type { ToolDescriptor } from "./tool-registry";
import type { AdapterEvent, McpServerConfigLike } from "./types";

function now(): string {
  return new Date().toISOString();
}

/** A single ACP content block, e.g. `{ type: "text", text: "..." }`. */
interface ContentBlock {
  type?: string;
  text?: string;
}

interface ToolCallContentItem {
  type?: string;
  content?: ContentBlock;
}

/**
 * The inner `update` object of an ACP `session/update` notification.
 * Only the fields we map are typed; the rest is ignored.
 */
export interface SessionUpdate {
  sessionUpdate?: string;
  content?: ContentBlock | ToolCallContentItem[];
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
}

function textOf(content: ContentBlock | ToolCallContentItem[] | undefined): string {
  if (!content) return "";
  if (Array.isArray(content)) {
    return content
      .map((item) => item.content?.text ?? "")
      .filter(Boolean)
      .join("");
  }
  return content.text ?? "";
}

/**
 * Translate one ACP `session/update` inner object into an AdapterEvent,
 * or `null` for update kinds we don't surface (e.g. plans).
 */
export function mapSessionUpdate(update: SessionUpdate): AdapterEvent | null {
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const text = textOf(update.content);
      return { type: "stdout", data: text, timestamp: now() };
    }
    case "agent_thought_chunk": {
      const text = textOf(update.content);
      return { type: "thought", data: text, timestamp: now(), thought: { text } };
    }
    case "tool_call": {
      return {
        type: "tool_call",
        data: update.title ?? "tool call",
        timestamp: now(),
        tool: {
          id: update.toolCallId ?? "",
          name: update.title ?? update.kind ?? "tool",
          status: "started",
          input: update.rawInput,
        },
      };
    }
    case "tool_call_update": {
      const failed = update.status === "failed";
      const output = textOf(update.content);
      return {
        type: "tool_result",
        data: output || (update.status ?? ""),
        timestamp: now(),
        tool: {
          id: update.toolCallId ?? "",
          name: update.title ?? "tool",
          status: failed ? "failed" : "completed",
          output: output || undefined,
        },
      };
    }
    default:
      return null;
  }
}

interface InitializeResult {
  protocolVersion?: number;
  authMethods?: Array<{ id?: string } | string>;
}

interface NewSessionResult {
  sessionId?: string;
}

interface PromptResult {
  stopReason?: string;
}

const FAILURE_STOP_REASONS = new Set(["refusal", "cancelled", "canceled"]);

/** The ACP protocol version this client implements. */
const PROTOCOL_VERSION = 1;

/** Default per-request timeout, matching the gateway's CLI-path budget. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Race a single ACP request against a timeout so a wedged agent process
 * can't block a session indefinitely. Rejects with a descriptive error
 * the adapter surfaces (and acts on by killing the child).
 */
function requestWithTimeout(
  client: AcpClient,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`ACP request timed out after ${timeoutMs}ms: ${method}`));
    }, timeoutMs);
    client.request(method, params).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: Error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Drive a single Grok ACP session to completion:
 * initialize -> (authenticate?) -> session/new -> session/prompt.
 *
 * Notification -> event mapping is wired into the AcpClient by the caller
 * (the adapter), so this function only owns the request sequence and the
 * exit-code decision.
 */
export async function runGrokAcpSession(opts: {
  client: AcpClient;
  prompt: string;
  cwd: string;
  apiKeyPresent: boolean;
  systemPrompt?: string;
  timeoutMs?: number;
  /**
   * MCP servers advertised on `session/new`. Grok connects OUT to these and
   * invokes their tools mid-session — this is how buddy tools reach the
   * agent. Defaults to none.
   */
  mcpServers?: readonly McpServerConfigLike[];
}): Promise<{ exitCode: number; sessionId?: string }> {
  const { client, prompt, cwd, apiKeyPresent } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const request = (method: string, params: unknown) =>
    requestWithTimeout(client, method, params, timeoutMs);

  const init = (await request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
    },
  })) as InitializeResult;

  const authMethods = init?.authMethods ?? [];
  if (!apiKeyPresent && authMethods.length > 0) {
    const first = authMethods[0];
    const methodId = typeof first === "string" ? first : first?.id;
    await request("authenticate", { methodId });
  }

  const session = (await request("session/new", {
    cwd,
    mcpServers: opts.mcpServers ?? [],
  })) as NewSessionResult;
  const sessionId = session?.sessionId;

  const promptBlocks: ContentBlock[] = [];
  if (opts.systemPrompt) {
    promptBlocks.push({ type: "text", text: opts.systemPrompt });
  }
  promptBlocks.push({ type: "text", text: prompt });

  const result = (await request("session/prompt", {
    sessionId,
    prompt: promptBlocks,
  })) as PromptResult;

  const exitCode =
    result?.stopReason && FAILURE_STOP_REASONS.has(result.stopReason) ? 1 : 0;

  return { exitCode, sessionId };
}

function resolveInWorkspace(workspaceRoot: string, path: string | undefined): string {
  const target = path ?? "";
  const abs = isAbsolute(target) ? target : resolve(workspaceRoot, target);
  const root = resolve(workspaceRoot);
  if (abs !== root && !abs.startsWith(root + "/")) {
    throw new Error(`Path escapes workspace: ${target}`);
  }
  return abs;
}

/**
 * MCP JSON-RPC method by which an agent invokes a client-exposed tool by
 * name, with params `{ name, arguments }` and an MCP tool result
 * (`{ content, isError }`) as the response. Buddy tools are surfaced to the
 * agent as MCP tools, so a buddy-tool call arrives here under this method.
 *
 * DORMANT BACKSTOP. The live buddy-tool path is now `buddy-mcp-server.ts`:
 * Grok connects OUT to the in-process HTTP MCP server advertised via
 * `session/new.mcpServers` and calls `tools/call` THERE, not back over ACP.
 * This was verified live (grok 0.2.106 / grok-4.5): with an http MCP server
 * advertised, Grok emits `_x.ai/mcp_initialized {mcpToolCount:N}` and issues
 * MCP `tools/call` to the server — it never sends an agent->client
 * `tools/call`. So this branch no longer fires for buddy tools. It is kept as
 * a harmless, spec-correct backstop (an ACP agent that DID choose to call a
 * client-exposed tool by the standard method still gets a valid result);
 * unknown methods still fall through to the `null` default, preserving the
 * fs/* + `session/request_permission` behavior Grok actually uses.
 */
const MCP_TOOLS_CALL_METHOD = "tools/call";

/** MCP `tools/call` result envelope (a text content block + error flag). */
interface McpToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}

/**
 * Answer agent->client ACP requests. Grok Build edits the working tree
 * itself, but ACP also lets it delegate fs ops, ask permission, and call
 * client-exposed tools — we handle all three so the agent never hangs.
 * Returns the JSON-RPC `result` for the request (or `null` for unhandled
 * methods). Buddy-tool dispatch is async, so that branch returns a Promise
 * (the AcpClient awaits it before replying).
 *
 * `descriptors` is the tool set exposed for this session (built + gated by
 * the session executor). When empty, no tool is dispatchable and every
 * tool call resolves to an `UNKNOWN_TOOL` error result.
 */
export function handleAgentRequest(
  workspaceRoot: string,
  method: string,
  params: unknown,
  descriptors: readonly ToolDescriptor[] = [],
): unknown {
  switch (method) {
    case "fs/read_text_file": {
      const p = params as { path?: string };
      return { content: readFileSync(resolveInWorkspace(workspaceRoot, p.path), "utf8") };
    }
    case "fs/write_text_file": {
      const p = params as { path?: string; content?: string };
      const abs = resolveInWorkspace(workspaceRoot, p.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, p.content ?? "", "utf8");
      return null;
    }
    case "session/request_permission": {
      const p = params as { options?: Array<{ optionId?: string; kind?: string }> };
      const options = p.options ?? [];
      const allow = options.find((o) => o.kind?.startsWith("allow")) ?? options[0];
      if (allow?.optionId) {
        return { outcome: { outcome: "selected", optionId: allow.optionId } };
      }
      return { outcome: { outcome: "selected" } };
    }
    case MCP_TOOLS_CALL_METHOD:
      return dispatchToolCall(descriptors, params);
    default:
      return null;
  }
}

/**
 * Bridge an MCP `tools/call` request to the buddy-tool dispatcher and shape
 * the buddy `ToolResult` back into the MCP tool-result envelope. The full
 * structured result is serialized into the text block so the agent sees the
 * `{ ok, data, error }` payload verbatim; `isError` mirrors `!ok`.
 */
function dispatchToolCall(
  descriptors: readonly ToolDescriptor[],
  params: unknown,
): Promise<McpToolCallResult> {
  const p = (params ?? {}) as { name?: string; arguments?: unknown };
  const toolName = typeof p.name === "string" ? p.name : "";
  return dispatchBuddyTool(descriptors, toolName, p.arguments).then((result) => ({
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    isError: !result.ok,
  }));
}
