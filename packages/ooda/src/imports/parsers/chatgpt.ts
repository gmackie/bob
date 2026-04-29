import { z } from "zod";

import type { ImportedConversation, ImportedMessage } from "../types.js";

// --- Zod schemas matching ChatGPT export JSON ---

const ChatGPTSimpleMessageSchema = z.object({
  role: z.string().optional(),
  content: z.string().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  model: z.string().optional(),
});

const ChatGPTMappingNodeSchema = z.object({
  message: z
    .object({
      author: z.object({ role: z.string().optional() }).optional(),
      content: z
        .object({ parts: z.array(z.unknown()).optional() })
        .optional(),
      create_time: z.number().nullable().optional(),
      metadata: z.object({ model_slug: z.string().optional() }).optional(),
    })
    .nullable()
    .optional(),
});

const ChatGPTConversationSchema = z.object({
  id: z.string().optional(),
  conversation_id: z.string().optional(),
  title: z.string().optional(),
  created_at: z.union([z.string(), z.number()]).optional(),
  create_time: z.number().optional(),
  updated_at: z.union([z.string(), z.number()]).optional(),
  update_time: z.number().optional(),
  mapping: z.record(z.string(), ChatGPTMappingNodeSchema).optional(),
  messages: z.array(ChatGPTSimpleMessageSchema).optional(),
});

const ChatGPTExportSchema = z.union([
  z.array(ChatGPTConversationSchema),
  z.object({
    conversations: z.array(ChatGPTConversationSchema).optional(),
  }),
]);

// --- Helpers ---

function normalizeRole(role: string): ImportedMessage["role"] {
  const value = (role || "").trim().toLowerCase();
  if (value === "assistant" || value === "user" || value === "system")
    return value;
  return "user";
}

function normalizeTimestamp(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    return new Date(value * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return String(value);
}

function parseMappingMessages(
  mapping: Record<string, z.infer<typeof ChatGPTMappingNodeSchema>>,
): ImportedMessage[] {
  const entries: { time: number; msg: ImportedMessage }[] = [];

  for (const node of Object.values(mapping)) {
    const raw = node.message;
    if (!raw) continue;

    const role = raw.author?.role ?? "";
    const parts = raw.content?.parts;
    const text = Array.isArray(parts)
      ? parts
          .filter((p): p is string => typeof p === "string" && p.length > 0)
          .join("\n\n")
      : "";

    if (!text) continue;

    const createTime = raw.create_time ?? 0;
    entries.push({
      time: createTime,
      msg: {
        role: normalizeRole(role),
        content: text,
        timestamp: normalizeTimestamp(createTime || undefined),
        model: raw.metadata?.model_slug ?? undefined,
      },
    });
  }

  entries.sort((a, b) => a.time - b.time);
  return entries.map((e) => e.msg);
}

// --- Main parser ---

export function parseChatGPT(data: unknown): ImportedConversation[] {
  const parsed = ChatGPTExportSchema.safeParse(data);
  if (!parsed.success) return [];

  const conversations = Array.isArray(parsed.data)
    ? parsed.data
    : parsed.data.conversations ?? [];

  const result: ImportedConversation[] = [];

  for (const conv of conversations) {
    let messages: ImportedMessage[];

    if (conv.mapping) {
      messages = parseMappingMessages(conv.mapping);
    } else {
      messages = (conv.messages ?? [])
        .filter((m) => m.content)
        .map((m) => ({
          role: normalizeRole(m.role ?? ""),
          content: m.content ?? "",
          timestamp: normalizeTimestamp(m.timestamp),
          model: m.model ?? undefined,
        }));
    }

    const conversationId =
      (conv.conversation_id ?? conv.id ?? "").trim() ||
      `chatgpt-${result.length}`;

    result.push({
      provider: "chatgpt",
      conversationId,
      title: conv.title ?? "(untitled)",
      messages,
      createdAt: normalizeTimestamp(conv.created_at ?? conv.create_time),
      updatedAt: normalizeTimestamp(conv.updated_at ?? conv.update_time),
    });
  }

  return result;
}
