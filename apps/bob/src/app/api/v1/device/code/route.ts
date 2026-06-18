import { NextResponse } from "next/server";
import crypto from "node:crypto";

import { db } from "@bob/db/client";
import { deviceCodes } from "@bob/db/schema";

const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const MAX_RETRIES = 3;

function generateUserCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  const chars = Array.from(bytes, (b) => CHARSET[b % CHARSET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
}

export async function POST() {
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // Retry on user_code unique constraint collision
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const userCode = generateUserCode();
      const [record] = await db
        .insert(deviceCodes)
        .values({
          userCode,
          status: "pending",
          expiresAt,
        })
        .returning();

      if (!record) {
        throw new Error("Failed to insert device code");
      }

      const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL ?? "https://blder.bot";

      return NextResponse.json({
        deviceCode: record.deviceCode,
        userCode: record.userCode,
        verificationUrl: `${baseUrl}/device/${record.userCode}`,
        expiresIn: 900,
        interval: 5,
      });
    } catch (error: unknown) {
      const isUniqueViolation =
        error instanceof Error &&
        (error.message.includes("unique") ||
          error.message.includes("duplicate") ||
          error.message.includes("23505"));

      if (isUniqueViolation && attempt < MAX_RETRIES - 1) {
        continue; // Retry with a new code
      }

      console.error("Device code generation failed:", error);
      return NextResponse.json(
        { error: "Failed to generate device code" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(
    { error: "Failed to generate unique code" },
    { status: 500 },
  );
}
