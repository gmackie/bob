import { NextResponse } from "next/server";

import { db } from "@bob/db/client";

import { user } from "../../../../../../../../packages/db/src/auth-schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    userId?: string;
    email?: string;
    name?: string;
  };

  const userId = body.userId ?? "default-user";
  const email = body.email ?? "default-user@example.com";
  const name = body.name ?? "Default User";

  await db
    .insert(user)
    .values({
      id: userId,
      email,
      name,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  return NextResponse.json({ userId });
}
