/**
 * Cookies handler functions — pure business logic extracted from the tRPC
 * cookies router.
 *
 * Phase 7B-4D-beta Task 3.
 */
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { and, count, eq, sql } from "@bob/db";
import {
  browserCookies as _browserCookies,
  chatConversations,
  sessionCookieScopes as _sessionCookieScopes,
} from "@bob/db/schema";

// drizzle-orm dual-instance shim: the cookie tables are defined in @bob/cookies,
// which resolves a different drizzle-orm peer-hash copy of 0.44.7 (better-sqlite3@11)
// than @bob/api / @bob/db (better-sqlite3@12). Because PgColumn.config is `protected`,
// these tables are nominally incompatible with this package's drizzle query builder
// (ctx.db), and they are dropped from ctx.db.query's relational map. This is a
// genuine nominal-typing gap between two structurally-identical module instances,
// not an unknown shape, but there's no nameable "this instance's PgTable for a table
// declared in the other instance" type to cast to directly — so table-position uses
// (.insert/.from/.delete) go through the base PgTable type (via `unknown`), and
// column-position uses (eq(), .groupBy(), etc.) go through these two small column-name
// records built from the real schema in packages/bob/src/cookies/src/schema.ts, so
// they stay type-checked instead of `any`. chatConversations comes from @bob/chat,
// which shares @bob/api's instance, so it needs no shim. Root fix is to dedupe
// drizzle-orm in the lockfile (reported, not changed here). Runtime is unaffected —
// same table, same columns, same SQL generated either way.
interface BrowserCookiesColumns {
  id: PgColumn;
  userId: PgColumn;
  domain: PgColumn;
  name: PgColumn;
  path: PgColumn;
  source: PgColumn;
  updatedAt: PgColumn;
}
interface SessionCookieScopesColumns {
  sessionId: PgColumn;
  domain: PgColumn;
}
const browserCookies = _browserCookies as unknown as PgTable & BrowserCookiesColumns;
const sessionCookieScopes = _sessionCookieScopes as unknown as PgTable & SessionCookieScopesColumns;

import {
  encryptCookieValue,
  decryptCookieValue,
} from "../services/crypto/cookieVault";
import { auditSecretAccess } from "../services/crypto/secretAccessAudit";

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
    cookies: {
      name: string;
      value: string;
      domain: string;
      path: string;
      expires?: number | null;
      secure: boolean;
      httpOnly: boolean;
      sameSite: "Strict" | "Lax" | "None";
    }[];
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

  // Check domain is in scope for this session. Uses the select() builder
  // rather than ctx.db.query — the cookie tables are dropped from
  // ctx.db.query's relational map (see dual-instance note at imports).
  interface SessionCookieScopeRow {
    sessionId: string;
    domain: string;
  }
  const [scope] = (await ctx.db
    .select()
    .from(sessionCookieScopes)
    .where(
      and(
        eq(sessionCookieScopes.sessionId, input.sessionId),
        eq(sessionCookieScopes.domain, domain),
      ),
    )
    .limit(1)) as unknown as SessionCookieScopeRow[];

  if (!scope) {
    return {
      cookies: [],
      error: `Domain "${domain}" not in scope for this session`,
    };
  }

  // Get cookies, filtering expired
  interface BrowserCookieRow {
    id: string;
    name: string;
    domain: string;
    path: string;
    expires: string | null;
    secure: boolean;
    httpOnly: boolean;
    sameSite: "Strict" | "Lax" | "None";
    valueCiphertext: string;
    valueIv: string;
    valueTag: string;
  }
  const cookies = (await ctx.db
    .select()
    .from(browserCookies)
    .where(
      and(
        eq(browserCookies.userId, ctx.userId),
        eq(browserCookies.domain, domain),
      ),
    )) as unknown as BrowserCookieRow[];

  const now = new Date();
  const live = cookies.filter((c) => !c.expires || new Date(c.expires) > now);

  try {
    const decrypted = live.map((c) => ({
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
      sameSite: c.sameSite,
    }));

    auditSecretAccess({
      resource: "browser_cookie",
      action: "decrypt_for_session",
      userId: ctx.userId,
      sessionId: input.sessionId,
      domain,
      count: decrypted.length,
      success: true,
    });

    return { cookies: decrypted };
  } catch (err) {
    auditSecretAccess({
      resource: "browser_cookie",
      action: "decrypt_for_session",
      userId: ctx.userId,
      sessionId: input.sessionId,
      domain,
      count: live.length,
      success: false,
      detail: err instanceof Error ? err.message : "decrypt failed",
    });
    throw err;
  }
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
