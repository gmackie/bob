import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { UpdateUserPreferencesSchema } from "@bob/db/schema";

import { protectedProcedure } from "../trpc";
import {
  settingsGetPreferences,
  settingsUpdatePreferences,
  settingsListApiKeys,
  settingsCreateApiKey,
  settingsRevokeApiKey,
  settingsListConfigRoots,
  settingsListConfigEntries,
  settingsReadConfigFile,
  settingsWriteConfigFile,
  settingsDeleteConfigFile,
  settingsGetForgeGraphConnection,
  settingsConnectForgeGraph,
  settingsDisconnectForgeGraph,
} from "../handlers/settings";

const CONFIG_ROOT_IDS = [
  "opencode_xdg",
  "opencode_dot",
  "claude_dot",
  "codex_dot",
  "gemini_dot",
  "kiro_dot",
  "cursor_agent_dot",
] as const;

export const settingsRouter = {
  getPreferences: protectedProcedure.query(({ ctx }) =>
    settingsGetPreferences({ db: ctx.db, userId: ctx.session.user.id }),
  ),

  updatePreferences: protectedProcedure
    .input(UpdateUserPreferencesSchema)
    .mutation(({ ctx, input }) =>
      settingsUpdatePreferences({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  listApiKeys: protectedProcedure.query(({ ctx }) =>
    settingsListApiKeys({ db: ctx.db, userId: ctx.session.user.id }),
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
      settingsCreateApiKey({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  revokeApiKey: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      settingsRevokeApiKey({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  listConfigRoots: protectedProcedure.query(() =>
    settingsListConfigRoots(),
  ),

  listConfigEntries: protectedProcedure
    .input(
      z.object({
        rootId: z.enum(CONFIG_ROOT_IDS),
        dir: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      settingsListConfigEntries({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  readConfigFile: protectedProcedure
    .input(
      z.object({
        rootId: z.enum(CONFIG_ROOT_IDS),
        path: z.string(),
      }),
    )
    .query(({ ctx, input }) =>
      settingsReadConfigFile({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  writeConfigFile: protectedProcedure
    .input(
      z.object({
        rootId: z.enum(CONFIG_ROOT_IDS),
        path: z.string(),
        content: z.string(),
        createOnly: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      settingsWriteConfigFile({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  deleteConfigFile: protectedProcedure
    .input(
      z.object({
        rootId: z.enum(CONFIG_ROOT_IDS),
        path: z.string(),
      }),
    )
    .mutation(({ ctx, input }) =>
      settingsDeleteConfigFile({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getForgeGraphConnection: protectedProcedure.query(({ ctx }) =>
    settingsGetForgeGraphConnection({ db: ctx.db, userId: ctx.session.user.id }),
  ),

  connectForgeGraph: protectedProcedure
    .input(
      z.object({
        apiToken: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      settingsConnectForgeGraph({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  disconnectForgeGraph: protectedProcedure.mutation(({ ctx }) =>
    settingsDisconnectForgeGraph({ db: ctx.db, userId: ctx.session.user.id }),
  ),
} satisfies TRPCRouterRecord;
