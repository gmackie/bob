import { NextResponse } from "next/server";
import { db } from "@bob/db/client";
import { deviceCodes } from "@bob/db/schema";
import { eq } from "@bob/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deviceCode = url.searchParams.get("device_code");

  if (!deviceCode) {
    return NextResponse.json(
      { error: "Missing device_code parameter" },
      { status: 400 },
    );
  }

  const [record] = await db
    .select()
    .from(deviceCodes)
    .where(eq(deviceCodes.deviceCode, deviceCode))
    .limit(1);

  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Check expiration
  if (new Date(record.expiresAt) < new Date()) {
    if (record.status !== "expired") {
      await db
        .update(deviceCodes)
        .set({ status: "expired" })
        .where(eq(deviceCodes.id, record.id));
    }
    return NextResponse.json({ status: "expired" });
  }

  // Check if approved with API key
  if (record.status === "approved" && record.apiKey) {
    return NextResponse.json({ status: "complete", apiKey: record.apiKey });
  }

  // Still pending
  return NextResponse.json({ status: "pending" });
}
