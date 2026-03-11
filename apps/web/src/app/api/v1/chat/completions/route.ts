import { type NextRequest, NextResponse } from "next/server";

import type { OpenCodeClient } from "@bob/api/services/opencode/opencodeClient";
import { createOpenCodeClient } from "@bob/api/services/opencode/opencodeClient";
import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations } from "@bob/db/schema";

export const runtime = "nodejs";

type OpenAIChatRole = "system" | "user" | "assistant" | "tool";

interface OpenAIChatMessage {
  role: OpenAIChatRole;
  content: string | null;
  name?: string;
}

interface OpenAIChatCompletionRequest {
  model?: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  user?: string;
  // ElevenLabs custom LLM may include extra metadata; tolerate unknown fields.
  [key: string]: unknown;
}

interface OpenAIChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: "stop" | "length" | "content_filter" | null;
  }>;
}

interface OpenAIChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: "assistant"; content?: string };
    finish_reason: "stop" | "length" | "content_filter" | null;
  }>;
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

function requireBearer(req: Request): boolean {
  const expected = process.env.ELEVENLABS_CUSTOM_LLM_BEARER_TOKEN;
  if (!expected) return true;

  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] === expected : false;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

function getLastUserText(messages: OpenAIChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    if (
      msg.role === "user" &&
      typeof msg.content === "string" &&
      msg.content.trim()
    ) {
      return msg.content;
    }
  }
  return "";
}

function extractConversationId(
  body: OpenAIChatCompletionRequest,
): string | null {
  const candidates: unknown[] = [
    (body as any).bobConversationId,
    (body as any).conversationId,
    (body as any).metadata && (body as any).metadata.bobConversationId,
    (body as any).extra_body && (body as any).extra_body.bobConversationId,
    (body as any).custom_llm_extra_body &&
      (body as any).custom_llm_extra_body.bobConversationId,
    (body as any).elevenlabs_extra_body &&
      (body as any).elevenlabs_extra_body.bobConversationId,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
  }

  if (typeof body.user === "string" && body.user.trim()) return body.user;

  for (const msg of body.messages) {
    if (!msg) continue;
    if (typeof msg.content !== "string") continue;

    const m = msg.content.match(/bobConversationId:([0-9a-fA-F-]{36})/);
    if (m && m[1]) return m[1];
  }

  return null;
}

async function getOrCreateOpenCodeSessionId(params: {
  conversationId: string;
  opencodeClient: OpenCodeClient;
}): Promise<string> {
  const existing = await db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, params.conversationId),
    columns: { opencodeSessionId: true },
  });

  const persisted = existing?.opencodeSessionId;
  if (typeof persisted === "string" && persisted.trim()) {
    return persisted;
  }

  const created = await params.opencodeClient.createSession({
    bobConversationId: params.conversationId,
  });

  await db
    .update(chatConversations)
    .set({ opencodeSessionId: created.id })
    .where(eq(chatConversations.id, params.conversationId));

  return created.id;
}

function toOpenAiResponse(
  content: string,
  model: string,
): OpenAIChatCompletionResponse {
  return {
    id: makeId("chatcmpl"),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

function sse(lines: string[]): Response {
  const body = lines.map((l) => `data: ${l}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!requireBearer(request)) {
      return jsonError(401, "Unauthorized");
    }

    let body: OpenAIChatCompletionRequest;
    try {
      body = (await request.json()) as OpenAIChatCompletionRequest;
    } catch {
      return jsonError(400, "Invalid JSON");
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      return jsonError(400, "Missing messages");
    }

    const conversationId = extractConversationId(body);
    if (!conversationId) {
      return jsonError(400, "Missing bobConversationId");
    }

    const convo = await db.query.chatConversations.findFirst({
      where: eq(chatConversations.id, conversationId),
    });

    if (!convo) {
      return jsonError(404, "Conversation not found");
    }

    const opencodeClient = createOpenCodeClient();
    const opencodeSessionId = await getOrCreateOpenCodeSessionId({
      conversationId,
      opencodeClient,
    });

    const userText = getLastUserText(body.messages);
    if (!userText) {
      return jsonError(400, "No user message found");
    }

    const model = body.model || "opencode";

    const stream = await opencodeClient.sendMessage(
      opencodeSessionId,
      { role: "user", content: userText },
      { stream: true },
    );

    let content = "";
    for await (const chunk of stream) {
      content += chunk.content;
    }

    if (body.stream) {
      const id = makeId("chatcmpl");
      const created = Math.floor(Date.now() / 1000);
      const chunks: OpenAIChatCompletionChunk[] = [
        {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            { index: 0, delta: { role: "assistant" }, finish_reason: null },
          ],
        },
        {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        },
        {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        },
      ];

      return sse(chunks.map((c) => JSON.stringify(c)));
    }

    return NextResponse.json(toOpenAiResponse(content, model));
  } catch (err) {
    if (err instanceof Error) {
      console.error(err.stack ?? String(err));
      return NextResponse.json({ error: err.message }, { status: 500 });
    }

    console.error(err);
    return NextResponse.json({ error: "Unknown error" }, { status: 500 });
  }
}
