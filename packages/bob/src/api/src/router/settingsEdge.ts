/**
 * Edge-safe settings router for Cloudflare Workers.
 * DB-only procedures (no node:fs/node:os/node:path).
 * Config file operations stay in the full settings router.
 */
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { UpdateUserPreferencesSchema } from "@bob/db/schema";

import { protectedProcedure } from "../trpc";
import {
  settingsEdgeGetPreferences,
  settingsEdgeUpdatePreferences,
  settingsEdgeListApiKeys,
  settingsEdgeCreateApiKey,
  settingsEdgeRevokeApiKey,
  settingsEdgeGetForgeGraphConnection,
  settingsEdgeConnectForgeGraph,
  settingsEdgeDisconnectForgeGraph,
} from "../handlers/settingsEdge";
import {
  notificationPreferencesList,
  notificationPreferencesReset,
  notificationPreferencesSet,
  notificationPreferencesSetInput,
} from "../handlers/notificationPreferences";

export const settingsEdgeRouter: TRPCRouterRecord = {
  getPreferences: protectedProcedure.query(({ ctx }) =>
    settingsEdgeGetPreferences({ db: ctx.db, userId: ctx.session.user.id }, undefined as void),
  ),

  updatePreferences: protectedProcedure
    .input(UpdateUserPreferencesSchema)
    .mutation(({ ctx, input }) =>
      settingsEdgeUpdatePreferences({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /**
   * Sparse per-type opinions. The client merges these with the shared defaults
   * rather than the server resolving them, so changing a default does not
   * require migrating anyone.
   */
  listNotificationPreferences: protectedProcedure.query(({ ctx }) =>
    notificationPreferencesList({ db: ctx.db, userId: ctx.session.user.id } as never),
  ),

  setNotificationPreference: protectedProcedure
    .input(notificationPreferencesSetInput)
    .mutation(({ ctx, input }) =>
      notificationPreferencesSet(
        { db: ctx.db, userId: ctx.session.user.id } as never,
        input,
      ),
    ),

  resetNotificationPreferences: protectedProcedure.mutation(({ ctx }) =>
    notificationPreferencesReset({ db: ctx.db, userId: ctx.session.user.id } as never),
  ),

  listApiKeys: protectedProcedure.query(({ ctx }) =>
    settingsEdgeListApiKeys({ db: ctx.db, userId: ctx.session.user.id }, undefined as void),
  ),

  createApiKey: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        permissions: z
          .array(z.enum(["read", "write", "delete", "admin"]))
          .min(1),
        expiresInDays: z.number().int().positive().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      settingsEdgeCreateApiKey({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  revokeApiKey: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      settingsEdgeRevokeApiKey({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  // ForgeGraph token management
  getForgeGraphConnection: protectedProcedure.query(({ ctx }) =>
    settingsEdgeGetForgeGraphConnection({ db: ctx.db, userId: ctx.session.user.id }, undefined as void),
  ),

  connectForgeGraph: protectedProcedure
    .input(
      z.object({
        apiToken: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      settingsEdgeConnectForgeGraph({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  disconnectForgeGraph: protectedProcedure.mutation(({ ctx }) =>
    settingsEdgeDisconnectForgeGraph({ db: ctx.db, userId: ctx.session.user.id }, undefined as void),
  ),
};
