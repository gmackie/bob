const TEXT_KEYS = ["content", "text", "data", "chunk", "message", "line", "result", "delta"] as const;
const NESTED_KEYS = [
  "content",
  "data",
  "event",
  "message",
  "response",
  "output",
  "delta",
  "result",
] as const;
const STREAM_KEYS = ["stdout", "stderr"] as const;
const TOOL_ARGUMENT_KEYS = ["command", "file_path", "path", "pattern", "query", "input"] as const;

export interface SessionEventLike {
  id?: string;
  seq: number;
  eventType: string;
  direction: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface SessionChatMessage {
  role: "user" | "assistant";
  content: string;
  seq: number;
  time: string;
  toolCalls?: Array<{ name: string; id: string }>;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getEventCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;

  const record = getRecord(value);
  const events = record?.events;
  return Array.isArray(events) ? events : [];
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

export function normalizeSessionEventRecords(value: unknown): SessionEventLike[] {
  return getEventCandidates(value).flatMap((event) => {
    const record = getRecord(event);
    if (!record) return [];
    if (typeof record.seq !== "number") return [];
    if (typeof record.eventType !== "string") return [];
    if (typeof record.direction !== "string") return [];

    return [{
      id: typeof record.id === "string" ? record.id : undefined,
      seq: record.seq,
      eventType: record.eventType,
      direction: record.direction,
      createdAt: toIsoString(record.createdAt),
      payload: getRecord(record.payload) ?? {},
    }];
  });
}

function primitiveText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function contentArrayText(value: unknown): string {
  if (!Array.isArray(value)) return "";

  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return primitiveText(record.text) || primitiveText(record.content);
    })
    .join("");
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function streamText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;

  return STREAM_KEYS
    .map((key) => primitiveText(record[key]).trim())
    .filter(Boolean)
    .join("\n");
}

function toolArgumentText(value: unknown): string {
  const record = parseJsonRecord(value);
  if (!record) return typeof value === "string" ? value : "";

  for (const key of TOOL_ARGUMENT_KEYS) {
    const text = primitiveText(record[key]).trim();
    if (text) return text;
  }

  return "";
}

function extractParsedEventText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(extractParsedEventText).filter(Boolean).join("");
  }

  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  const streams = streamText(record);
  if (streams) return streams;

  for (const key of TEXT_KEYS) {
    const text = primitiveText(record[key]);
    if (text) return text;
  }

  const content = contentArrayText(record.content);
  if (content) return content;

  if (record.message && typeof record.message === "object") {
    const message = record.message as Record<string, unknown>;
    for (const key of TEXT_KEYS) {
      const text = primitiveText(message[key]);
      if (text) return text;
    }

    const messageContent = contentArrayText(message.content);
    if (messageContent) return messageContent;
  }

  if (record.delta && typeof record.delta === "object") {
    const delta = record.delta as Record<string, unknown>;
    for (const key of TEXT_KEYS) {
      const text = primitiveText(delta[key]);
      if (text) return text;
    }
  }

  for (const key of NESTED_KEYS) {
    const nested = record[key];
    if (nested && typeof nested === "object") {
      const text = extractParsedEventText(nested);
      if (text) return text;
    }
  }

  return "";
}

function extractJsonText(value: string): string | null {
  try {
    return extractParsedEventText(JSON.parse(value));
  } catch {
    return null;
  }
}

function extractJsonLinesText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const text = extractJsonText(trimmed);
    return text ?? value;
  }

  if (trimmed.startsWith("{") && !trimmed.includes("\n")) {
    const text = extractJsonText(trimmed);
    return text ?? value;
  }

  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length || !lines.every((line) => line.startsWith("{"))) {
    return value;
  }

  const parts: string[] = [];
  for (const line of lines) {
    try {
      const text = extractParsedEventText(JSON.parse(line));
      if (text) parts.push(text);
    } catch {
      return value;
    }
  }

  return parts.join("");
}

export function formatPayloadText(payload: Record<string, unknown>): string {
  for (const key of TEXT_KEYS) {
    const value = payload[key];
    if (typeof value === "string") {
      return extractJsonLinesText(value);
    }
  }

  return extractParsedEventText(payload);
}

export function formatSessionLogArtifactText(input: {
  content?: unknown;
  lines?: unknown;
}): string {
  if (typeof input.content !== "string" || !input.content.trim()) {
    const lineCount = typeof input.lines === "number" ? input.lines : 0;
    return `${lineCount} lines captured`;
  }

  const lines = input.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    const lineCount = typeof input.lines === "number" ? input.lines : 0;
    return `${lineCount} lines captured`;
  }

  if (lines.every((line) => line.startsWith("{"))) {
    const parts = lines.flatMap((line) => {
      try {
        const text = extractParsedEventText(JSON.parse(line)).trim();
        return text ? [text] : [];
      } catch {
        return [];
      }
    });

    if (parts.length > 0) return parts.join("\n");
  }

  return extractJsonLinesText(input.content);
}

export function formatSessionEventText(
  eventType: string,
  payload: Record<string, unknown>,
): string {
  if (eventType === "tool_call") {
    const name = primitiveText(payload.name) || "tool";
    const args = toolArgumentText(payload.arguments);
    return args ? `${name}: ${args.slice(0, 120)}` : name;
  }

  if (eventType === "tool_result") {
    const result = formatPayloadText(payload);
    if (!result) return "";
    return payload.isError ? `Error: ${result}` : result;
  }

  if (eventType === "state") {
    const status = primitiveText(payload.status);
    const reason = primitiveText(payload.reason);
    const workflowStatus = primitiveText(payload.workflowStatus);
    const message = primitiveText(payload.message);
    const label = status || workflowStatus;
    if (!label) return message;
    return [label.replace(/_/g, " "), reason || message].filter(Boolean).join(": ");
  }

  if (eventType === "error") {
    const message = primitiveText(payload.message) || primitiveText(payload.error);
    const code = primitiveText(payload.code);
    return [code, message].filter(Boolean).join(": ");
  }

  return formatPayloadText(payload);
}

export function collapseSessionEventsToMessages(events: SessionEventLike[]): SessionChatMessage[] {
  const messages: SessionChatMessage[] = [];
  let pendingChunks: string[] = [];
  let pendingSeq = 0;
  let pendingTime = "";

  const flushChunks = () => {
    if (pendingChunks.length === 0) return;
    messages.push({
      role: "assistant",
      content: pendingChunks.join(""),
      seq: pendingSeq,
      time: pendingTime,
    });
    pendingChunks = [];
  };

  for (const event of events) {
    if (event.eventType === "input" && event.direction === "client") {
      flushChunks();
      const content = formatSessionEventText(event.eventType, event.payload);
      if (!content) continue;
      messages.push({
        role: "user",
        content,
        seq: event.seq,
        time: event.createdAt,
      });
      continue;
    }

    if (event.eventType === "output_chunk" && event.direction === "agent") {
      if (pendingChunks.length === 0) {
        pendingSeq = event.seq;
        pendingTime = event.createdAt;
      }
      const chunk = formatSessionEventText(event.eventType, event.payload);
      if (chunk) pendingChunks.push(chunk);
      continue;
    }

    if (event.eventType === "message_final" && event.direction === "agent") {
      flushChunks();
      const content = formatSessionEventText(event.eventType, event.payload);
      if (!content) continue;
      messages.push({
        role: "assistant",
        content,
        seq: event.seq,
        time: event.createdAt,
      });
      continue;
    }

    if (event.eventType === "tool_call" && event.direction === "agent") {
      flushChunks();
      const name = primitiveText(event.payload.name) || "tool";
      const id = primitiveText(event.payload.id) || primitiveText(event.payload.toolCallId);
      messages.push({
        role: "assistant",
        content: "",
        seq: event.seq,
        time: event.createdAt,
        toolCalls: [{ name, id }],
      });
      continue;
    }

    if (event.eventType === "error") {
      flushChunks();
      const content = formatSessionEventText(event.eventType, event.payload);
      messages.push({
        role: "assistant",
        content: content || "An error occurred",
        seq: event.seq,
        time: event.createdAt,
      });
    }
  }

  flushChunks();
  return messages;
}
