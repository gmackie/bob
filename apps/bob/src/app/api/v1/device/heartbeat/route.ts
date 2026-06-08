import { NextResponse } from "next/server";

import { validateApiKey } from "@bob/auth";
import { desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations } from "@bob/db/schema";
import { auth } from "~/auth/server";

import {
  buildDeviceHeartbeatResponse,
  canUseDeviceHeartbeat,
  extractBearerToken,
  type DeviceHeartbeatMethod,
} from "./device-heartbeat";

export async function GET(request: Request) {
  return handleDeviceHeartbeat(request, "GET");
}

export async function POST(request: Request) {
  await request.json().catch(() => ({}));
  return handleDeviceHeartbeat(request, "POST");
}

async function handleDeviceHeartbeat(
  request: Request,
  method: DeviceHeartbeatMethod,
) {
  try {
    const authContext = await authenticateDeviceHeartbeat(request, method);
    if (authContext.status !== 200) {
      return NextResponse.json(
        { error: authContext.status === 403 ? "Forbidden" : "Unauthorized" },
        { status: authContext.status },
      );
    }

    const { userId } = authContext;

    const sessions = await db
      .select({
        id: chatConversations.id,
        title: chatConversations.title,
        agentType: chatConversations.agentType,
        status: chatConversations.status,
        lastActivityAt: chatConversations.lastActivityAt,
        updatedAt: chatConversations.updatedAt,
      })
      .from(chatConversations)
      .where(eq(chatConversations.userId, userId))
      .orderBy(desc(chatConversations.updatedAt))
      .limit(20);

    return NextResponse.json(buildDeviceHeartbeatResponse(sessions));
  } catch (error) {
    console.error("Device heartbeat failed:", error);
    return NextResponse.json(
      { error: "Failed to process device heartbeat" },
      { status: 500 },
    );
  }
}

async function authenticateDeviceHeartbeat(
  request: Request,
  method: DeviceHeartbeatMethod,
): Promise<{ status: 200; userId: string } | { status: 401 | 403 }> {
  const token = extractBearerToken(request);
  if (token) {
    const apiKeyAuth = await validateApiKey(token);
    if (!apiKeyAuth) {
      return { status: 401 };
    }

    if (!canUseDeviceHeartbeat(apiKeyAuth.permissions, method)) {
      return { status: 403 };
    }

    return { status: 200, userId: apiKeyAuth.userId };
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) return { status: 401 };

  return { status: 200, userId: session.user.id };
}
