import { z } from "zod";

import type { ImportedConversation, ImportedMessage } from "../types.js";

// --- Zod schemas matching Claude Projects JSON export ---

const ClaudeContentPartSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  thinking: z.string().optional(),
});

const ClaudeMessageSchema = z.object({
  role: z.string().optional(),
  sender: z.string().optional(),
  text: z.string().optional(),
  content: z.array(ClaudeContentPartSchema).optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  created_at: z.string().optional(),
  model: z.string().optional(),
});

const ClaudeConversationSchema = z.object({
  id: z.string().optional(),
  uuid: z.string().optional(),
  title: z.string().optional(),
  name: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  messages: z.array(ClaudeMessageSchema).optional(),
  chat_messages: z.array(ClaudeMessageSchema).optional(),
});

const ClaudeExportSchema = z.union([
  z.array(ClaudeConversationSchema),
  z.object({ chat_messages: z.array(ClaudeConversationSchema).optional() }),
]);

// --- Helpers ---

function normalizeRole(role: string): ImportedMessage["role"] {
  const value = (role || "").trim().toLowerCase();
  if (value === "human") return "user";
  if (value === "assistant" || value === "system") return value;
  return "user";
}

function extractMessageText(msg: z.infer<typeof ClaudeMessageSchema>): string {
  const text = (msg.text ?? "").trim();
  if (text) return text;

  if (!Array.isArray(msg.content)) return "";
  const parts: string[] = [];
  for (const item of msg.content) {
    if (item.type === "text" && item.text) parts.push(item.text);
    else if (item.type === "thinking" && item.thinking) parts.push(item.thinking);
  }
  return parts.join("\n\n");
}

// --- Main parser ---

export function parseClaude(data: unknown): ImportedConversation[] {
  const parsed = ClaudeExportSchema.safeParse(data);
  if (!parsed.success) return [];

  const conversations = Array.isArray(parsed.data)
    ? parsed.data
    : parsed.data.chat_messages ?? [];

  const result: ImportedConversation[] = [];

  for (const conv of conversations) {
    const rawMessages = conv.messages ?? conv.chat_messages ?? [];
    const messages: ImportedMessage[] = [];

    for (const msg of rawMessages) {
      const content = extractMessageText(msg);
      if (!content) continue;
      messages.push({
        role: normalizeRole(msg.role ?? msg.sender ?? ""),
        content,
        timestamp: String(msg.timestamp ?? msg.created_at ?? ""),
        model: msg.model ?? undefined,
      });
    }

    const conversationId =
      (conv.id ?? conv.uuid ?? "").trim() || `claude-${result.length}`;

    result.push({
      provider: "claude",
      conversationId,
      title: conv.title ?? conv.name ?? "(untitled)",
      messages,
      createdAt: conv.created_at ?? undefined,
      updatedAt: conv.updated_at ?? undefined,
    });
  }

  return result;
}
