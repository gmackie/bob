import { createConversationEventStreamResponse } from "@gmacko/ooda/api/conversation-event-stream";
import { db } from "@gmacko/ooda/db/client";
import { listConversationEventsAfterSequence } from "@gmacko/ooda/kernel";
import { auth } from "~/auth/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function problem(status: number, code: string, detail: string): Response {
  return Response.json(
    {
      version: "v1",
      type: `https://ooda.local/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      title: status === 401 ? "Authentication required" : "Invalid request",
      status,
      code,
      detail,
      correlationId: crypto.randomUUID(),
    },
    { status },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return problem(401, "UNAUTHORIZED", "A valid OODA session is required");

  const { conversationId } = await context.params;
  if (!uuidPattern.test(conversationId)) {
    return problem(422, "VALIDATION_FAILED", "conversationId must be a UUID");
  }

  try {
    return createConversationEventStreamResponse({
      request,
      readEvents: (afterSequence) =>
        listConversationEventsAfterSequence(db, session.user.id, {
          conversationId,
          afterSequence,
        }),
    });
  } catch (error) {
    return problem(
      422,
      "VALIDATION_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
}
