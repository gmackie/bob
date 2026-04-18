import { getDb } from "@gmacko/db/client";
import { message } from "@gmacko/db/schema";
import { eq } from "drizzle-orm";
import { dispatchAgent } from "@gmacko/agent";

interface StreamChatBody {
  threadId: string;
  branchId: string;
  content: string;
}

/**
 * SSE handler for streaming agent chat responses.
 * POST /api/chat/stream
 *
 * Receives { threadId, branchId, content }, saves the user message,
 * streams agent tokens as SSE events, then saves the assistant message.
 */
export async function handleStreamChat(req: Request): Promise<Response> {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: StreamChatBody;
  try {
    body = (await req.json()) as StreamChatBody;
  } catch {
    return new Response("Bad Request: invalid JSON", { status: 400 });
  }

  const { threadId, branchId, content } = body;
  if (!threadId || !branchId || !content) {
    return new Response("Bad Request: threadId, branchId, and content required", {
      status: 400,
    });
  }

  const db = await getDb();

  // 1. Load existing messages for context
  const existingMessages = await db
    .select()
    .from(message)
    .where(eq(message.branchId, branchId));

  const lastMessage = existingMessages.at(-1);

  // 2. Save user message to DB
  const [userMessage] = await db
    .insert(message)
    .values({
      threadId,
      branchId,
      parentId: lastMessage?.id ?? null,
      role: "user",
      content,
      metadata: {},
    })
    .returning();

  // 3. Build conversation history for the agent
  const chatMessages = existingMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
  chatMessages.push({ role: "user" as const, content });

  // 4. Stream the response via SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let fullContent = "";

        for await (const event of dispatchAgent({
          threadId,
          branchId,
          messages: chatMessages,
        })) {
          if (event.type === "text") {
            const data = JSON.stringify({ type: "token", text: event.text });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            fullContent += event.text;
          }
          if (event.type === "done") {
            fullContent = event.content;
          }
        }

        // 5. Save assistant message to DB
        const [assistantMessage] = await db
          .insert(message)
          .values({
            threadId,
            branchId,
            parentId: userMessage!.id,
            role: "assistant",
            content: fullContent,
            metadata: {},
          })
          .returning();

        const doneData = JSON.stringify({
          type: "done",
          messageId: assistantMessage!.id,
        });
        controller.enqueue(encoder.encode(`data: ${doneData}\n\n`));
        controller.close();
      } catch (err) {
        const errData = JSON.stringify({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        controller.enqueue(encoder.encode(`data: ${errData}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
