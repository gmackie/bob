export interface LifecycleMetadataDetail {
  label: string;
  value: string;
}

const DETAIL_LABELS: Record<string, string> = {
  arguments: "Arguments",
  command: "Command",
  description: "Description",
  durationMs: "Duration",
  error: "Error",
  isError: "Result",
  message: "Message",
  rawEnvelope: "Envelope",
  result: "Output",
  stderr: "Error output",
  stdout: "Output",
  toolName: "Tool",
};

export function formatLifecycleMetadataDetails(
  metadata: Record<string, unknown> | null | undefined,
): LifecycleMetadataDetail[] {
  if (!metadata) return [];

  const details: LifecycleMetadataDetail[] = [];
  const consumed = new Set<string>();

  appendKnownDetails(metadata, details, consumed);

  for (const [key, value] of Object.entries(metadata)) {
    if (consumed.has(key)) continue;
    const readable = readableMetadataValue(value);
    if (!readable) continue;
    details.push({ label: labelForKey(key), value: readable });
  }

  return details;
}

function appendKnownDetails(
  metadata: Record<string, unknown>,
  details: LifecycleMetadataDetail[],
  consumed: Set<string>,
) {
  const toolName = stringValue(metadata.toolName);
  if (toolName) {
    details.push({ label: "Tool", value: toolName });
    consumed.add("toolName");
  }

  const duration = durationValue(metadata.durationMs);
  if (duration) {
    details.push({ label: "Duration", value: duration });
    consumed.add("durationMs");
  }

  if (typeof metadata.isError === "boolean") {
    details.push({ label: "Result", value: metadata.isError ? "Error" : "Success" });
    consumed.add("isError");
  }

  const command = commandValue(metadata.arguments) || commandValue(metadata);
  if (command) {
    details.push({ label: "Command", value: command });
    consumed.add("arguments");
    consumed.add("command");
  }

  const output = outputValue(metadata.result) || outputValue(metadata);
  if (output) {
    details.push({ label: "Output", value: output });
    consumed.add("result");
    consumed.add("stdout");
    consumed.add("stderr");
  }

  const error = stringValue(metadata.error);
  if (error) {
    details.push({ label: "Error", value: error });
    consumed.add("error");
  }
}

function readableMetadataValue(value: unknown): string {
  const text = stringValue(value);
  if (text) return text;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }

  if (value && typeof value === "object") {
    return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
  }

  return "";
}

function commandValue(value: unknown): string {
  const record = recordValue(value);
  if (!record) return "";
  return stringValue(record.command) || stringValue(record.input) || stringValue(record.path);
}

function outputValue(value: unknown): string {
  const record = recordValue(value);
  if (!record) return stringValue(value);

  return [
    stringValue(record.stdout),
    stringValue(record.stderr),
    stringValue(record.message),
  ].filter(Boolean).join("\n");
}

function durationValue(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function recordValue(value: unknown): Record<string, unknown> | null {
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

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function labelForKey(key: string): string {
  return DETAIL_LABELS[key] ?? key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
