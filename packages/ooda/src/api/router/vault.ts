import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  listFiles,
  readFile,
  writeFile,
  commitAndPush,
  pull,
  isLocked,
  hasConflicts,
} from "@gmacko/ooda/vault";

import { authedProcedure } from "../trpc";
import type { VaultRouteHost } from "../../vault/vault-route-host";
import type { VaultService } from "../../vault/vault-service";
import { VersionedStorageError } from "../../vault/versioned-storage";

async function executeHosted<T>(
  host: VaultRouteHost,
  actor: string,
  kind: "personal" | "research",
  operation: (service: VaultService) => Promise<T>,
): Promise<T> {
  try {
    return await host.execute(actor, kind, operation);
  } catch (error) {
    if (error instanceof VersionedStorageError &&
        (error.code === "NotAuthorized" || error.code === "NotReady")) {
      throw new TRPCError({
        code: error.code === "NotAuthorized" ? "FORBIDDEN" : "PRECONDITION_FAILED",
        message: error.code === "NotAuthorized" ? "Vault access denied" : "Vault generation is closed",
      });
    }
    throw error;
  }
}

const vaultKindSchema = z.enum(["personal", "research"]);

const ENV_VARS: Record<z.infer<typeof vaultKindSchema>, string> = {
  personal: "PERSONAL_VAULT_PATH",
  research: "RESEARCH_VAULT_PATH",
};

/**
 * Resolve the vault path for the given kind from the environment.
 * Throws TRPCError PRECONDITION_FAILED if the env var is not set.
 */
function getVaultPath(kind: z.infer<typeof vaultKindSchema>): string {
  const envVar = ENV_VARS[kind];
  const path = process.env[envVar];
  if (!path || path.trim() === "") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: [
        `Vault "${kind}" is not configured.`,
        `Cause: Environment variable ${envVar} is not set.`,
        `Fix: Set ${envVar} in .env to the absolute path of your ${kind} vault git clone.`,
      ].join(" "),
    });
  }
  return path;
}

export const vaultRouter = {
  list: authedProcedure
    .meta({ openapi: { method: "GET", path: "/api/vault", tags: ["vault"], protect: true } })
    .input(
      z.object({
        vaultKind: vaultKindSchema,
        glob: z.string().optional(),
      }),
    )
    .output(z.any())
    .query(async ({ input, ctx }) => {
      if (ctx.vaultHost) return executeHosted(ctx.vaultHost, ctx.userId, input.vaultKind, (service) => service.list(input.glob));
      const vaultPath = getVaultPath(input.vaultKind);
      return listFiles(vaultPath, input.glob);
    }),

  read: authedProcedure
    .meta({ openapi: { method: "GET", path: "/api/vault/read", tags: ["vault"], protect: true } })
    .input(
      z.object({
        vaultKind: vaultKindSchema,
        filePath: z.string(),
      }),
    )
    .output(z.any())
    .query(async ({ input, ctx }) => {
      if (ctx.vaultHost) return executeHosted(ctx.vaultHost, ctx.userId, input.vaultKind, (service) => service.read(input.filePath));
      const vaultPath = getVaultPath(input.vaultKind);
      return readFile(vaultPath, input.filePath);
    }),

  write: authedProcedure
    .meta({ openapi: { method: "POST", path: "/api/vault/write", tags: ["vault"], protect: true } })
    .input(
      z.object({
        vaultKind: vaultKindSchema,
        filePath: z.string(),
        content: z.string(),
        frontmatter: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .output(z.any())
    .mutation(async ({ input, ctx }) => {
      if (ctx.vaultHost) return executeHosted(ctx.vaultHost, ctx.userId, input.vaultKind, async (service) => ({
        success: true,
        publication: await service.write(input.filePath, input.content, input.frontmatter),
      }));
      const vaultPath = getVaultPath(input.vaultKind);
      await writeFile(vaultPath, input.filePath, input.content, input.frontmatter);
      const publication = await commitAndPush(vaultPath, `write: ${input.filePath}`);
      return { success: true, publication };
    }),

  promote: authedProcedure
    .meta({ openapi: { method: "POST", path: "/api/vault/promote", tags: ["vault"], protect: true } })
    .input(
      z.object({
        vaultKind: vaultKindSchema,
        threadId: z.string(),
        noteId: z.string(),
        content: z.string(),
        frontmatter: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .output(z.any())
    .mutation(async ({ input, ctx }) => {
      if (ctx.vaultHost) return executeHosted(ctx.vaultHost, ctx.userId, input.vaultKind, async (service) => ({
        success: true,
        publication: (await service.promote(input.threadId, input.noteId, input.content, input.frontmatter)).publication,
      }));
      const vaultPath = getVaultPath(input.vaultKind);
      const filePath = `notes/${input.threadId}/${input.noteId}.md`;
      await writeFile(vaultPath, filePath, input.content, input.frontmatter);
      const publication = await commitAndPush(
        vaultPath,
        `promote: ${input.noteId} from thread ${input.threadId}`,
      );
      return { success: true, publication };
    }),

  sync: authedProcedure
    .meta({ openapi: { method: "POST", path: "/api/vault/sync", tags: ["vault"], protect: true } })
    .input(z.object({ vaultKind: vaultKindSchema }))
    .output(z.any())
    .mutation(async ({ input, ctx }) => {
      if (ctx.vaultHost) return executeHosted(ctx.vaultHost, ctx.userId, input.vaultKind, (service) => service.sync());
      const vaultPath = getVaultPath(input.vaultKind);
      return pull(vaultPath);
    }),

  health: authedProcedure
    .meta({ openapi: { method: "GET", path: "/api/vault/health", tags: ["vault"], protect: true } })
    .input(z.object({ vaultKind: vaultKindSchema }))
    .output(z.any())
    .query(async ({ input, ctx }) => {
      if (ctx.vaultHost) return executeHosted(ctx.vaultHost, ctx.userId, input.vaultKind, async (service) => ({
        isHealthy: await service.isHealthy(),
      }));
      const vaultPath = getVaultPath(input.vaultKind);
      const locked = await isLocked(vaultPath);
      const conflicts = await hasConflicts(vaultPath);
      return {
        isHealthy: !locked && !conflicts,
        locked,
        conflicts,
      };
    }),
} satisfies RouterRecord;
