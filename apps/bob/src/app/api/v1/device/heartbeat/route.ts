import { NextResponse } from "next/server";

import { validateApiKey } from "@bob/auth/api-key";
import { and, desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import {
  apiKeys,
  chatConversations,
  deviceHeartbeats,
} from "@bob/db/schema";

import { getSession } from "~/auth/server";
import {
  formatSessionOption,
  isDeviceOnline,
  normalizeDeviceHeartbeatPayload,
  readSelectedSessionId,
  writeSelectedSessionId,
} from "../device-heartbeat";

export async function GET(request: Request) {
  const token = extractBearerToken(request.headers);
  if (token) {
    return getDeviceSelectionForApiKey(token);
  }

  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const devices = await db
    .select()
    .from(deviceHeartbeats)
    .where(eq(deviceHeartbeats.userId, session.user.id))
    .orderBy(desc(deviceHeartbeats.lastSeenAt));

  const sessions = await db
    .select({
      id: chatConversations.id,
      title: chatConversations.title,
      agentType: chatConversations.agentType,
      sessionType: chatConversations.sessionType,
      status: chatConversations.status,
      updatedAt: chatConversations.updatedAt,
      lastActivityAt: chatConversations.lastActivityAt,
      createdAt: chatConversations.createdAt,
    })
    .from(chatConversations)
    .where(eq(chatConversations.userId, session.user.id))
    .orderBy(desc(chatConversations.createdAt))
    .limit(100);
  const sessionOptions = sessions.map(formatSessionOption);
  const sessionsById = new Map(sessionOptions.map((item) => [item.id, item]));

  return NextResponse.json({
    devices: devices.map((device) => {
      const selectedSessionId = readSelectedSessionId(device.details);
      return {
        ...device,
        selectedSessionId,
        online: isDeviceOnline(device.lastSeenAt),
        selectedSession: selectedSessionId
          ? (sessionsById.get(selectedSessionId) ?? null)
          : null,
      };
    }),
    sessions: sessionOptions,
  });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    apiKeyId?: unknown;
    selectedSessionId?: unknown;
  };
  if (typeof body.apiKeyId !== "string") {
    return NextResponse.json({ error: "Missing apiKeyId" }, { status: 400 });
  }
  const selectedSessionId =
    typeof body.selectedSessionId === "string" &&
    body.selectedSessionId.length > 0
      ? body.selectedSessionId
      : null;

  const device = await db.query.deviceHeartbeats.findFirst({
    where: and(
      eq(deviceHeartbeats.apiKeyId, body.apiKeyId),
      eq(deviceHeartbeats.userId, session.user.id),
    ),
  });
  if (!device) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  if (selectedSessionId) {
    const selectedSession = await db.query.chatConversations.findFirst({
      where: and(
        eq(chatConversations.id, selectedSessionId),
        eq(chatConversations.userId, session.user.id),
      ),
    });
    if (!selectedSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
  }

  const [updated] = await db
    .update(deviceHeartbeats)
    .set({
      details: writeSelectedSessionId(device.details, selectedSessionId),
    })
    .where(
      and(
        eq(deviceHeartbeats.apiKeyId, body.apiKeyId),
        eq(deviceHeartbeats.userId, session.user.id),
      ),
    )
    .returning();

  return NextResponse.json({ ok: true, device: updated ?? null });
}

export async function POST(request: Request) {
  const token = extractBearerToken(request.headers);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const auth = await validateApiKey(token);
  if (!auth || !auth.permissions.includes("write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = normalizeDeviceHeartbeatPayload(
    await request.json().catch(() => ({})),
  );
  const lastSeenAt = new Date().toISOString();
  const existingDevice = await db.query.deviceHeartbeats.findFirst({
    where: and(
      eq(deviceHeartbeats.apiKeyId, auth.keyId),
      eq(deviceHeartbeats.userId, auth.userId),
    ),
  });
  const selectedSessionId = readSelectedSessionId(existingDevice?.details);
  const details = writeSelectedSessionId(payload.details, selectedSessionId);

  const [device] = await db
    .insert(deviceHeartbeats)
    .values({
      apiKeyId: auth.keyId,
      userId: auth.userId,
      deviceName: payload.deviceName,
      state: payload.state,
      message: payload.message,
      wifi: payload.wifi,
      batteryPercent: payload.batteryPercent,
      details,
      lastSeenAt,
    })
    .onConflictDoUpdate({
      target: deviceHeartbeats.apiKeyId,
      set: {
        userId: auth.userId,
        deviceName: payload.deviceName,
        state: payload.state,
        message: payload.message,
        wifi: payload.wifi,
        batteryPercent: payload.batteryPercent,
        details,
        lastSeenAt,
      },
    })
    .returning();

  await db
    .update(apiKeys)
    .set({ lastUsedAt: lastSeenAt })
    .where(eq(apiKeys.id, auth.keyId));

  return NextResponse.json({
    ok: true,
    device: device
      ? {
          ...device,
          online: true,
        }
      : null,
  });
}

function extractBearerToken(headers: Headers): string | null {
  const authHeader = headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

async function getDeviceSelectionForApiKey(token: string) {
  const auth = await validateApiKey(token);
  if (!auth) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const device = await db.query.deviceHeartbeats.findFirst({
    where: and(
      eq(deviceHeartbeats.apiKeyId, auth.keyId),
      eq(deviceHeartbeats.userId, auth.userId),
    ),
  });
  if (!device) {
    return NextResponse.json({ device: null, selectedSession: null });
  }

  const selectedSessionId = readSelectedSessionId(device.details);
  const selected = selectedSessionId
    ? await db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, selectedSessionId),
          eq(chatConversations.userId, auth.userId),
        ),
      })
    : null;

  return NextResponse.json({
    device: {
      ...device,
      selectedSessionId,
      online: isDeviceOnline(device.lastSeenAt),
    },
    selectedSession: selected ? formatSessionOption(selected) : null,
  });
}
