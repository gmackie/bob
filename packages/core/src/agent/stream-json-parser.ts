import type { AgentEvent } from "./adapter.js";

/**
 * Parse a single NDJSON line from `claude --output-format stream-json` into
 * our internal `AgentEvent` shape. Returns `null` for unrecognized event
 * types, malformed JSON, or lines that don't map to an AgentEvent — callers
 * skip nulls. This keeps the parser non-throwing so one bad line doesn't
 * kill the stream.
 */
export function parseStreamJsonLine(line: string): AgentEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const evt = obj as Record<string, unknown>;

  if (
    evt.type === "system/init" &&
    typeof evt.session_id === "string" &&
    typeof evt.model === "string"
  ) {
    return {
      type: "session_init",
      externalSessionId: evt.session_id,
      model: evt.model,
    };
  }
  if (evt.type === "turn_start") {
    return { type: "turn_start" };
  }
  if (evt.type === "turn_end" && typeof evt.stop_reason === "string") {
    return { type: "turn_end", stopReason: evt.stop_reason };
  }
  if (
    evt.type === "stream_event" &&
    typeof evt.event === "object" &&
    evt.event !== null
  ) {
    const inner = (evt.event as Record<string, unknown>).delta;
    if (typeof inner === "object" && inner !== null) {
      const delta = inner as Record<string, unknown>;
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        return { type: "text_delta", text: delta.text };
      }
      if (
        delta.type === "tool_use" &&
        typeof delta.id === "string" &&
        typeof delta.name === "string"
      ) {
        return {
          type: "tool_use",
          id: delta.id,
          name: delta.name,
          input: delta.input ?? {},
        };
      }
      if (
        delta.type === "tool_result" &&
        typeof delta.tool_use_id === "string" &&
        typeof delta.content === "string"
      ) {
        return {
          type: "tool_result",
          toolUseId: delta.tool_use_id,
          content: delta.content,
          isError: Boolean(delta.is_error),
        };
      }
    }
  }
  return null;
}

/**
 * Accumulates partial NDJSON chunks (subprocess stdout arrives in arbitrary
 * byte chunks that may split lines mid-line). Emits complete events on
 * push() as newlines arrive. flush() emits any trailing complete-or-partial
 * line's event (useful at stream end if the child forgot the final newline).
 */
export class StreamJsonBuffer {
  private buffer = "";

  push(chunk: string): readonly AgentEvent[] {
    this.buffer += chunk;
    const out: AgentEvent[] = [];
    let idx = this.buffer.indexOf("\n");
    while (idx !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const evt = parseStreamJsonLine(line);
      if (evt !== null) out.push(evt);
      idx = this.buffer.indexOf("\n");
    }
    return out;
  }

  flush(): readonly AgentEvent[] {
    if (this.buffer.length === 0) return [];
    const evt = parseStreamJsonLine(this.buffer);
    this.buffer = "";
    return evt === null ? [] : [evt];
  }
}
