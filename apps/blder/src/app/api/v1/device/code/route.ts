import { NextResponse } from "next/server";
import crypto from "node:crypto";

import { db } from "@bob/db/client";
import { deviceCodes } from "@bob/db/schema";

const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function generateUserCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  const chars = Array.from(bytes, (b) => CHARSET[b % CHARSET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
}

export async function POST() {
  try {
    const userCode = generateUserCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const [record] = await db
      .insert(deviceCodes)
      .values({
        userCode,
        status: "pending",
        expiresAt,
      })
      .returning();

    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? "https://blder.bot";

    return NextResponse.json({
      deviceCode: record.deviceCode,
      userCode: record.userCode,
      verificationUrl: `${baseUrl}/device/${record.userCode}`,
      expiresIn: 900,
      interval: 5,
    });
  } catch (error) {
    console.error("Device code generation failed:", error);
    return NextResponse.json(
      { error: "Failed to generate device code" },
      { status: 500 },
    );
  }
}
