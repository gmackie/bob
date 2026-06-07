import { NextResponse } from "next/server";

import { validateApiKey } from "@bob/auth/api-key";
import { desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { apiKeys, deviceHeartbeats } from "@bob/db/schema";

import { getSession } from "~/auth/server";
import {
  isDeviceOnline,
  normalizeDeviceHeartbeatPayload,
} from "../device-heartbeat";

export async function GET() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const devices = await db
    .select()
    .from(deviceHeartbeats)
    .where(eq(deviceHeartbeats.userId, session.user.id))
    .orderBy(desc(deviceHeartbeats.lastSeenAt));

  return NextResponse.json({
    devices: devices.map((device) => ({
      ...device,
      online: isDeviceOnline(device.lastSeenAt),
    })),
  });
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
      details: payload.details,
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
        details: payload.details,
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
