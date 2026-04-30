import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  personalVaultSources,
  researchVaultSources,
} from "@gmacko/ooda/db/schema";
import {
  conversationToSourceRecord,
  normalizeImport,
  type ImportFormat,
} from "@gmacko/ooda/imports";

import { publicProcedure } from "../trpc";

const vaultKindSchema = z.enum(["personal", "research"]);

function normalizeOrThrow(rawJson: unknown) {
  try {
    return normalizeImport(rawJson);
  } catch (err) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        err instanceof Error
          ? err.message
          : "Failed to normalize import payload",
    });
  }
}

export const importsRouter = {
  /**
   * Dry-run normalization. Detects format and returns a preview of the first
   * few conversations without touching the database.
   */
  normalize: publicProcedure
    .input(z.object({ rawJson: z.unknown() }))
    .mutation(({ input }) => {
      const { format, conversations } = normalizeOrThrow(input.rawJson);
      const preview = conversations.slice(0, 5).map((c) => ({
        title: c.title,
        messageCount: c.messages.length,
      }));
      return {
        format: format satisfies ImportFormat,
        count: conversations.length,
        preview,
      };
    }),

  /**
   * Normalize the payload, convert each conversation to a source record,
   * and insert into the chosen vault's `sources` table.
   */
  importConversations: publicProcedure
    .input(
      z.object({
        rawJson: z.unknown(),
        vaultKind: vaultKindSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { conversations } = normalizeOrThrow(input.rawJson);

      if (conversations.length === 0) {
        return { inserted: 0 };
      }

      const rows = conversations.map((conv) => {
        const rec = conversationToSourceRecord(conv);
        return {
          kind: rec.kind,
          externalId: rec.externalId,
          title: rec.title,
          body: rec.body,
          contentHash: rec.contentHash,
          author: rec.author,
          sourceTs: rec.sourceTs ? new Date(rec.sourceTs) : null,
        };
      });

      const table =
        input.vaultKind === "personal"
          ? personalVaultSources
          : researchVaultSources;

      const result = await ctx.db.insert(table).values(rows).returning({
        id: table.id,
      });

      return { inserted: result.length };
    }),
} satisfies RouterRecord;
