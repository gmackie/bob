import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { apiKeyWriteProcedure, protectedProcedure } from "../trpc";
import { SessionSecretService } from "../services/secrets/sessionSecretService";
import { ForgeGraphSecretAdapter } from "../services/secrets/forgegraphSecretAdapter";

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
    .query(async ({ ctx, input }) => {
      const service = new SessionSecretService(ctx.db as any);
      return service.listSessionSecrets({
        ...input,
        userId: ctx.session.user.id,
      });
    }),

  getSessionSecretForExecution: apiKeyWriteProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        handle: z.string().min(1).max(64),
      }),
    )
    .query(async ({ ctx, input }) => {
      const service = new SessionSecretService(ctx.db as any);
      return service.getSecretForSessionExecution({
        ...input,
        userId: ctx.session.user.id,
      });
    }),

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
    .mutation(async ({ ctx, input }) => {
      const service = new SessionSecretService(ctx.db as any);
      return service.createSessionSecret({
        ...input,
        userId: ctx.session.user.id,
      });
    }),

  listSessionSecrets: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const service = new SessionSecretService(ctx.db as any);
      return service.listSessionSecrets({
        ...input,
        userId: ctx.session.user.id,
      });
    }),

  deleteSessionSecret: protectedProcedure
    .input(
      z.object({
        secretId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const service = new SessionSecretService(ctx.db as any);
      return service.deleteSessionSecret({
        ...input,
        userId: ctx.session.user.id,
      });
    }),

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
    .mutation(async ({ ctx, input }) => {
      const service = new SessionSecretService(ctx.db as any);
      return service.markSecretUsed(input);
    }),

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
    .mutation(async ({ ctx, input }) => {
      const service = new SessionSecretService(ctx.db as any);
      return service.upsertProjectDeployBinding(input);
    }),

  promoteSessionSecret: protectedProcedure
    .input(
      z.object({
        secretId: z.string(),
        projectId: z.string().uuid(),
        environment: z.enum(["dev", "staging", "prod", "preview"]),
        forgegraphKey: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const service = new SessionSecretService(ctx.db as any);
      const adapter = new ForgeGraphSecretAdapter();
      return service.promoteSessionSecret({
        ...input,
        userId: ctx.session.user.id,
        adapter,
      });
    }),
} satisfies TRPCRouterRecord;
