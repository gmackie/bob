import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { apiKeyWriteProcedure, protectedProcedure } from "../trpc";
import {
  cookiesImport,
  cookiesList,
  cookiesRemove,
  cookiesGetForSession,
  cookiesSetSessionScopes,
} from "../handlers/cookies";

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
    .mutation(({ ctx, input }) =>
      cookiesImport({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** List domains in the cookie jar with counts */
  list: protectedProcedure.query(({ ctx }) =>
    cookiesList({ db: ctx.db, userId: ctx.session.user.id }),
  ),

  /** Remove all cookies for a domain */
  remove: protectedProcedure
    .input(z.object({ domain: z.string() }))
    .mutation(({ ctx, input }) =>
      cookiesRemove({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** Get decrypted cookies for a domain — used by gateway tool */
  getForSession: apiKeyWriteProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        domain: z.string(),
      }),
    )
    .query(({ ctx, input }) =>
      cookiesGetForSession({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** Set cookie scopes for a session */
  setSessionScopes: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        domains: z.array(z.string()).min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      cookiesSetSessionScopes({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
