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

import { publicProcedure } from "../trpc";

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
  list: publicProcedure
    .input(
      z.object({
        vaultKind: vaultKindSchema,
        glob: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const vaultPath = getVaultPath(input.vaultKind);
      return listFiles(vaultPath, input.glob);
    }),

  read: publicProcedure
    .input(
      z.object({
        vaultKind: vaultKindSchema,
        filePath: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const vaultPath = getVaultPath(input.vaultKind);
      return readFile(vaultPath, input.filePath);
    }),

  write: publicProcedure
    .input(
      z.object({
        vaultKind: vaultKindSchema,
        filePath: z.string(),
        content: z.string(),
        frontmatter: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const vaultPath = getVaultPath(input.vaultKind);
      await writeFile(vaultPath, input.filePath, input.content, input.frontmatter);
      await commitAndPush(vaultPath, `write: ${input.filePath}`);
      return { success: true };
    }),

  promote: publicProcedure
    .input(
      z.object({
        vaultKind: vaultKindSchema,
        threadId: z.string(),
        noteId: z.string(),
        content: z.string(),
        frontmatter: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const vaultPath = getVaultPath(input.vaultKind);
      const filePath = `notes/${input.threadId}/${input.noteId}.md`;
      await writeFile(vaultPath, filePath, input.content, input.frontmatter);
      await commitAndPush(
        vaultPath,
        `promote: ${input.noteId} from thread ${input.threadId}`,
      );
      return { success: true };
    }),

  sync: publicProcedure
    .input(z.object({ vaultKind: vaultKindSchema }))
    .mutation(async ({ input }) => {
      const vaultPath = getVaultPath(input.vaultKind);
      return pull(vaultPath);
    }),

  health: publicProcedure
    .input(z.object({ vaultKind: vaultKindSchema }))
    .query(async ({ input }) => {
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
