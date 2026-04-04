import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@bob/db/client";
import { eq, and } from "@bob/db";
import { apiKeys, deviceCodes } from "@bob/db/schema";
import { getSession } from "~/auth/server";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { userCode?: string };
    const { userCode } = body;

    if (!userCode || typeof userCode !== "string") {
      return NextResponse.json(
        { error: "Missing userCode" },
        { status: 400 },
      );
    }

    // Find pending device code
    const [record] = await db
      .select()
      .from(deviceCodes)
      .where(
        and(eq(deviceCodes.userCode, userCode), eq(deviceCodes.status, "pending")),
      )
      .limit(1);

    if (!record) {
      return NextResponse.json(
        { error: "Invalid or already used code" },
        { status: 404 },
      );
    }

    // Check expiration
    if (new Date(record.expiresAt) < new Date()) {
      return NextResponse.json({ error: "Code expired" }, { status: 410 });
    }

    // Generate API key (same logic as publicApi.ts generateApiKey)
    const rawKey = `bob_${randomBytes(32).toString("hex")}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 12);

    const [apiKey] = await db
      .insert(apiKeys)
      .values({
        userId: session.user.id,
        name: `bob-cli-${Date.now()}`,
        keyHash,
        keyPrefix,
        permissions: ["read", "write"],
      })
      .returning();

    if (!apiKey) {
      return NextResponse.json(
        { error: "Failed to create API key" },
        { status: 500 },
      );
    }

    // Update device code record
    await db
      .update(deviceCodes)
      .set({
        status: "approved",
        userId: session.user.id,
        apiKey: rawKey,
      })
      .where(eq(deviceCodes.id, record.id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Device approval failed:", error);
    return NextResponse.json(
      { error: "Failed to approve device" },
      { status: 500 },
    );
  }
}
