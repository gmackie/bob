/**
 * Cookies handler functions — pure business logic extracted from the tRPC
 * cookies router.
 *
 * Phase 7B-4D-beta Task 3.
 */
import { and, count, eq, sql } from "@bob/db";
import { browserCookies, chatConversations, sessionCookieScopes } from "@bob/db/schema";

import {
  encryptCookieValue,
  decryptCookieValue,
} from "../services/crypto/cookieVault";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

/** Normalize cookie domains: strip leading dot, lowercase */
function normalizeDomain(domain: string): string {
  return domain.replace(/^\./, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function cookiesImport(
  ctx: HandlerContext,
  input: {
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires?: number | null;
      secure: boolean;
      httpOnly: boolean;
      sameSite: "Strict" | "Lax" | "None";
    }>;
    source: "extension" | "cli";
  },
) {
  const userId = ctx.userId;
  let imported = 0;
  const domains = new Set<string>();

  for (const cookie of input.cookies) {
    const tempId = crypto.randomUUID();
    const encrypted = encryptCookieValue(cookie.value, tempId);
    const normalizedDomain = normalizeDomain(cookie.domain);
    const expiresDate =
      cookie.expires && cookie.expires > 0
        ? new Date(cookie.expires * 1000).toISOString()
        : null;

    await ctx.db
      .insert(browserCookies)
      .values({
        id: tempId,
        userId,
        domain: normalizedDomain,
        name: cookie.name,
        valueCiphertext: encrypted.ciphertext,
        valueIv: encrypted.iv,
        valueTag: encrypted.tag,
        path: cookie.path,
        expires: expiresDate,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        source: input.source,
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
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          source: input.source,
        },
      });

    imported++;
    domains.add(normalizedDomain);
  }

  return { imported, domains: [...domains] };
}

export async function cookiesList(ctx: HandlerContext) {
  const results = await ctx.db
    .select({
      domain: browserCookies.domain,
      count: count(),
      source: browserCookies.source,
      lastUpdated: sql<Date>`max(${browserCookies.updatedAt})`,
    })
    .from(browserCookies)
    .where(eq(browserCookies.userId, ctx.userId))
    .groupBy(browserCookies.domain, browserCookies.source);

  return results;
}

export async function cookiesRemove(
  ctx: HandlerContext,
  input: { domain: string },
) {
  const result = await ctx.db
    .delete(browserCookies)
    .where(
      and(
        eq(browserCookies.userId, ctx.userId),
        eq(browserCookies.domain, input.domain),
      ),
    )
    .returning({ id: browserCookies.id });

  return { deleted: result.length };
}

export async function cookiesGetForSession(
  ctx: HandlerContext,
  input: { sessionId: string; domain: string },
) {
  const domain = normalizeDomain(input.domain);

  // Check domain is in scope for this session
  const scope = await ctx.db.query.sessionCookieScopes.findFirst({
    where: and(
      eq(sessionCookieScopes.sessionId, input.sessionId),
      eq(sessionCookieScopes.domain, domain),
    ),
  });

  if (!scope) {
    return {
      cookies: [],
      error: `Domain "${domain}" not in scope for this session`,
    };
  }

  // Get cookies, filtering expired
  const cookies = await ctx.db.query.browserCookies.findMany({
    where: and(
      eq(browserCookies.userId, ctx.userId),
      eq(browserCookies.domain, domain),
    ),
  });

  const now = new Date();
  const decrypted = cookies
    .filter((c: any) => !c.expires || new Date(c.expires) > now)
    .map((c: any) => ({
      name: c.name,
      value: decryptCookieValue(
        {
          ciphertext: c.valueCiphertext,
          iv: c.valueIv,
          tag: c.valueTag,
        },
        c.id,
      ),
      domain: c.domain,
      path: c.path,
      expires: c.expires ? Math.floor(new Date(c.expires).getTime() / 1000) : -1,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite as "Strict" | "Lax" | "None",
    }));

  return { cookies: decrypted };
}

export async function cookiesSetSessionScopes(
  ctx: HandlerContext,
  input: { sessionId: string; domains: string[] },
) {
  // Verify the user owns this session
  const session = await ctx.db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.sessionId),
      eq(chatConversations.userId, ctx.userId),
    ),
    columns: { id: true },
  });

  if (!session) {
    throw new Error("Session not found or not owned by this user");
  }

  const values = input.domains.map((domain) => ({
    sessionId: input.sessionId,
    domain: normalizeDomain(domain),
  }));

  await ctx.db
    .insert(sessionCookieScopes)
    .values(values)
    .onConflictDoNothing();

  return { scoped: input.domains.length };
}
