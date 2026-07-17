import { NextResponse } from "next/server";

import { validateApiKey } from "@bob/auth";
import { and, desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import {
  apiKeys,
  chatConversations,
  deviceHeartbeats,
} from "@bob/db/schema";

import { auth } from "~/auth/server";
import {
  buildDeviceHeartbeatResponse,
  canUseDeviceHeartbeat,
  extractBearerToken,
} from "./device-heartbeat";
import {
  formatSessionOption,
  isDeviceOnline,
  normalizeDeviceHeartbeatPayload,
  readSelectedSessionId,
  writeSelectedSessionId,
} from "../device-heartbeat";

export async function GET(request: Request) {
  const token = extractBearerToken(request);
  if (token) {
    return getDeviceSelectionForApiKey(token);
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const devices = await db
    .select()
    .from(deviceHeartbeats)
    .where(eq(deviceHeartbeats.userId, session.user.id))
    .orderBy(desc(deviceHeartbeats.lastSeenAt))
    .limit(100);

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
  const heartbeat = buildDeviceHeartbeatResponse(sessions);

  return NextResponse.json({
    ok: true,
    selectedSession: heartbeat.selectedSession,
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
  const session = await auth.api.getSession({ headers: request.headers });
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
  const token = extractBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const auth = await validateApiKey(token);
  if (!auth || !canUseDeviceHeartbeat(auth.permissions, "POST")) {
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

async function getDeviceSelectionForApiKey(token: string) {
  const apiKeyAuth = await validateApiKey(token);
  if (!apiKeyAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canUseDeviceHeartbeat(apiKeyAuth.permissions, "GET")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
    .where(eq(chatConversations.userId, apiKeyAuth.userId))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(20);
  const heartbeat = buildDeviceHeartbeatResponse(sessions);
  const device = await db.query.deviceHeartbeats.findFirst({
    where: and(
      eq(deviceHeartbeats.apiKeyId, apiKeyAuth.keyId),
      eq(deviceHeartbeats.userId, apiKeyAuth.userId),
    ),
  });
  if (!device) {
    return NextResponse.json({ ...heartbeat, device: null });
  }

  const selectedSessionId = readSelectedSessionId(device.details);
  const selected = selectedSessionId
    ? await db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, selectedSessionId),
        eq(chatConversations.userId, apiKeyAuth.userId),
        ),
      })
    : null;

  return NextResponse.json({
    ...heartbeat,
    device: {
      ...device,
      selectedSessionId,
      online: isDeviceOnline(device.lastSeenAt),
    },
    selectedSession: selected ? formatSessionOption(selected) : heartbeat.selectedSession,
  });
}
