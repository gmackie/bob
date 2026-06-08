// Grok Build ACP glue: the pure `session/update` -> AdapterEvent mapping
// and the request sequence that drives one prompt to completion.
//
// Kept separate from `grok-adapter.ts` (which owns process spawning) so
// both pieces are unit testable without a real `grok` binary.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { isAbsolute, resolve, dirname } from "node:path";

import type { AcpClient } from "./acp-client";
import type { AdapterEvent } from "./types";

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
    mcpServers: [],
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
 * Answer agent->client ACP requests. Grok Build edits the working tree
 * itself, but ACP also lets it delegate fs ops and ask permission — we
 * handle both defensively so the agent never hangs. Returns the JSON-RPC
 * `result` for the request (or `null` for unhandled methods).
 */
export function handleAgentRequest(
  workspaceRoot: string,
  method: string,
  params: unknown,
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
    default:
      return null;
  }
}
