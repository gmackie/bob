import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { apiKeyWriteProcedure, protectedProcedure } from "../trpc";
import {
  secretsGetSessionSecretManifest,
  secretsGetSessionSecretForExecution,
  secretsCreateSessionSecret,
  secretsListSessionSecrets,
  secretsDeleteSessionSecret,
  secretsMarkSecretUsed,
  secretsUpsertProjectDeployBinding,
  secretsPromoteSessionSecret,
} from "../handlers/secrets";

const secretPolicySchema = z.object({
  allowedTemplates: z.array(z.string()).default([]),
  redactOutput: z.boolean().default(true),
  maxUses: z.number().int().positive().nullable().optional(),
  templatePolicies: z
    .record(
      z.string(),
      z.object({
        allowedArgPrefixes: z.record(z.string(), z.array(z.string())).optional(),
      }),
    )
    .optional(),
});

export const secretsRouter = {
  getSessionSecretManifest: apiKeyWriteProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) =>
      secretsGetSessionSecretManifest({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getSessionSecretForExecution: apiKeyWriteProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        handle: z.string().min(1).max(64),
      }),
    )
    .query(({ ctx, input }) =>
      secretsGetSessionSecretForExecution({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  createSessionSecret: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        label: z.string().min(1).max(128),
        handle: z.string().min(1).max(64).regex(/^[a-z0-9-_]+$/),
        value: z.string().min(1),
        transport: z.enum(["template", "http", "stdin", "file"]).default("template"),
        policy: secretPolicySchema.default({
          allowedTemplates: [],
          redactOutput: true,
        }),
      }),
    )
    .mutation(({ ctx, input }) =>
      secretsCreateSessionSecret({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  listSessionSecrets: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) =>
      secretsListSessionSecrets({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  deleteSessionSecret: protectedProcedure
    .input(
      z.object({
        secretId: z.string(),
      }),
    )
    .mutation(({ ctx, input }) =>
      secretsDeleteSessionSecret({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  markSecretUsed: protectedProcedure
    .input(
      z.object({
        secretId: z.string(),
        sessionId: z.string().uuid(),
        executor: z.string().min(1).max(32),
        templateId: z.string().max(64).optional(),
        commandPreview: z.string().optional(),
        exitCode: z.number().int().optional(),
        durationMs: z.number().int().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      secretsMarkSecretUsed({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  upsertProjectDeployBinding: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        environment: z.enum(["dev", "staging", "prod", "preview"]),
        label: z.string().min(1).max(128),
        forgegraphKey: z.string().min(1).max(128),
        externalRef: z.string().min(1),
        transport: z.enum(["template", "http", "stdin", "file"]).default("template"),
        templateId: z.string().max(64).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      secretsUpsertProjectDeployBinding({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  promoteSessionSecret: protectedProcedure
    .input(
      z.object({
        secretId: z.string(),
        projectId: z.string().uuid(),
        environment: z.enum(["dev", "staging", "prod", "preview"]),
        forgegraphKey: z.string().min(1).max(128),
      }),
    )
    .mutation(({ ctx, input }) =>
      secretsPromoteSessionSecret({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
