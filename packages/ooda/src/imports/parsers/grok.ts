import type { ImportedConversation, ImportedMessage } from "../types.js";

// Lenient parser for Grok (x.ai) exports and generic conversation JSON.
//
// Grok has no single documented export schema, so rather than hard-code keys we
// guessed, this handles the shapes chat exports commonly take: a single
// conversation `{ title?, messages: [{ role, content }] }`, an array of such
// conversations, a `{ conversations: [...] }` wrapper, or a flat array of
// messages. Role and content field names are matched loosely. Refine against a
// real Grok export if one turns up something this misses.

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function normalizeRole(v: unknown): ImportedMessage["role"] {
  const s = asString(v).trim().toLowerCase();
  if (
    ["assistant", "ai", "grok", "bot", "model", "agent", "gpt"].includes(s)
  ) {
    return "assistant";
  }
  if (s === "system") return "system";
  return "user"; // human / user / unknown
}

function extractContent(msg: Record<string, unknown>): string {
  // Plain string fields first.
  for (const k of ["content", "text", "message", "body"]) {
    const v = msg[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const content = msg["content"];
  // Array of parts (Anthropic/OpenAI-like).
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") parts.push(part);
      else if (part && typeof part === "object") {
        const t =
          (part as Record<string, unknown>).text ??
          (part as Record<string, unknown>).content ??
          (part as Record<string, unknown>).value;
        if (typeof t === "string") parts.push(t);
      }
    }
    if (parts.length) return parts.join("\n").trim();
  }
  // { parts: [...] } (ChatGPT-like).
  if (
    content &&
    typeof content === "object" &&
    Array.isArray((content as Record<string, unknown>).parts)
  ) {
    return ((content as Record<string, unknown>).parts as unknown[])
      .filter((p): p is string => typeof p === "string")
      .join("\n")
      .trim();
  }
  return "";
}

function roleFrom(msg: Record<string, unknown>): unknown {
  if (typeof msg.role === "string") return msg.role;
  if (typeof msg.sender === "string") return msg.sender;
  const author = msg.author;
  if (typeof author === "string") return author;
  if (
    author &&
    typeof author === "object" &&
    typeof (author as Record<string, unknown>).role === "string"
  ) {
    return (author as Record<string, unknown>).role;
  }
  return undefined;
}

function messagesFrom(obj: Record<string, unknown>): Record<string, unknown>[] {
  for (const k of ["messages", "turns", "responses", "conversation", "chat", "history"]) {
    const v = obj[k];
    if (Array.isArray(v)) {
      return v.filter((m) => m && typeof m === "object") as Record<string, unknown>[];
    }
  }
  return [];
}

function toConversation(
  obj: Record<string, unknown>,
  idx: number,
): ImportedConversation | null {
  const rawMsgs = messagesFrom(obj);
  if (rawMsgs.length === 0) return null;

  const messages: ImportedMessage[] = [];
  for (const m of rawMsgs) {
    const content = extractContent(m);
    if (!content) continue;
    messages.push({
      role: normalizeRole(roleFrom(m)),
      content,
      timestamp:
        typeof m.timestamp === "string"
          ? m.timestamp
          : typeof m.createdAt === "string"
            ? m.createdAt
            : undefined,
    });
  }
  if (messages.length === 0) return null;

  const title =
    asString(obj.title) ||
    asString(obj.name) ||
    messages[0]!.content.split("\n")[0]!.slice(0, 80) ||
    `Grok conversation ${idx + 1}`;
  const conversationId =
    asString(obj.id) ||
    asString(obj.conversationId) ||
    asString(obj.uuid) ||
    `grok-${idx}`;

  return {
    provider: "grok",
    conversationId,
    title,
    messages,
    createdAt: asString(obj.createdAt) || asString(obj.created_at) || undefined,
  };
}

/** True when `data` looks parseable as one or more generic conversations. */
export function looksLikeGenericConversation(data: unknown): boolean {
  const hasMsgs = (o: unknown) =>
    !!o &&
    typeof o === "object" &&
    messagesFrom(o as Record<string, unknown>).length > 0;

  if (hasMsgs(data)) return true;
  if (Array.isArray(data)) {
    const first = data[0];
    if (hasMsgs(first)) return true;
    // Flat array of messages.
    if (
      first &&
      typeof first === "object" &&
      ("role" in first || "sender" in first || "author" in first) &&
      ("content" in first || "text" in first || "message" in first)
    ) {
      return true;
    }
  }
  if (data && typeof data === "object") {
    const convs = (data as Record<string, unknown>).conversations;
    if (Array.isArray(convs) && hasMsgs(convs[0])) return true;
  }
  return false;
}

// --- Real Grok account-export ("prod-grok-backend") format --------------------
// Shape: { conversations: [ { conversation: {id,title,create_time,...},
//   responses: [ { response: {message, sender, create_time, model, ...} } ] } ] }
// Roles: sender is "human" | "assistant" (any case). Message text is a string on
// `response.message`. Responses form a tree (parent_response_id/path) but we
// keep every response that carries text, in listed order — good enough for KB
// ingestion, and avoids dropping regenerated branches.

interface GrokBackendEntry {
  conversation?: Record<string, unknown>;
  responses?: unknown[];
}

/** True for the real Grok account export (nested conversation/responses). */
export function isGrokBackendExport(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const convs = (data as Record<string, unknown>).conversations;
  if (!Array.isArray(convs) || convs.length === 0) return false;
  const first = convs[0];
  return (
    !!first &&
    typeof first === "object" &&
    "conversation" in first &&
    "responses" in first
  );
}

function grokBackendTime(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  // Mongo extended JSON: { $date: { $numberLong: "…ms" } }
  if (v && typeof v === "object") {
    const d = (v as Record<string, unknown>).$date;
    const ms =
      d && typeof d === "object"
        ? (d as Record<string, unknown>).$numberLong
        : undefined;
    if (typeof ms === "string" && /^\d+$/.test(ms)) {
      return new Date(Number(ms)).toISOString();
    }
  }
  return undefined;
}

function parseGrokBackend(data: unknown): ImportedConversation[] {
  const convs = (data as Record<string, unknown>).conversations as unknown[];
  const out: ImportedConversation[] = [];

  convs.forEach((raw, idx) => {
    if (!raw || typeof raw !== "object") return;
    const entry = raw as GrokBackendEntry;
    const conv = (entry.conversation ?? {}) as Record<string, unknown>;
    const responses = Array.isArray(entry.responses) ? entry.responses : [];

    const messages: ImportedMessage[] = [];
    for (const r of responses) {
      const resp =
        r && typeof r === "object"
          ? ((r as Record<string, unknown>).response as
              | Record<string, unknown>
              | undefined)
          : undefined;
      if (!resp) continue;
      const content = asString(resp.message).trim();
      if (!content) continue;
      messages.push({
        role: normalizeRole(resp.sender),
        content,
        timestamp: grokBackendTime(resp.create_time),
      });
    }
    if (messages.length === 0) return;

    const title =
      asString(conv.title) ||
      messages[0]!.content.split("\n")[0]!.slice(0, 80) ||
      `Grok conversation ${idx + 1}`;
    out.push({
      provider: "grok",
      conversationId: asString(conv.id) || `grok-${idx}`,
      title,
      messages,
      createdAt: grokBackendTime(conv.create_time),
    });
  });

  return out;
}

export function parseGrok(data: unknown): ImportedConversation[] {
  // Real account export first.
  if (isGrokBackendExport(data)) return parseGrokBackend(data);

  const out: ImportedConversation[] = [];

  if (Array.isArray(data)) {
    const first = data[0];
    const flatMessages =
      first &&
      typeof first === "object" &&
      ("role" in first || "sender" in first || "author" in first) &&
      messagesFrom(first as Record<string, unknown>).length === 0;
    if (flatMessages) {
      const conv = toConversation({ messages: data }, 0);
      if (conv) out.push(conv);
    } else {
      data.forEach((c, i) => {
        if (c && typeof c === "object") {
          const conv = toConversation(c as Record<string, unknown>, i);
          if (conv) out.push(conv);
        }
      });
    }
  } else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.conversations)) {
      obj.conversations.forEach((c, i) => {
        if (c && typeof c === "object") {
          const conv = toConversation(c as Record<string, unknown>, i);
          if (conv) out.push(conv);
        }
      });
    } else {
      const conv = toConversation(obj, 0);
      if (conv) out.push(conv);
    }
  }

  return out;
}
