import { NextRequest, NextResponse } from "next/server";

import { validateApiKey } from "@bob/auth/api-key";
import { db } from "@bob/db/client";
import { browserCookies } from "@bob/db/schema";
import { encryptCookieValue } from "@bob/api/services/crypto/cookieVault";

const MAX_COOKIES = 500;

const cookieSchema = {
  validate(body: unknown): body is {
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path?: string;
      expires?: number | null;
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: "Strict" | "Lax" | "None";
    }>;
    source?: "extension" | "cli";
  } {
    if (!body || typeof body !== "object") return false;
    const b = body as Record<string, unknown>;
    if (!Array.isArray(b.cookies) || b.cookies.length === 0 || b.cookies.length > MAX_COOKIES) return false;
    return b.cookies.every(
      (c: unknown) =>
        c && typeof c === "object" &&
        typeof (c as Record<string, unknown>).name === "string" &&
        typeof (c as Record<string, unknown>).value === "string" &&
        typeof (c as Record<string, unknown>).domain === "string",
    );
  },
};

export async function POST(req: NextRequest) {
  // Validate API key
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json(
      { error: "Missing authorization" },
      { status: 401 },
    );
  }

  const auth = await validateApiKey(token);
  if (!auth) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  if (
    !auth.permissions.includes("write") &&
    !auth.permissions.includes("admin")
  ) {
    return NextResponse.json(
      { error: "API key lacks write permission" },
      { status: 403 },
    );
  }

  // Parse body
  const body = await req.json();
  if (!cookieSchema.validate(body)) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const source = body.source ?? "extension";
  let imported = 0;
  const domains = new Set<string>();

  for (const cookie of body.cookies) {
    const tempId = crypto.randomUUID();
    const encrypted = encryptCookieValue(cookie.value, tempId);
    const expiresDate =
      cookie.expires && cookie.expires > 0
        ? new Date(cookie.expires * 1000)
        : null;

    await db
      .insert(browserCookies)
      .values({
        id: tempId,
        userId: auth.userId,
        domain: cookie.domain,
        name: cookie.name,
        valueCiphertext: encrypted.ciphertext,
        valueIv: encrypted.iv,
        valueTag: encrypted.tag,
        path: cookie.path ?? "/",
        expires: expiresDate,
        secure: cookie.secure ?? false,
        httpOnly: cookie.httpOnly ?? false,
        sameSite: cookie.sameSite ?? "Lax",
        source,
      })
      .onConflictDoUpdate({
        target: [
          browserCookies.userId,
          browserCookies.domain,
          browserCookies.name,
          browserCookies.path,
        ],
        set: {
          id: tempId,
          valueCiphertext: encrypted.ciphertext,
          valueIv: encrypted.iv,
          valueTag: encrypted.tag,
          expires: expiresDate,
          secure: cookie.secure ?? false,
          httpOnly: cookie.httpOnly ?? false,
          sameSite: cookie.sameSite ?? "Lax",
          source,
        },
      });

    imported++;
    domains.add(cookie.domain);
  }

  return NextResponse.json({ imported, domains: [...domains] });
}
