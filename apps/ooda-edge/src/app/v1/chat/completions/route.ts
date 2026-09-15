import {
  completeOodaOpenAiChat,
  oodaOpenAiErrorResponse,
  oodaOpenAiOptionsResponse,
  withOodaOpenAiCors,
} from "@gmacko/ooda/api";
import { createTRPCContext, edgeRouter } from "@gmacko/ooda/api";
import { auth } from "~/auth/server";
import { db } from "~/lib/db-client-lazy";

export function OPTIONS() {
  return oodaOpenAiOptionsResponse();
}

/**
 * OpenAI-compatible chat completions backed by Bob runners (hetzner-bob).
 *
 *   POST https://ooda.blder.bot/v1/chat/completions
 *   Authorization: Bearer bob_...
 *
 * PlayTrek and other apps set LLM_BASE_URL=https://ooda.blder.bot/v1
 * during development, then switch that URL to OpenRouter / Bedrock later.
 */
export async function POST(request: Request) {
  let body: {
    model?: string;
    messages?: Array<{ role?: string; content?: unknown }>;
    stream?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return withOodaOpenAiCors(
      Response.json(
        {
          error: {
            message: "Invalid JSON in request body",
            type: "invalid_request_error",
          },
        },
        { status: 400 },
      ),
    );
  }

  try {
    const ctx = await createTRPCContext({
      headers: request.headers,
      auth,
      db: db as unknown as Parameters<typeof createTRPCContext>[0]["db"],
    });
    const caller = edgeRouter.createCaller(ctx);
    const completion = await completeOodaOpenAiChat(body, {
      listDevices: () => caller.runner.listDevices(),
      createThread: (input) => caller.threads.create(input),
      sendPrompt: (input) => caller.runner.sendPrompt(input),
      listSessions: (input) => caller.runner.listSessions(input),
      getSessionEvents: (input) => caller.runner.getSessionEvents(input),
    });
    return withOodaOpenAiCors(Response.json(completion));
  } catch (error) {
    return withOodaOpenAiCors(oodaOpenAiErrorResponse(error));
  }
}
