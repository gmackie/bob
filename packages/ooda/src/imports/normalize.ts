import type { ImportFormat, ImportedConversation } from "./types";
import {
  parseChatGPT,
  parseClaude,
  parseOodaNative,
  parseGrok,
  looksLikeGenericConversation,
} from "./parsers/index";

function hasKey(obj: unknown, key: string): boolean {
  return typeof obj === "object" && obj !== null && key in (obj as object);
}

/**
 * Inspect raw JSON data and return the detected import format, or null if
 * the structure does not match any known format.
 */
export function detectFormat(data: unknown): ImportFormat | null {
  // OODA native: flat array where entries have sessionId + type + content
  if (Array.isArray(data)) {
    const first = data[0];
    if (
      first &&
      typeof first === "object" &&
      "sessionId" in first &&
      "type" in first &&
      "content" in first
    ) {
      return "ooda-native";
    }

    // Array-of-conversations — peek first entry for provider-specific keys
    if (first && typeof first === "object") {
      if ("mapping" in first || "create_time" in first) return "chatgpt";
      if (
        "chat_messages" in first ||
        ("uuid" in first && !("mapping" in first))
      ) {
        return "claude";
      }
      // Fallback: arrays of conversations with messages — ambiguous, prefer claude
      if ("messages" in first || "title" in first) return "claude";
    }
    // Flat array of messages, or other conversation-shaped arrays → generic/grok.
    if (looksLikeGenericConversation(data)) return "grok";
    return null;
  }

  if (typeof data === "object" && data !== null) {
    if (hasKey(data, "chat_messages")) return "claude";
    if (hasKey(data, "conversations")) {
      const convs = (data as { conversations: unknown }).conversations;
      if (Array.isArray(convs) && convs.length > 0) {
        const c = convs[0];
        if (c && typeof c === "object" && ("mapping" in c || "create_time" in c)) {
          return "chatgpt";
        }
      }
      return "chatgpt";
    }
    if (hasKey(data, "mapping")) return "chatgpt";
  }

  // Last resort: Grok has no documented export schema, so anything that still
  // looks like a conversation (messages with role/content) is parsed by the
  // lenient generic/grok parser rather than rejected.
  if (looksLikeGenericConversation(data)) return "grok";

  return null;
}

/**
 * Detect the format of `data` and run the matching parser.
 * Throws if the format cannot be recognized.
 */
export function normalizeImport(data: unknown): {
  format: ImportFormat;
  conversations: ImportedConversation[];
} {
  const format = detectFormat(data);
  if (!format) {
    throw new Error("Unrecognized import format");
  }

  let conversations: ImportedConversation[];
  switch (format) {
    case "claude":
      conversations = parseClaude(data);
      break;
    case "chatgpt":
      conversations = parseChatGPT(data);
      break;
    case "ooda-native":
      conversations = parseOodaNative(data);
      break;
    case "grok":
      conversations = parseGrok(data);
      break;
  }

  return { format, conversations };
}
