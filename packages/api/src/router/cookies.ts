import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { and, count, eq, sql } from "@bob/db";
import { browserCookies, chatConversations, sessionCookieScopes } from "@bob/db/schema";

import {
  encryptCookieValue,
  decryptCookieValue,
} from "../services/crypto/cookieVault";
import { apiKeyWriteProcedure, protectedProcedure } from "../trpc";

/** Normalize cookie domains: strip leading dot, lowercase */
function normalizeDomain(domain: string): string {
  return domain.replace(/^\./, "").toLowerCase();
}

const cookieInputSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string().default("/"),
  expires: z.number().nullable().optional(),
  secure: z.boolean().default(false),
  httpOnly: z.boolean().default(false),
  sameSite: z.enum(["Strict", "Lax", "None"]).default("Lax"),
});

export const cookiesRouter = {
  /** Import cookies — used by both extension and CLI via API key */
  import: apiKeyWriteProcedure
    .input(
      z.object({
        cookies: z.array(cookieInputSchema).min(1).max(500),
        source: z.enum(["extension", "cli"]).default("extension"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
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
    }),

  /** List domains in the cookie jar with counts */
  list: protectedProcedure.query(async ({ ctx }) => {
    const results = await ctx.db
      .select({
        domain: browserCookies.domain,
        count: count(),
        source: browserCookies.source,
        lastUpdated: sql<Date>`max(${browserCookies.updatedAt})`,
      })
      .from(browserCookies)
      .where(eq(browserCookies.userId, ctx.session.user.id))
      .groupBy(browserCookies.domain, browserCookies.source);

    return results;
  }),

  /** Remove all cookies for a domain */
  remove: protectedProcedure
    .input(z.object({ domain: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(browserCookies)
        .where(
          and(
            eq(browserCookies.userId, ctx.session.user.id),
            eq(browserCookies.domain, input.domain),
          ),
        )
        .returning({ id: browserCookies.id });

      return { deleted: result.length };
    }),

  /** Get decrypted cookies for a domain — used by gateway tool */
  getForSession: apiKeyWriteProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        domain: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
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
          eq(browserCookies.userId, ctx.session.user.id),
          eq(browserCookies.domain, domain),
        ),
      });

      const now = new Date();
      const decrypted = cookies
        .filter((c) => !c.expires || new Date(c.expires) > now)
        .map((c) => ({
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
    }),

  /** Set cookie scopes for a session */
  setSessionScopes: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        domains: z.array(z.string()).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the user owns this session
      const session = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.sessionId),
          eq(chatConversations.userId, ctx.session.user.id),
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
    }),
} satisfies TRPCRouterRecord;
