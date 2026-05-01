import { z } from "zod";

import type { ImportedConversation, ImportedMessage } from "../types.js";

// --- Zod schema matching session_event table structure ---

const SessionEventSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string(),
  type: z.string(),
  content: z.string(),
  createdAt: z.union([z.string(), z.date()]).optional(),
});

const OodaNativeExportSchema = z.array(SessionEventSchema);

// --- Helpers ---

function typeToRole(type: string): ImportedMessage["role"] {
  const normalized = type.trim().toLowerCase();
  if (normalized === "user" || normalized === "human") return "user";
  if (normalized === "assistant" || normalized === "ai" || normalized === "bot")
    return "assistant";
  if (normalized === "system") return "system";
  // Default: treat unknown types as assistant (tool output, etc.)
  return "assistant";
}

function normalizeTimestamp(value: string | Date | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

// --- Main parser ---

export function parseOodaNative(data: unknown): ImportedConversation[] {
  const parsed = OodaNativeExportSchema.safeParse(data);
  if (!parsed.success) return [];

  // Group events by sessionId
  const groups = new Map<
    string,
    z.infer<typeof SessionEventSchema>[]
  >();
  for (const event of parsed.data) {
    const existing = groups.get(event.sessionId);
    if (existing) {
      existing.push(event);
    } else {
      groups.set(event.sessionId, [event]);
    }
  }

  const result: ImportedConversation[] = [];

  for (const [sessionId, events] of groups) {
    // Sort by createdAt within each session
    events.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ta - tb;
    });

    const messages: ImportedMessage[] = events
      .filter((e) => e.content.trim().length > 0)
      .map((e) => ({
        role: typeToRole(e.type),
        content: e.content,
        timestamp: normalizeTimestamp(e.createdAt),
      }));

    if (messages.length === 0) continue;

    const firstTs = normalizeTimestamp(events[0]?.createdAt);
    const lastTs = normalizeTimestamp(events[events.length - 1]?.createdAt);

    // Derive title from first user message
    const firstUserMsg = messages.find((m) => m.role === "user");
    const title = firstUserMsg
      ? firstUserMsg.content.split("\n", 1)[0]!.slice(0, 120)
      : `OODA session ${sessionId.slice(0, 8)}`;

    result.push({
      provider: "ooda-native",
      conversationId: sessionId,
      title,
      messages,
      createdAt: firstTs,
      updatedAt: lastTs,
    });
  }

  return result;
}
