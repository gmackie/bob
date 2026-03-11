import { type NextRequest, NextResponse } from "next/server";

import { db } from "@bob/db/client";
import { chatConversations } from "@bob/db/schema";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const userId = request.headers.get("x-bob-user-id") ?? "default-user";

  const [row] = await db
    .insert(chatConversations)
    .values({
      userId,
      agentType: "elevenlabs",
      status: "running",
      workflowStatus: "started",
      nextSeq: 1,
    })
    .returning({ id: chatConversations.id });

  if (!row?.id) {
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: row.id });
}
