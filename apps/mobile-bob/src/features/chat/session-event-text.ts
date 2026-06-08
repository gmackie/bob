const TEXT_KEYS = ["content", "text", "data", "chunk", "message", "line", "result", "delta"];
const NESTED_KEYS = ["data", "event", "message", "response", "output", "delta"];
const STREAM_KEYS = ["stdout", "stderr"];
const TOOL_ARGUMENT_KEYS = ["command", "file_path", "path", "pattern", "query", "input"];

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

export function extractPayloadText(payload: Record<string, unknown>): string {
  for (const key of TEXT_KEYS) {
    const value = payload[key];
    if (typeof value === "string") {
      return extractJsonLinesText(value);
    }
  }

  return extractParsedEventText(payload);
}

export function extractSessionEventText(
  eventType: string,
  payload: Record<string, unknown>,
): string {
  if (eventType === "tool_call") {
    const name = primitiveText(payload.name) || "tool";
    const args = toolArgumentText(payload.arguments);
    return args ? `${name}: ${args.slice(0, 120)}` : name;
  }

  if (eventType === "tool_result") {
    const result = extractPayloadText(payload);
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

  return extractPayloadText(payload);
}
