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

    // Atomic check-and-set: only approve if still pending.
    // This prevents the TOCTOU race where two concurrent approvals
    // could both succeed and create duplicate API keys.
    const [updated] = await db
      .update(deviceCodes)
      .set({
        status: "approved",
        userId: session.user.id,
      })
      .where(
        and(
          eq(deviceCodes.userCode, userCode),
          eq(deviceCodes.status, "pending"),
        ),
      )
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Invalid, expired, or already used code" },
        { status: 404 },
      );
    }

    // Check expiration
    if (new Date(updated.expiresAt) < new Date()) {
      // Already set to approved, revert to expired
      await db
        .update(deviceCodes)
        .set({ status: "expired" })
        .where(eq(deviceCodes.id, updated.id));
      return NextResponse.json({ error: "Code expired" }, { status: 410 });
    }

    // Generate API key
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
      // Revert device code status since we couldn't create the key
      await db
        .update(deviceCodes)
        .set({ status: "pending" })
        .where(eq(deviceCodes.id, updated.id));
      return NextResponse.json(
        { error: "Failed to create API key" },
        { status: 500 },
      );
    }

    // Store raw key temporarily for CLI retrieval
    await db
      .update(deviceCodes)
      .set({ apiKey: rawKey })
      .where(eq(deviceCodes.id, updated.id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Device approval failed:", error);
    return NextResponse.json(
      { error: "Failed to approve device" },
      { status: 500 },
    );
  }
}
