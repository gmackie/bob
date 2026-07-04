import type { ServerEvent } from "@bob/ws";

export interface FileReference {
  path: string;
  shortPath: string;
  action: "read" | "write" | "edit" | "glob" | "grep" | "bash" | "unknown";
  toolCallId: string;
  seq: number;
  /** Content from tool_result, if available */
  content?: string;
}

/** Tools that operate on files */
const FILE_TOOLS: Record<string, { pathKey: string; action: FileReference["action"] }> = {
  Read: { pathKey: "file_path", action: "read" },
  Write: { pathKey: "file_path", action: "write" },
  Edit: { pathKey: "file_path", action: "edit" },
  Glob: { pathKey: "pattern", action: "glob" },
  Grep: { pathKey: "pattern", action: "grep" },
};

function tryParseArgs(args: unknown): Record<string, unknown> | null {
  if (typeof args === "object" && args !== null) return args as Record<string, unknown>;
  if (typeof args !== "string") return null;
  try {
    return JSON.parse(args);
  } catch {
    return null;
  }
}

function shortenPath(fullPath: string): string {
  // Show last 2-3 segments: "src/components/Foo.tsx"
  const parts = fullPath.split("/").filter(Boolean);
  if (parts.length <= 3) return parts.join("/");
  return ".../" + parts.slice(-3).join("/");
}

/**
 * Extract file references from a stream of agent events.
 * Pairs tool_call with tool_result to get content when available.
 */
export function extractFileReferences(events: ServerEvent[]): FileReference[] {
  const refs = new Map<string, FileReference>();
  const toolResults = new Map<string, string>();

  // First pass: collect tool results
  for (const event of events) {
    if (event.eventType === "tool_result" && event.payload.toolCallId) {
      const result = event.payload.result;
      if (typeof result === "string" && !event.payload.isError) {
        toolResults.set(event.payload.toolCallId as string, result);
      }
    }
  }

  // Second pass: extract file references from tool calls
  for (const event of events) {
    if (event.eventType !== "tool_call" || event.direction !== "agent") continue;

    const name = event.payload.name as string;
    const toolCallId = event.payload.toolCallId as string;
    const toolDef = FILE_TOOLS[name];

    if (toolDef) {
      const args = tryParseArgs(event.payload.arguments);
      if (!args) continue;

      const path = args[toolDef.pathKey];
      if (typeof path !== "string") continue;

      const ref: FileReference = {
        path,
        shortPath: shortenPath(path),
        action: toolDef.action,
        toolCallId,
        seq: event.seq,
        content: toolResults.get(toolCallId),
      };

      // Use path as key — later references overwrite earlier ones
      refs.set(path, ref);
      continue;
    }

    // Bash tool — try to extract file paths from the command
    if (name === "Bash") {
      const args = tryParseArgs(event.payload.arguments);
      const command = args?.command;
      if (typeof command === "string") {
        // Extract obvious file paths from common patterns
        const filePatterns = /(?:cat|head|tail|less|vi|vim|nano|code)\s+["']?([^\s"'|;]+)/.exec(command);
        if (filePatterns?.[1]) {
          refs.set(filePatterns[1], {
            path: filePatterns[1],
            shortPath: shortenPath(filePatterns[1]),
            action: "bash",
            toolCallId,
            seq: event.seq,
            content: toolResults.get(toolCallId),
          });
        }
      }
    }
  }

  // Return sorted by seq (most recent first)
  return Array.from(refs.values()).sort((a, b) => b.seq - a.seq);
}

/** Detect file path patterns in text content */
export function findFilePathsInText(text: string): string[] {
  const regex = /(?:^|\s)((?:\/[\w.-]+)+\.\w+(?::\d+)?)/g;
  const matches: string[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[1]!.trim());
  }
  return matches;
}
